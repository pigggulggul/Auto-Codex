import type { PetState } from "../../shared/protocol";

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

export function shortSkillName(name: string): string {
  const value = name.includes(":") ? name.split(":").at(-1) ?? name : name;
  return value.replaceAll("-", " ");
}

