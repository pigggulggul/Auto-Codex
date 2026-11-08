import type { AgentRole } from '../../shared/protocol';
import { ROLE_ORDER } from './pixelWorld';
import dimensions from './assetDimensions.json';
import { placementFor, type ArtKind } from './officeArt';

export type Cell = 'floor' | 'wall' | 'door' | 'path' | 'empty';
export type OfficeObject = { id: string; asset: string; col: number; row: number; blocks: boolean; animated?: boolean };
export type OfficeMap = { width: number; height: number; cells: Cell[]; objects: OfficeObject[]; styles?: number[] };
export const DESK = '/assets/Interiors/Theme_Sorter_Singles_48x48/5_Classroom_and_Library_Singles_48x48/Classroom_and_Library_Singles_48x48_25.png';
export const stations: Record<AgentRole, { col: number; row: number }> = Object.fromEntries(ROLE_ORDER.map((role, i) => [role, { col: 3 + (i % 4) * 4, row: i < 4 ? 4 : 9 }])) as Record<AgentRole, { col: number; row: number }>;
export const indexAt = (map: OfficeMap, col: number, row: number) => row * map.width + col;
export function placeArt(map: OfficeMap, kind: ArtKind, style: number, col: number, row: number): OfficeMap | null {
  const parts = placementFor(kind, style);
  if (parts.some(part => col + part.col < 0 || row + part.row < 0 || col + part.col >= map.width || row + part.row >= map.height)) return null;
  const cells = [...map.cells], styles = map.styles ? [...map.styles] : cells.map(() => 0);
  for (const part of parts) { const i = indexAt(map, col + part.col, row + part.row); cells[i] = kind; styles[i] = part.style; }
  return {...map, cells, styles};
}
const imageDimensions: Record<string, number[]> = dimensions;
export function objectSize(object: Pick<OfficeObject, 'asset'>): { width: number; height: number; cols: number; rows: number } {
  const [width, height] = imageDimensions[object.asset] ?? [48, 48];
  return { width, height, cols: Math.ceil(width / 48), rows: Math.ceil(height / 48) };
}
export function objectCovers(object: OfficeObject, col: number, row: number): boolean {
  const { cols, rows } = objectSize(object);
  return col >= object.col && col < object.col + cols && row >= object.row && row < object.row + rows;
}
export function defaultOffice(): OfficeMap {
  const width = 18, height = 13;
  const cells = Array.from({ length: width * height }, (_, i): Cell => {
    const col = i % width, row = Math.floor(i / width);
    if (row === height - 1 && col === 9) return 'door';
    return col === 0 || row === 0 || col === width - 1 || row === height - 1 ? 'wall' : 'floor';
  });
  return { width, height, cells, objects: ROLE_ORDER.map((role, i) => ({ id: `desk-${role}`, asset: DESK, col: 3 + (i % 4) * 4, row: i < 4 ? 2 : 7, blocks: true })) };
}

/** All floor must be enclosed and reachable; explicit doors are traversable boundaries. */
export function validateOffice(map: OfficeMap): string | null {
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width < 18 || map.height < 13 || map.width > 40 || map.height > 30 || map.cells.length !== map.width * map.height) return '맵 크기가 올바르지 않습니다.';
  if (map.styles && (map.styles.length !== map.cells.length || map.styles.some(style => !Number.isInteger(style) || style < 0 || style > 10000))) return '타일 스타일이 올바르지 않습니다.';
  const blocked = new Set<number>();
  for (const object of map.objects) {
    const { cols, rows } = objectSize(object);
    if (!Number.isInteger(object.col) || !Number.isInteger(object.row) || object.col < 0 || object.row < 0 || object.col + cols > map.width || object.row + rows > map.height) return '맵 밖에 오브젝트가 있습니다.';
    for (let row = object.row; row < object.row + rows; row++) for (let col = object.col; col < object.col + cols; col++) {
      const i = indexAt(map, col, row);
      if (map.cells[i] !== 'floor' && map.cells[i] !== 'path') return '오브젝트는 바닥 위에 놓아야 합니다.';
      if (object.blocks && blocked.has(i)) return '가구가 서로 겹칩니다.';
      if (object.blocks) blocked.add(i);
    }
  }
  for (let row = 0; row < map.height; row++) for (let col = 0; col < map.width; col++) {
    const cell = map.cells[indexAt(map, col, row)];
    if (!['floor', 'wall', 'door', 'path', 'empty'].includes(cell)) return '알 수 없는 맵 타일입니다.';
    const edge = col === 0 || row === 0 || col === map.width - 1 || row === map.height - 1;
    if (edge && cell !== 'wall' && cell !== 'door') return '외벽에 빈 곳이 있습니다. 벽 또는 문으로 막아 주세요.';
    if (!edge && cell === 'empty') return '벽 안의 빈 곳에 바닥을 깔아 주세요.';
  }
  const traversable = (i: number) => (map.cells[i] === 'floor' || map.cells[i] === 'path' || map.cells[i] === 'door') && !blocked.has(i);
  const start = indexAt(map, stations.researcher.col, stations.researcher.row);
  if (!traversable(start)) return '작업석 앞을 비워 주세요.';
  const visited = new Set([start]), queue = [start];
  for (let p = 0; p < queue.length; p++) {
    const i = queue[p], col = i % map.width, row = Math.floor(i / map.width);
    for (const [x, y] of [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]]) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const next = indexAt(map, x, y);
      if (!visited.has(next) && traversable(next)) { visited.add(next); queue.push(next); }
    }
  }
  if (map.cells.some((_, i) => traversable(i) && !visited.has(i))) return '벽이나 가구가 통로를 막고 있습니다.';
  if (Object.values(stations).some(({col, row}) => !visited.has(indexAt(map, col, row)))) return '모든 작업석 앞까지 통로가 이어져야 합니다.';
  return null;
}

export function expandOffice(map: OfficeMap): OfficeMap {
  if (map.width >= 40 || map.height >= 30) return map;
  const width = Math.min(40, map.width + 2), height = Math.min(30, map.height + 2);
  const cells = Array.from({length: width * height}, (_, i): Cell => {
    const x = i % width, y = Math.floor(i / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return x === 9 && y === height - 1 ? 'door' : 'wall';
    if (x >= map.width - 1 || y >= map.height - 1) return 'floor';
    return map.cells[indexAt(map, x, y)];
  });
  const styles = cells.map((_, i) => { const x = i % width, y = Math.floor(i / width); return x < map.width - 1 && y < map.height - 1 ? map.styles?.[indexAt(map, x, y)] ?? 0 : 0; });
  return { ...map, width, height, cells, styles };
}
