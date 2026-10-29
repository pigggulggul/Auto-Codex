import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRole, AgentSnapshot, PetState, RunSnapshot, TaskNode } from "../../shared/protocol";
import { PET_PRESENTATIONS, type LoadedPet, type PetAssignments } from "../lib/petCatalog";
import {
  ASSET_ROOT,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CARPET_ASSETS,
  CHARACTER_DRAW_HEIGHT,
  CHARACTER_DRAW_WIDTH,
  CHARACTER_ASSETS,
  FURNITURE,
  FLOOR_ASSETS,
  PET_ASSETS,
  PET_FRAME_SIZE,
  PET_DRAW_SIZE,
  LOUNGE_RUG,
  REST_SPOTS,
  ROOM_LAYOUTS,
  ROLE_COLORS,
  ROLE_LABELS,
  ROLE_ORDER,
  STATIONS,
  TILE_SIZE,
  WALL_ASSET,
  WORLD_COLS,
  WORLD_ROWS,
  characterWalkFrame,
  roomDoorTiles,
  createBlockedTiles,
  directionBetween,
  findPath,
  furnitureAssetPath,
  furnitureVisualRect,
  furnitureSortDepth,
  isRuntimeActive,
  isCommonArea,
  idleWanderTargets,
  isWalkable,
  pointCenter,
  type Direction,
  type TilePoint,
} from "../world/pixelWorld";
import { characterIndexForRole, type WorldCharacterAssignments } from "../lib/worldCharacters";
import { alphaBounds, drawCharacterSprite, type SpriteBounds } from "../world/spriteRendering";

type Props = {
  run: RunSnapshot | null;
  bridgeConnected: boolean;
  appServerReady: boolean;
  pets: LoadedPet[];
  petAssignments: PetAssignments;
  soloState: PetState;
  activeRole: AgentRole;
  modelLabel: string;
  onAssignPet: (role: AgentRole, petId: string) => void;
  characterAssignments: WorldCharacterAssignments;
  onAssignCharacter: (role: AgentRole, index: number) => void;
  animationEnabled: boolean;
  onToggleAnimation: () => void;
  onOpenResults: () => void;
};

type WorldAgent = {
  role: AgentRole;
  snapshot: AgentSnapshot;
  spriteIndex: number;
  x: number;
  y: number;
  tileCol: number;
  tileRow: number;
  path: TilePoint[];
  moveProgress: number;
  walkDistance: number;
  direction: Direction;
  target: TilePoint;
  nextWanderAt: number;
  manualUntil: number;
  handoffUntil: number;
};

type WorldPet = {
  id: string;
  name: string;
  spriteIndex: number;
  x: number;
  y: number;
  tileCol: number;
  tileRow: number;
  path: TilePoint[];
  moveProgress: number;
  direction: Direction;
  nextWanderAt: number;
  heartUntil: number;
};

type Point = { x: number; y: number };
type Handoff = { from: AgentRole; to: AgentRole; title: string };

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

const BLOCKED_TILES = createBlockedTiles();
const PC_ON_ASSETS = [1, 2].map((frame) => `${ASSET_ROOT}/furniture/PC/PC_FRONT_ON_${frame}.png`);

const ZONE_RECTS: Array<{ role: AgentRole; col: number; row: number; width: number; height: number }> = ROOM_LAYOUTS
  .filter((room) => room.role)
  .map((room) => ({ role: room.role as AgentRole, col: room.col, row: room.row, width: room.width, height: room.height }));

const GROUND_OFFSET_Y = 3;
const CHARACTER_FOOT_SINK = 1;
const WALL_DEPTH = 6;
const FLOOR_INDEX_MAP = Array.from({ length: WORLD_ROWS }, (_, row) => Array.from({ length: WORLD_COLS }, (_, col) => (
  ROOM_LAYOUTS.find((room) => col >= room.col && col < room.col + room.width && row >= room.row && row < room.row + room.height)?.floorIndex ?? 4
)));

function drawHorizontalWallSegment(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  width: number,
  zoom: number,
  offset: Point,
): void {
  const x = Math.round(offset.x + col * TILE_SIZE * zoom);
  const y = Math.round(offset.y + row * TILE_SIZE * zoom);
  const pixelWidth = width * TILE_SIZE * zoom;
  const depth = WALL_DEPTH * zoom;
  ctx.fillStyle = "#3e2418";
  ctx.fillRect(x, y, pixelWidth, depth + zoom);
  ctx.fillStyle = "#9a572b";
  ctx.fillRect(x, y, pixelWidth, zoom);
  ctx.fillStyle = "#d08a43";
  ctx.fillRect(x, y + zoom, pixelWidth, zoom);
  ctx.fillStyle = "#7b4223";
  ctx.fillRect(x, y + 2 * zoom, pixelWidth, 2 * zoom);
  ctx.fillStyle = "#512d1b";
  ctx.fillRect(x, y + 4 * zoom, pixelWidth, depth - 4 * zoom + zoom);
  for (let plank = 1; plank < width; plank += 1) {
    const lineX = x + plank * TILE_SIZE * zoom;
    ctx.fillStyle = "#3a2117";
    ctx.fillRect(lineX, y + zoom, zoom, depth);
    ctx.fillStyle = "rgba(236, 164, 85, .42)";
    ctx.fillRect(lineX + zoom, y + 2 * zoom, zoom, zoom);
  }
}

function drawVerticalWallSegment(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  height: number,
  zoom: number,
  offset: Point,
): void {
  const x = Math.round(offset.x + col * TILE_SIZE * zoom);
  const y = Math.round(offset.y + row * TILE_SIZE * zoom);
  const pixelHeight = height * TILE_SIZE * zoom;
  const depth = WALL_DEPTH * zoom;
  ctx.fillStyle = "#3e2418";
  ctx.fillRect(x, y, depth + zoom, pixelHeight);
  ctx.fillStyle = "#9a572b";
  ctx.fillRect(x, y, zoom, pixelHeight);
  ctx.fillStyle = "#d08a43";
  ctx.fillRect(x + zoom, y, zoom, pixelHeight);
  ctx.fillStyle = "#7b4223";
  ctx.fillRect(x + 2 * zoom, y, 2 * zoom, pixelHeight);
  ctx.fillStyle = "#512d1b";
  ctx.fillRect(x + 4 * zoom, y, depth - 4 * zoom + zoom, pixelHeight);
  for (let plank = 1; plank < height; plank += 1) {
    const lineY = y + plank * TILE_SIZE * zoom;
    ctx.fillStyle = "#3a2117";
    ctx.fillRect(x + zoom, lineY, depth, zoom);
    ctx.fillStyle = "rgba(236, 164, 85, .42)";
    ctx.fillRect(x + 2 * zoom, lineY + zoom, zoom, zoom);
  }
}

function drawHorizontalWall(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  width: number,
  zoom: number,
  offset: Point,
  openings: number[] = [],
): void {
  const open = new Set(openings);
  let segmentStart = 0;
  while (segmentStart < width) {
    while (segmentStart < width && open.has(segmentStart)) segmentStart += 1;
    if (segmentStart >= width) break;
    let segmentEnd = segmentStart;
    while (segmentEnd < width && !open.has(segmentEnd)) segmentEnd += 1;
    drawHorizontalWallSegment(ctx, col + segmentStart, row, segmentEnd - segmentStart, zoom, offset);
    segmentStart = segmentEnd;
  }
}

function drawVerticalWall(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  height: number,
  zoom: number,
  offset: Point,
  openings: number[] = [],
): void {
  const open = new Set(openings);
  let segmentStart = 0;
  while (segmentStart < height) {
    while (segmentStart < height && open.has(segmentStart)) segmentStart += 1;
    if (segmentStart >= height) break;
    let segmentEnd = segmentStart;
    while (segmentEnd < height && !open.has(segmentEnd)) segmentEnd += 1;
    drawVerticalWallSegment(ctx, col, row + segmentStart, segmentEnd - segmentStart, zoom, offset);
    segmentStart = segmentEnd;
  }
}

function drawDoorThreshold(ctx: CanvasRenderingContext2D, col: number, row: number, zoom: number, offset: Point): void {
  const x = Math.round(offset.x + col * TILE_SIZE * zoom);
  const y = Math.round(offset.y + row * TILE_SIZE * zoom);
  ctx.fillStyle = "#d5b878";
  ctx.fillRect(x, y, TILE_SIZE * zoom, 2 * zoom);
  ctx.fillStyle = "#f7e1a0";
  ctx.fillRect(x + 2 * zoom, y, (TILE_SIZE - 4) * zoom, zoom);
}

function drawRoomArchitecture(ctx: CanvasRenderingContext2D, zoom: number, offset: Point): void {
  for (const room of ROOM_LAYOUTS.filter((candidate) => candidate.role)) {
    const doors = roomDoorTiles(room);
    const openings = doors.map((door) => door.col - room.col);
    drawHorizontalWall(ctx, room.col, room.row, room.width, zoom, offset, doors[0].row === room.row ? openings : []);
    drawHorizontalWall(ctx, room.col, room.row + room.height, room.width, zoom, offset, doors[0].row === room.row + room.height ? openings : []);
    drawVerticalWall(ctx, room.col, room.row + 1, room.height - 1, zoom, offset);
    drawVerticalWall(ctx, room.col + room.width, room.row + 1, room.height - 1, zoom, offset);
    for (const door of doors) drawDoorThreshold(ctx, door.col, door.row, zoom, offset);
  }

  // Exterior shell: unlike the previous implementation this is a wall body,
  // not a row of floor tiles stretched around the map.
  drawHorizontalWall(ctx, 0, 0, WORLD_COLS, zoom, offset);
  drawHorizontalWall(ctx, 0, WORLD_ROWS - 1, WORLD_COLS, zoom, offset);
  drawVerticalWall(ctx, 0, 1, WORLD_ROWS - 2, zoom, offset);
  drawVerticalWall(ctx, WORLD_COLS - 1, 1, WORLD_ROWS - 2, zoom, offset);
}

function syntheticAgent(
  role: AgentRole,
  live: AgentSnapshot | undefined,
  soloState: PetState,
  activeRole: AgentRole,
  hasRun: boolean,
): AgentSnapshot {
  if (live) return live;
  const soloActive = !hasRun && role === activeRole && !["idle", "connecting", "success", "error"].includes(soloState);
  return {
    id: `world:${role}`,
    role,
    name: ROLE_LABELS[role],
    status: soloActive ? "working" : "idle",
    activity: role === activeRole && !hasRun ? soloState : "idle",
    taskIds: [],
    currentTaskId: null,
    threadId: null,
    turnId: null,
  };
}

function currentTask(run: RunSnapshot | null, agent: AgentSnapshot): TaskNode | null {
  return run?.tasks.find((task) => task.id === agent.currentTaskId)
    ?? run?.tasks.find((task) => task.agentId === agent.id && ["ready", "running", "waitingApproval"].includes(task.status))
    ?? null;
}

function initialWorldAgent(snapshot: AgentSnapshot, index: number, assignment: number): WorldAgent {
  const rest = REST_SPOTS[snapshot.role];
  const center = pointCenter(rest);
  return {
    role: snapshot.role,
    snapshot,
    spriteIndex: assignment ?? index % CHARACTER_ASSETS.length,
    x: center.x,
    y: center.y,
    tileCol: rest.col,
    tileRow: rest.row,
    path: [],
    moveProgress: 0,
    walkDistance: 0,
    direction: index % 2 === 0 ? "down" : "up",
    target: rest,
    nextWanderAt: performance.now() + 1600 + index * 330,
    manualUntil: 0,
    handoffUntil: 0,
  };
}

function initialPets(): WorldPet[] {
  return [
    { id: "claudio", name: "Claudio", spriteIndex: 0, tileCol: 11, tileRow: 12, direction: "down" as const },
    { id: "gitcat", name: "Gitcat", spriteIndex: 1, tileCol: 28, tileRow: 12, direction: "left" as const },
  ].map((pet, index) => {
    const center = pointCenter({ col: pet.tileCol, row: pet.tileRow });
    return {
      ...pet,
      x: center.x,
      y: center.y,
      path: [],
      moveProgress: 0,
      nextWanderAt: performance.now() + 2400 + index * 1300,
      heartUntil: 0,
    };
  });
}

function routeAgent(agent: WorldAgent, target: TilePoint, now = performance.now()): void {
  if (agent.target.col === target.col && agent.target.row === target.row && (agent.path.length > 0 || (agent.tileCol === target.col && agent.tileRow === target.row))) return;
  const path = findPath({ col: agent.tileCol, row: agent.tileRow }, target, BLOCKED_TILES);
  if (path.length === 0 && (agent.tileCol !== target.col || agent.tileRow !== target.row)) return;
  agent.target = target;
  agent.path = path;
  agent.moveProgress = 0;
  agent.nextWanderAt = now + 2600;
}

function randomRestTarget(role: AgentRole, others: Iterable<WorldAgent>): TilePoint {
  const occupied = Array.from(others).filter((agent) => agent.role !== role);
  const candidates = idleWanderTargets(role, BLOCKED_TILES).filter((point) => occupied.every((agent) => (
    Math.hypot(point.col - agent.target.col, point.row - agent.target.row) >= 2
    && Math.hypot(point.col - agent.tileCol, point.row - agent.tileRow) >= 2
  )));
  return candidates[Math.floor(Math.random() * candidates.length)] ?? REST_SPOTS[role];
}

function moveEntity(
  entity: Pick<WorldAgent, "x" | "y" | "tileCol" | "tileRow" | "path" | "moveProgress" | "direction">,
  dt: number,
  speed: number,
): number {
  let remainingDistance = speed * dt;
  let totalTravelled = 0;
  while (remainingDistance > 0 && entity.path.length > 0) {
    const next = entity.path[0];
    const from = { col: entity.tileCol, row: entity.tileRow };
    entity.direction = directionBetween(from, next);
    const distanceToNextTile = (1 - entity.moveProgress) * TILE_SIZE;
    const travelled = Math.min(remainingDistance, distanceToNextTile);
    totalTravelled += travelled;
    entity.moveProgress += travelled / TILE_SIZE;
    remainingDistance -= travelled;
    const start = pointCenter(from);
    const end = pointCenter(next);
    entity.x = start.x + (end.x - start.x) * entity.moveProgress;
    entity.y = start.y + (end.y - start.y) * entity.moveProgress;
    if (entity.moveProgress >= 1 - Number.EPSILON) {
      entity.tileCol = next.col;
      entity.tileRow = next.row;
      entity.x = end.x;
      entity.y = end.y;
      entity.path.shift();
      entity.moveProgress = 0;
    }
  }
  return totalTravelled;
}

function assetUrls(): string[] {
  return Array.from(new Set([
    ...FLOOR_ASSETS,
    ...CHARACTER_ASSETS,
    ...PET_ASSETS,
    ...CARPET_ASSETS,
    WALL_ASSET,
    ...FURNITURE.map((item) => furnitureAssetPath(item.asset)),
    ...PC_ON_ASSETS,
  ]));
}

function activityBubble(agent: WorldAgent, handoff: Handoff | null, now: number): string | null {
  if (handoff?.from === agent.role && agent.handoffUntil > now) return `→ ${ROLE_LABELS[handoff.to]}`;
  if (agent.snapshot.status === "waitingApproval") return "승인 필요 !";
  if (agent.snapshot.activity === "error") return "확인 필요";
  if (agent.snapshot.activity === "success") return "완료 ✓";
  if (isRuntimeActive(agent.snapshot.status)) return PET_PRESENTATIONS[agent.snapshot.activity].label;
  return null;
}

export function PixelOffice({
  run,
  bridgeConnected,
  appServerReady,
  soloState,
  activeRole,
  modelLabel,
  characterAssignments,
  onAssignCharacter,
  animationEnabled,
  onToggleAnimation,
  onOpenResults,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bubbleRefs = useRef(new Map<AgentRole, HTMLDivElement>());
  const roomLabelRefs = useRef(new Map<AgentRole, HTMLButtonElement>());
  const assetsRef = useRef(new Map<string, HTMLImageElement>());
  const propBoundsRef = useRef(new Map<string, SpriteBounds>());
  const agentsRef = useRef(new Map<AgentRole, WorldAgent>());
  const petsRef = useRef<WorldPet[]>(initialPets());
  const selectedRoleRef = useRef<AgentRole | null>(null);
  const zoomRef = useRef(2);
  const panRef = useRef<Point>({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const previousRun = useRef<RunSnapshot | null>(null);
  const timeOffsetRef = useRef(0);
  const [selectedRole, setSelectedRole] = useState<AgentRole | null>(null);
  const [assetStatus, setAssetStatus] = useState({ loaded: 0, total: assetUrls().length, errors: [] as string[] });
  const [zoom, setZoom] = useState(2);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const handoffRef = useRef<Handoff | null>(null);
  const reducedMotion = !animationEnabled;

  const agents = useMemo(() => {
    const byRole = new Map((run?.agents ?? []).map((agent) => [agent.role, agent]));
    return ROLE_ORDER.map((role) => syntheticAgent(role, byRole.get(role), soloState, activeRole, Boolean(run)));
  }, [activeRole, run, soloState]);

  useEffect(() => { selectedRoleRef.current = selectedRole; }, [selectedRole]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { handoffRef.current = handoff; }, [handoff]);

  useEffect(() => {
    const renderWorldState = () => JSON.stringify({
      coordinateSystem: "origin at the top-left; columns increase rightward and rows increase downward",
      zoom: zoomRef.current,
      selectedRole: selectedRoleRef.current,
      agents: Array.from(agentsRef.current.values()).map((agent) => ({
        role: agent.role,
        status: agent.snapshot.status,
        activity: agent.snapshot.activity,
        tile: { col: agent.tileCol, row: agent.tileRow },
        moving: agent.path.length > 0 || agent.moveProgress > 0,
        walkDistance: agent.walkDistance,
        walkFrame: characterWalkFrame(agent.walkDistance),
      })),
      pets: petsRef.current.map((pet) => ({
        id: pet.id,
        tile: { col: pet.tileCol, row: pet.tileRow },
        moving: pet.path.length > 0 || pet.moveProgress > 0,
      })),
    });
    window.render_game_to_text = renderWorldState;
    window.advanceTime = (ms: number) => {
      if (Number.isFinite(ms) && ms > 0) timeOffsetRef.current += ms;
    };
    return () => {
      if (window.render_game_to_text === renderWorldState) delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const urls = assetUrls();
    let loaded = 0;
    const errors: string[] = [];
    for (const url of urls) {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        if (cancelled) return;
        assetsRef.current.set(url, image);
        if (url.includes("/furniture/")) {
          const sample = document.createElement("canvas");
          sample.width = image.naturalWidth; sample.height = image.naturalHeight;
          const sampleContext = sample.getContext("2d", { willReadFrequently: true });
          if (sampleContext) {
            sampleContext.drawImage(image, 0, 0);
            const bounds = alphaBounds(sample.width, sample.height, sampleContext.getImageData(0, 0, sample.width, sample.height).data);
            if (bounds) propBoundsRef.current.set(url, bounds);
          }
        }
        loaded += 1;
        setAssetStatus({ loaded, total: urls.length, errors: [...errors] });
      };
      image.onerror = () => {
        if (cancelled) return;
        loaded += 1;
        errors.push(url);
        setAssetStatus({ loaded, total: urls.length, errors: [...errors] });
      };
      image.src = url;
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const now = performance.now();
    agents.forEach((snapshot, index) => {
      const assigned = characterIndexForRole(snapshot.role, characterAssignments);
      let worldAgent = agentsRef.current.get(snapshot.role);
      if (!worldAgent) {
        worldAgent = initialWorldAgent(snapshot, index, assigned);
        agentsRef.current.set(snapshot.role, worldAgent);
      }
      const wasActive = isRuntimeActive(worldAgent.snapshot.status);
      worldAgent.snapshot = snapshot;
      worldAgent.spriteIndex = assigned;
      if (isRuntimeActive(snapshot.status)) {
        worldAgent.manualUntil = 0;
        routeAgent(worldAgent, STATIONS[snapshot.role], now);
      } else if (worldAgent.manualUntil <= now && (wasActive || !isCommonArea(worldAgent.target))) {
        routeAgent(worldAgent, REST_SPOTS[snapshot.role], now);
      }
    });
  }, [agents, characterAssignments, handoff]);

  useEffect(() => {
    const previous = previousRun.current;
    previousRun.current = run;
    if (!previous || !run || previous.id !== run.id) return;
    const completed = run.tasks.find((task) => {
      const before = previous.tasks.find((candidate) => candidate.id === task.id);
      return task.status === "completed" && before && before.status !== "completed";
    });
    if (!completed) return;
    const recipient = run.tasks.find((task) => task.dependsOn.includes(completed.id)
      && ["ready", "running", "waitingApproval"].includes(task.status)
      && task.agentRole !== completed.agentRole);
    if (!recipient) return;
    setHandoff({ from: completed.agentRole, to: recipient.agentRole, title: recipient.title });
    const timer = window.setTimeout(() => setHandoff(null), 2600);
    return () => window.clearTimeout(timer);
  }, [run]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const density = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.max(1, Math.round(bounds.width * density));
      canvas.height = Math.max(1, Math.round(bounds.height * density));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    let animationFrame = 0;
    let previousTime = performance.now();
    let previousOffset = timeOffsetRef.current;

    const draw = (time: number) => {
      ctx.setTransform(canvas.width / CANVAS_WIDTH, 0, 0, canvas.height / CANVAS_HEIGHT, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const simulationTime = time + timeOffsetRef.current;
      const realDelta = Math.min(Math.max(0, time - previousTime), 50);
      const forcedDelta = Math.max(0, timeOffsetRef.current - previousOffset);
      const dt = (realDelta + forcedDelta) / 1000;
      previousTime = time;
      previousOffset = timeOffsetRef.current;
      const currentZoom = zoomRef.current;
      const worldWidth = WORLD_COLS * TILE_SIZE * currentZoom;
      const worldHeight = WORLD_ROWS * TILE_SIZE * currentZoom;
      panRef.current = {
        x: Math.max(-(worldWidth - CANVAS_WIDTH) / 2, Math.min((worldWidth - CANVAS_WIDTH) / 2, panRef.current.x)),
        y: Math.max(-(worldHeight - CANVAS_HEIGHT) / 2, Math.min((worldHeight - CANVAS_HEIGHT) / 2, panRef.current.y)),
      };
      const offset = {
        x: Math.round((CANVAS_WIDTH - worldWidth) / 2 + panRef.current.x),
        y: Math.round((CANVAS_HEIGHT - worldHeight) / 2 + panRef.current.y),
      };

      for (const agent of agentsRef.current.values()) {
        if (reducedMotion && agent.path.length > 0) {
          const target = agent.path.at(-1)!;
          const center = pointCenter(target);
          agent.tileCol = target.col;
          agent.tileRow = target.row;
          agent.x = center.x;
          agent.y = center.y;
          agent.path = [];
          agent.moveProgress = 0;
        } else {
          agent.walkDistance += moveEntity(agent, dt, 34);
        }
        if (!reducedMotion && !isRuntimeActive(agent.snapshot.status) && agent.path.length === 0 && simulationTime > agent.nextWanderAt && simulationTime > agent.manualUntil && simulationTime > agent.handoffUntil) {
          routeAgent(agent, randomRestTarget(agent.role, agentsRef.current.values()), simulationTime);
          agent.nextWanderAt = simulationTime + 3200 + Math.random() * 4200;
        }
      }

      for (const pet of petsRef.current) {
        if (reducedMotion && pet.path.length > 0) pet.path = [];
        else moveEntity(pet, dt, 38);
        if (!reducedMotion && pet.path.length === 0 && simulationTime > pet.nextWanderAt) {
          // Companions use the common corridor, keeping individual offices and
          // their working/idle characters clear of overlapping pet sprites.
          const target = { col: 3 + Math.floor(Math.random() * (WORLD_COLS - 6)), row: 10 + Math.floor(Math.random() * 5) };
          if (isWalkable(target, BLOCKED_TILES)) pet.path = findPath({ col: pet.tileCol, row: pet.tileRow }, target, BLOCKED_TILES);
          pet.nextWanderAt = simulationTime + 3500 + Math.random() * 5000;
        }
      }

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = "#1d2e31";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      for (let row = 0; row < WORLD_ROWS; row += 1) {
        for (let col = 0; col < WORLD_COLS; col += 1) {
          const floorIndex = FLOOR_INDEX_MAP[row][col];
          const image = assetsRef.current.get(FLOOR_ASSETS[floorIndex]);
          const x = offset.x + col * TILE_SIZE * currentZoom;
          const y = offset.y + row * TILE_SIZE * currentZoom;
          if (image) ctx.drawImage(image, x, y, TILE_SIZE * currentZoom, TILE_SIZE * currentZoom);
          else {
            ctx.fillStyle = (col + row) % 2 === 0 ? "#adb5af" : "#a5ada7";
            ctx.fillRect(x, y, TILE_SIZE * currentZoom, TILE_SIZE * currentZoom);
          }
        }
      }

      drawRoomArchitecture(ctx, currentZoom, offset);

      for (const zone of ZONE_RECTS) {
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = ROLE_COLORS[zone.role];
        ctx.fillRect(
          offset.x + (zone.col + 0.5) * TILE_SIZE * currentZoom,
          offset.y + (zone.row + 0.5) * TILE_SIZE * currentZoom,
          (zone.width - 1) * TILE_SIZE * currentZoom,
          (zone.height - 1) * TILE_SIZE * currentZoom,
        );
        ctx.restore();
      }

      const carpet = assetsRef.current.get(CARPET_ASSETS[1]);
      if (carpet) {
        ctx.save();
        ctx.drawImage(carpet, offset.x + LOUNGE_RUG.col * TILE_SIZE * currentZoom, offset.y + LOUNGE_RUG.row * TILE_SIZE * currentZoom, LOUNGE_RUG.width * TILE_SIZE * currentZoom, LOUNGE_RUG.height * TILE_SIZE * currentZoom);
        ctx.restore();
      }

      const drawables: Array<{ z: number; draw: () => void }> = [];
      for (const item of FURNITURE) {
        let url = furnitureAssetPath(item.asset);
        if (item.ownerRole && item.id.endsWith("-pc")) {
          const owner = agentsRef.current.get(item.ownerRole);
          if (owner && isRuntimeActive(owner.snapshot.status)) url = PC_ON_ASSETS[Math.floor(simulationTime / 250) % PC_ON_ASSETS.length];
        }
        const image = assetsRef.current.get(url);
        if (!image) continue;
        const source = propBoundsRef.current.get(url) ?? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
        const rect = furnitureVisualRect(item, source.width, source.height);
        const x = offset.x + rect.x * currentZoom;
        const y = offset.y + rect.y * currentZoom;
        drawables.push({
          z: furnitureSortDepth(item),
          draw: () => ctx.drawImage(image, source.x, source.y, source.width, source.height, x, y, rect.width * currentZoom, rect.height * currentZoom),
        });
      }

      for (const agent of agentsRef.current.values()) {
        const moving = agent.path.length > 0 || agent.moveProgress > 0;
        const selected = selectedRoleRef.current === agent.role;
        const sprite = assetsRef.current.get(CHARACTER_ASSETS[agent.spriteIndex % CHARACTER_ASSETS.length]);
        const seated = isRuntimeActive(agent.snapshot.status) && !moving && agent.tileCol === STATIONS[agent.role].col && agent.tileRow === STATIONS[agent.role].row;
        const bounce = !reducedMotion && agent.snapshot.activity === "success" ? Math.abs(Math.sin(simulationTime / 170)) * 4 : 0;
        const shake = !reducedMotion && agent.snapshot.activity === "error" ? Math.sin(simulationTime / 75) * 1.4 : 0;
        const groundY = agent.y + GROUND_OFFSET_Y + (seated ? 2 : 0);
        const drawX = Math.round(offset.x + (agent.x - CHARACTER_DRAW_WIDTH / 2 + shake) * currentZoom);
        const drawY = Math.round(offset.y + (groundY - CHARACTER_DRAW_HEIGHT + CHARACTER_FOOT_SINK - bounce) * currentZoom);
        drawables.push({
          z: agent.y + 8,
          draw: () => {
            ctx.save();
            ctx.globalAlpha = 0.22;
            ctx.fillStyle = "#162326";
            ctx.beginPath();
            ctx.ellipse(offset.x + agent.x * currentZoom, offset.y + groundY * currentZoom, 9 * currentZoom, 2.5 * currentZoom, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            if (selected) {
              ctx.save();
              ctx.strokeStyle = "#fff9a8";
              ctx.lineWidth = 1.5 * currentZoom;
              ctx.setLineDash([2 * currentZoom, 2 * currentZoom]);
              ctx.strokeRect(drawX - 2 * currentZoom, drawY - 2 * currentZoom, (CHARACTER_DRAW_WIDTH + 4) * currentZoom, (CHARACTER_DRAW_HEIGHT + 4) * currentZoom);
              ctx.restore();
            }
            if (!sprite) return;
            drawCharacterSprite(ctx, sprite, { state: agent.snapshot.activity, moving, travelled: agent.walkDistance, elapsedSeconds: simulationTime / 1000 + agent.spriteIndex * 0.17, reducedMotion },
              { x: drawX, y: drawY, width: CHARACTER_DRAW_WIDTH * currentZoom, height: CHARACTER_DRAW_HEIGHT * currentZoom });
          },
        });
      }

      for (const pet of petsRef.current) {
        const sprite = assetsRef.current.get(PET_ASSETS[pet.spriteIndex]);
        if (!sprite) continue;
        const moving = pet.path.length > 0 || pet.moveProgress > 0;
        const frame = reducedMotion ? 0 : Math.floor(simulationTime / (moving ? 170 : 330)) % 3;
        let sourceRow = 0;
        let sourceCol = moving ? frame : 3 + frame;
        if (pet.direction === "up") sourceRow = 1;
        if (pet.direction === "right" || pet.direction === "left") {
          sourceRow = 2;
          sourceCol = moving ? frame : 3;
        }
        const x = offset.x + (pet.x - PET_DRAW_SIZE / 2) * currentZoom;
        const y = offset.y + (pet.y - PET_DRAW_SIZE) * currentZoom;
        drawables.push({
          z: pet.y + 7,
          draw: () => {
            if (pet.direction === "left") {
              ctx.save();
              ctx.translate(x + PET_DRAW_SIZE * currentZoom, 0);
              ctx.scale(-1, 1);
              ctx.drawImage(sprite, sourceCol * PET_FRAME_SIZE, sourceRow * PET_FRAME_SIZE, PET_FRAME_SIZE, PET_FRAME_SIZE, 0, y, PET_DRAW_SIZE * currentZoom, PET_DRAW_SIZE * currentZoom);
              ctx.restore();
            } else {
              ctx.drawImage(sprite, sourceCol * PET_FRAME_SIZE, sourceRow * PET_FRAME_SIZE, PET_FRAME_SIZE, PET_FRAME_SIZE, x, y, PET_DRAW_SIZE * currentZoom, PET_DRAW_SIZE * currentZoom);
            }
            if (pet.heartUntil > simulationTime) {
              ctx.fillStyle = "#ee6f8f";
              ctx.font = `700 ${8 * currentZoom}px sans-serif`;
              ctx.textAlign = "center";
              ctx.fillText("♥", offset.x + pet.x * currentZoom, y - 2 * currentZoom);
            }
          },
        });
      }

      drawables.sort((left, right) => left.z - right.z);
      drawables.forEach((drawable) => drawable.draw());

      for (const agent of agentsRef.current.values()) {
        const bubbleNode = bubbleRefs.current.get(agent.role);
        const bubble = activityBubble(agent, handoffRef.current, simulationTime);
        if (!bubbleNode) continue;
        if (!bubble) {
          bubbleNode.hidden = true;
          continue;
        }
        const bubbleTop = offset.y + (agent.y - CHARACTER_DRAW_HEIGHT - 3) * currentZoom - 13 * currentZoom;
        const bubbleCenter = offset.x + agent.x * currentZoom;
        bubbleNode.textContent = bubble;
        bubbleNode.hidden = false;
        bubbleNode.style.left = `${(bubbleCenter / CANVAS_WIDTH) * 100}%`;
        bubbleNode.style.top = `${(bubbleTop / CANVAS_HEIGHT) * 100}%`;
        bubbleNode.classList.toggle("is-warning", agent.snapshot.status === "waitingApproval");
        bubbleNode.classList.toggle("is-error", agent.snapshot.activity === "error");
      }

      // Labels are DOM text: readable at every zoom and display density.
      for (const zone of ZONE_RECTS) {
        const label = roomLabelRefs.current.get(zone.role);
        if (!label) continue;
        const x = offset.x + (zone.col + 0.55) * TILE_SIZE * currentZoom;
        const y = offset.y + (zone.row + (zone.row > WORLD_ROWS / 2 ? 1 : 0.1)) * TILE_SIZE * currentZoom;
        label.style.left = `${x / CANVAS_WIDTH * 100}%`;
        label.style.top = `${y / CANVAS_HEIGHT * 100}%`;
      }

      animationFrame = window.requestAnimationFrame(draw);
    };

    animationFrame = window.requestAnimationFrame(draw);
    return () => { window.cancelAnimationFrame(animationFrame); observer.disconnect(); };
  }, [reducedMotion]);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): TilePoint => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * (CANVAS_WIDTH / bounds.width);
    const y = (event.clientY - bounds.top) * (CANVAS_HEIGHT / bounds.height);
    const currentZoom = zoomRef.current;
    const offsetX = (CANVAS_WIDTH - WORLD_COLS * TILE_SIZE * currentZoom) / 2 + panRef.current.x;
    const offsetY = (CANVAS_HEIGHT - WORLD_ROWS * TILE_SIZE * currentZoom) / 2 + panRef.current.y;
    return {
      col: Math.floor((x - offsetX) / (TILE_SIZE * currentZoom)),
      row: Math.floor((y - offsetY) / (TILE_SIZE * currentZoom)),
    };
  };

  const handleCanvasClick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.moved) return;
    const tile = canvasPoint(event);
    for (const pet of petsRef.current) {
      if (Math.abs(pet.tileCol - tile.col) <= 1 && Math.abs(pet.tileRow - tile.row) <= 1) {
        pet.heartUntil = performance.now() + 1100;
        pet.nextWanderAt = performance.now() + 2200;
        return;
      }
    }
    const clickedAgent = Array.from(agentsRef.current.values()).find((agent) => Math.abs(agent.x / TILE_SIZE - (tile.col + 0.5)) < 0.8 && Math.abs(agent.y / TILE_SIZE - (tile.row + 0.5)) < 1.5);
    if (clickedAgent) {
      setSelectedRole(clickedAgent.role);
      return;
    }
    const selected = selectedRoleRef.current ? agentsRef.current.get(selectedRoleRef.current) : null;
    if (selected && !isRuntimeActive(selected.snapshot.status) && isWalkable(tile, BLOCKED_TILES)) {
      selected.manualUntil = performance.now() + 9000;
      routeAgent(selected, tile);
      return;
    }
    const zone = ZONE_RECTS.find((candidate) => tile.col >= candidate.col && tile.col < candidate.col + candidate.width && tile.row >= candidate.row && tile.row < candidate.row + candidate.height);
    if (zone) setSelectedRole(zone.role);
  };

  const setCharacter = (role: AgentRole, index: number) => {
    onAssignCharacter(role, index);
  };

  const setWorldZoom = (next: number) => {
    const value = Math.max(2, Math.min(4, next));
    setZoom(value);
    zoomRef.current = value;
    if (value === 2) panRef.current = { x: 0, y: 0 };
  };

  const selectedAgent = selectedRole ? agents.find((agent) => agent.role === selectedRole) ?? null : null;
  const selectedTask = selectedAgent ? currentTask(run, selectedAgent) : null;
  const completed = run?.tasks.filter((task) => task.status === "completed").length ?? 0;
  const total = run?.tasks.length ?? 0;

  return (
    <section className="world-shell pixel-world-shell" aria-live="polite">
      <div className="world-toolbar pixel-world-toolbar">
        <div className="world-title">
          <span className={`world-live-dot ${appServerReady ? "online" : bridgeConnected ? "bridge" : ""}`} />
          <div><strong>PIXEL AGENT OFFICE</strong><small>{appServerReady ? "LIVE RUNTIME" : bridgeConnected ? "BRIDGE CONNECTING" : "OFFLINE · AMBIENT MODE"}</small></div>
        </div>
         <div className="world-run-meta">
           <span>{modelLabel}</span>
           <span>{run ? `${completed}/${total} QUESTS · ${run.status.toUpperCase()}` : "AGENTS RESTING"}</span>
           <button type="button" className="pixel-results-button" onClick={onOpenResults}>▤ 결과 화면</button>
         </div>
         <div className="pixel-world-controls" aria-label="월드 화면 제어">
           <button type="button" onClick={() => setWorldZoom(zoom - 1)} disabled={zoom <= 2} aria-label="축소">−</button>
           <span>{zoom}×</span>
           <button type="button" onClick={() => setWorldZoom(zoom + 1)} disabled={zoom >= 4} aria-label="확대">+</button>
           <button type="button" onClick={() => { panRef.current = { x: 0, y: 0 }; setWorldZoom(2); }}>RESET</button>
           <button
             type="button"
             className={`pixel-motion-toggle ${animationEnabled ? "active" : ""}`}
             aria-pressed={animationEnabled}
             aria-label={animationEnabled ? "애니메이션 끄기" : "애니메이션 켜기"}
             onClick={onToggleAnimation}
           >
             {animationEnabled ? "애니 ON" : "애니 OFF"}
           </button>
         </div>
       </div>

      <div className={`pixel-asset-status ${assetStatus.errors.length ? "has-error" : ""}`} role="status">
        {assetStatus.loaded < assetStatus.total ? `이미지 준비 ${assetStatus.loaded}/${assetStatus.total}` : assetStatus.errors.length ? `이미지 ${assetStatus.errors.length}개 로드 실패` : "이미지 준비 완료"}
        <small className="pixel-motion-status">{animationEnabled ? " · 애니메이션 켜짐" : " · 동작 줄이기"}</small>
      </div>
      <div className="pixel-world-scrollport" tabIndex={0} role="region" aria-label="픽셀 사무실 · 작은 화면에서는 좌우로 스크롤할 수 있습니다">
      <div className="pixel-world-stage">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="pixel-world-canvas"
          aria-label="Codex 에이전트가 실제 런타임 상태에 따라 작업석으로 이동하는 픽셀 사무실"
          onPointerDown={(event) => {
            dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: panRef.current.x, panY: panRef.current.y, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId || zoomRef.current === 2) return;
            const scale = CANVAS_WIDTH / event.currentTarget.getBoundingClientRect().width;
            const dx = (event.clientX - drag.startX) * scale;
            const dy = (event.clientY - drag.startY) * scale;
            if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
            panRef.current = { x: drag.panX + dx, y: drag.panY + dy };
          }}
          onPointerUp={(event) => {
            handleCanvasClick(event);
            event.currentTarget.releasePointerCapture(event.pointerId);
            dragRef.current = null;
          }}
          onPointerCancel={() => { dragRef.current = null; }}
          // Scrolling over the map must never alter the fixed world zoom.
          onWheel={() => {}}
        />

        <div className="pixel-room-labels">
          {ZONE_RECTS.map((zone) => <button type="button" key={zone.role} ref={(node) => { if (node) roomLabelRefs.current.set(zone.role, node); else roomLabelRefs.current.delete(zone.role); }} onClick={() => setSelectedRole(zone.role)}>{ROLE_LABELS[zone.role]}</button>)}
        </div>

        <div className="pixel-world-bubble-layer" aria-hidden="true">
          {agents.map((agent) => (
            <div
              className="pixel-world-bubble"
              key={agent.role}
              ref={(node) => {
                if (node) bubbleRefs.current.set(agent.role, node);
                else bubbleRefs.current.delete(agent.role);
              }}
              hidden
            />
          ))}
        </div>

        {handoff && (
          <div className="pixel-handoff-toast">
            <span>✉</span><strong>{ROLE_LABELS[handoff.from]} → {ROLE_LABELS[handoff.to]}</strong><small>{handoff.title}</small>
          </div>
        )}

        {selectedAgent && selectedRole && (
          <aside className="pixel-agent-inspector">
            <button className="pixel-inspector-close" type="button" onClick={() => setSelectedRole(null)} aria-label="선택 닫기">×</button>
            <span className="pixel-inspector-role" style={{ backgroundColor: ROLE_COLORS[selectedRole] }}>{ROLE_LABELS[selectedRole]}</span>
            <h3>{selectedTask?.title || PET_PRESENTATIONS[selectedAgent.activity].label}</h3>
            <p>{selectedTask?.description || PET_PRESENTATIONS[selectedAgent.activity].verb}</p>
            <dl>
              <div><dt>STATUS</dt><dd>{selectedAgent.status}</dd></div>
              <div><dt>ACTIVITY</dt><dd>{selectedAgent.activity}</dd></div>
            </dl>
            <span className="pixel-character-label">CHARACTER</span>
            <div className="pixel-character-options">
              {CHARACTER_ASSETS.map((url, index) => (
                <button
                  type="button"
                  key={url}
                  className={characterIndexForRole(selectedRole, characterAssignments) === index ? "active" : ""}
                  onClick={() => setCharacter(selectedRole, index)}
                  aria-label={`캐릭터 ${index + 1}`}
                >
                  <span style={{ backgroundImage: `url(${url})` }} />
                </button>
              ))}
            </div>
            <small>{isRuntimeActive(selectedAgent.status) ? "작업 중에는 실제 이벤트가 이동과 애니메이션을 제어합니다." : "빈 바닥을 클릭하면 선택한 에이전트가 이동합니다."}</small>
          </aside>
        )}
      </div>
      </div>

      <div className="pixel-agent-roster" aria-label="에이전트 상태 목록">
        {agents.map((agent, index) => {
          const spriteIndex = characterIndexForRole(agent.role, characterAssignments);
          return (
            <button type="button" key={agent.id} className={selectedRole === agent.role ? "selected" : ""} onClick={() => setSelectedRole(agent.role)}>
              <span
                className="pixel-roster-portrait"
                style={{ backgroundImage: `url(${CHARACTER_ASSETS[spriteIndex % CHARACTER_ASSETS.length]})` }}
                aria-hidden="true"
              />
              <span><strong>{ROLE_LABELS[agent.role]}</strong><small>{PET_PRESENTATIONS[agent.activity].label}</small></span>
            </button>
          );
        })}
      </div>

      <div className="world-legend pixel-world-legend">
        <span><i className="legend-live" /> 상태 변화는 실제 App Server 이벤트</span>
        <span>캐릭터 클릭: 상세·외형 변경</span>
        <span>대기 캐릭터 선택 후 바닥 클릭: 이동</span>
        <span>펫 클릭: 교감</span>
        <span>확대 버튼: 줌, 드래그: 이동 · 휠 줌 비활성</span>
      </div>
    </section>
  );
}
