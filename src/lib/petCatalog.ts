import type { AgentRole, PetState } from "../../shared/protocol";

export type PetPresentation = {
  label: string;
  verb: string;
  accent: string;
};

export const PET_PRESENTATIONS: Record<PetState, PetPresentation> = {
  idle: { label: "대기 중", verb: "다음 일을 기다리고 있어요", accent: "mint" },
  connecting: { label: "연결 중", verb: "Codex를 깨우고 있어요", accent: "violet" },
  thinking: { label: "생각 중", verb: "요청을 이해하고 계획해요", accent: "violet" },
  reading: { label: "읽는 중", verb: "자료를 꼼꼼히 살펴봐요", accent: "blue" },
  editing: { label: "수정 중", verb: "프로젝트 파일을 다듬어요", accent: "amber" },
  running: { label: "실행 중", verb: "도구와 명령을 사용해요", accent: "coral" },
  waitingApproval: { label: "승인 대기", verb: "당신의 확인을 기다려요", accent: "amber" },
  success: { label: "완료", verb: "업무를 잘 마쳤어요", accent: "mint" },
  error: { label: "확인 필요", verb: "문제가 생겨 잠시 멈췄어요", accent: "coral" },
};

export type PetManifest = {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  spriteVersionNumber?: number;
  kind?: string;
};

export type LoadedPet = PetManifest & {
  manifestUrl: string;
  spritesheetUrl: string;
  columns: 8;
  rows: 9 | 11;
  cellWidth: 192;
  cellHeight: 208;
};

export type PetCatalogResult = { pets: LoadedPet[]; errors: string[] };
export type PetMotion = "stationary" | "walking-left" | "walking-right";
export type PetAnimation = { row: number; frames: number; durations: number[] };
export type PetAssignments = Partial<Record<AgentRole, string>>;

const STANDARD_ANIMATIONS = {
  idle: { row: 0, frames: 6, durations: [280, 110, 110, 140, 140, 320] },
  runningRight: { row: 1, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  runningLeft: { row: 2, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, frames: 4, durations: [140, 140, 140, 280] },
  jumping: { row: 4, frames: 5, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, frames: 8, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, frames: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, frames: 6, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, frames: 6, durations: [150, 150, 150, 150, 150, 280] },
} satisfies Record<string, PetAnimation>;

const DEFAULT_PET_BY_ROLE: Record<AgentRole, string> = {
  coordinator: "agumon",
  general: "nao",
  builder: "jiji",
  researcher: "frieren",
  documenter: "anya",
  visual: "pika",
  qa: "nezu",
  integrator: "xiaoba",
};

const STORAGE_PREFIX = "auto-codex.pet-assignments.";

export function animationForPetState(state: PetState, motion: PetMotion = "stationary"): PetAnimation {
  if (motion === "walking-left") return STANDARD_ANIMATIONS.runningLeft;
  if (motion === "walking-right") return STANDARD_ANIMATIONS.runningRight;
  switch (state) {
    case "thinking":
    case "reading":
      return STANDARD_ANIMATIONS.review;
    case "editing":
    case "running":
      return STANDARD_ANIMATIONS.running;
    case "waitingApproval":
      return STANDARD_ANIMATIONS.waiting;
    case "success":
      return STANDARD_ANIMATIONS.waving;
    case "error":
      return STANDARD_ANIMATIONS.failed;
    case "connecting":
    case "idle":
    default:
      return STANDARD_ANIMATIONS.idle;
  }
}

function storageKey(projectPath: string | null): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectPath || "global")}`;
}

export function loadPetAssignments(projectPath: string | null): PetAssignments {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(projectPath)) ?? "{}") as Record<string, unknown>;
    const assignments: PetAssignments = {};
    for (const [role, petId] of Object.entries(parsed)) {
      if (typeof petId === "string") assignments[role as AgentRole] = petId;
    }
    return assignments;
  } catch {
    return {};
  }
}

export function savePetAssignments(projectPath: string | null, assignments: PetAssignments): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(projectPath), JSON.stringify(assignments));
}

export function petForRole(role: AgentRole, pets: readonly LoadedPet[], assignments: PetAssignments): LoadedPet | null {
  const requested = assignments[role] || DEFAULT_PET_BY_ROLE[role];
  return pets.find((pet) => pet.id === requested) ?? pets[0] ?? null;
}

function loadImageSize(url: string, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const abort = () => {
      image.src = "";
      reject(new DOMException("펫 이미지 로드를 취소했습니다.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      signal?.removeEventListener("abort", abort);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      signal?.removeEventListener("abort", abort);
      reject(new Error(`스프라이트 이미지를 읽지 못했습니다: ${url}`));
    };
    image.src = url;
  });
}

async function loadPetManifest(manifestPath: string, signal?: AbortSignal): Promise<LoadedPet> {
  const manifestUrl = `/pets/${manifestPath.replace(/^\/+/, "")}`;
  const response = await fetch(manifestUrl, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`펫 manifest를 읽지 못했습니다: ${manifestPath}`);
  const manifest = await response.json() as Partial<PetManifest>;
  if (!manifest.id || !manifest.displayName || !manifest.spritesheetPath) {
    throw new Error(`펫 manifest 필드가 부족합니다: ${manifestPath}`);
  }
  const directory = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
  const spritesheetUrl = `${directory}${manifest.spritesheetPath}`;
  const size = await loadImageSize(spritesheetUrl, signal);
  const rows = size.height === 2288 ? 11 : size.height === 1872 ? 9 : null;
  if (size.width !== 1536 || rows === null) {
    throw new Error(`${manifest.displayName} atlas 크기가 1536x1872 또는 1536x2288이 아닙니다.`);
  }
  if (manifest.spriteVersionNumber === 2 && rows !== 11) {
    throw new Error(`${manifest.displayName}은 V2로 표시됐지만 8x11 atlas가 아닙니다.`);
  }
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    description: manifest.description || `${manifest.displayName} Codex pet`,
    spritesheetPath: manifest.spritesheetPath,
    spriteVersionNumber: rows === 11 ? 2 : 1,
    kind: manifest.kind,
    manifestUrl,
    spritesheetUrl,
    columns: 8,
    rows,
    cellWidth: 192,
    cellHeight: 208,
  };
}

export async function loadPetCatalog(signal?: AbortSignal): Promise<PetCatalogResult> {
  const response = await fetch("/pets/catalog.json", { signal, cache: "no-store" });
  if (!response.ok) return { pets: [], errors: ["펫 catalog.json을 읽지 못했습니다."] };
  const value = await response.json() as { pets?: unknown };
  if (!Array.isArray(value.pets)) return { pets: [], errors: ["펫 catalog 형식이 올바르지 않습니다."] };
  const settled = await Promise.allSettled(
    value.pets.filter((entry): entry is string => typeof entry === "string").map((path) => loadPetManifest(path, signal)),
  );
  return {
    pets: settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    errors: settled.flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []),
  };
}

export function shortSkillName(name: string): string {
  const value = name.includes(":") ? name.split(":").at(-1) ?? name : name;
  return value.replaceAll("-", " ");
}
