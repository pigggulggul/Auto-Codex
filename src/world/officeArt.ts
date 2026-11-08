import rawTiles from './roomBuilderTiles.json';

export const TILE = 48;
export const CHARACTER_HEIGHT = 96;
export const CHARACTER_FRONT_COLUMN = 18;
export const CHARACTER_IDLE_ROW = 96;
const ROOT = '/assets/Interiors/Room_Builder_subfiles_48x48/';
export type ArtKind = 'floor' | 'wall' | 'door' | 'path';
export type TileArt = { label: string; group: string; sheet: string; x: number; y: number; width: number; height: number; hidden?: boolean; parts?: number[] };
type Source = { file: keyof typeof rawTiles; label: string; kind: ArtKind };
export const ROOM_SOURCES: Source[] = [
  {file:'Room_Builder_Floors_48x48.png', label:'바닥', kind:'floor'},
  {file:'Room_Builder_Floor_Shadows_48x48.png', label:'바닥 그림자', kind:'floor'},
  {file:'Room_Builder_Floor_Paths_48x48.png', label:'길', kind:'path'},
  {file:'Room_Builder_Floor_Connectors_48x48.png', label:'길 연결', kind:'path'},
  {file:'Room_Builder_Walls_48x48.png', label:'벽', kind:'wall'},
  {file:'Room_Builder_3d_walls_48x48.png', label:'입체 벽', kind:'wall'},
  {file:'Room_Builder_borders_48x48.png', label:'벽 테두리', kind:'wall'},
  {file:'Room_Builder_baseboards_48x48.png', label:'걸레받이', kind:'wall'},
  {file:'Room_Builder_Arched_Entryways_48x48.png', label:'아치·통로 조각', kind:'door'},
  {file:'Room_Builder_Floor_Connectors_48x48.png', label:'문턱·연결', kind:'door'},
];
const art = (file: string, x: number, y: number, label: string, group: string, width = TILE, height = TILE): TileArt => ({ sheet:ROOT+file, x,y,label,group,width,height });
// Keep the original floor and wall indices stable for saved maps.
export const FLOOR_ART: TileArt[] = [
  art('Room_Builder_Floors_48x48.png',0,480,'밝은 나무','기본'), art('Room_Builder_Floors_48x48.png',0,96,'밝은 격자','기본'),
  art('Room_Builder_Floors_48x48.png',192,96,'아이보리','기본'), art('Room_Builder_Floors_48x48.png',576,96,'회색 석재','기본'),
  art('Room_Builder_Floors_48x48.png',384,96,'연분홍 격자','기본'), art('Room_Builder_Floors_48x48.png',192,576,'갈색 나무','기본'),
  art('Room_Builder_Floors_48x48.png',384,576,'진한 나무','기본'),
];
export const WALL_ART: TileArt[] = [
  art('Room_Builder_Walls_48x48.png',0,192,'회색 벽','기본'), art('Room_Builder_Walls_48x48.png',0,0,'무늬 벽','기본'),
  art('Room_Builder_Walls_48x48.png',0,96,'밝은 벽','기본'), art('Room_Builder_Walls_48x48.png',0,288,'크림 벽','기본'),
  art('Room_Builder_Walls_48x48.png',1056,288,'초록 벽','기본'),
];
// The old connector coordinates were transparent. Replace those four legacy styles with visible arch pieces.
export const DOOR_ART: TileArt[] = [0,48,96,144].map((x,i) => art('Room_Builder_Arched_Entryways_48x48.png',x,0,`아치 조각 ${i+1}`,'기본'));
export const PATH_ART: TileArt[] = [];
const lists: Record<ArtKind, TileArt[]> = {floor:FLOOR_ART, wall:WALL_ART, door:DOOR_ART, path:PATH_ART};

// A complete arch occupies 2×3 cells. Its exact source fragments are also registered
// independently so the map can save, edit and reload each cell without image rotation.
for (let arch = 0; arch < 5; arch++) {
  const parts: number[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) {
    const piece = art('Room_Builder_Arched_Entryways_48x48.png', arch*96+x*48, y*48, `아치 ${arch+1} ${x+1},${y+1}`, '아치 부품');
    piece.hidden = true; parts.push(DOOR_ART.push(piece)-1);
  }
  DOOR_ART.push({...art('Room_Builder_Arched_Entryways_48x48.png',arch*96,0,`아치 통로 ${arch+1}`, '완성된 아치',96,144),parts});
}
for (const source of ROOM_SOURCES) {
  const target = lists[source.kind];
  for (const [x,y,width,height] of rawTiles[source.file]) {
    target.push(art(source.file,x,y,`${source.label} · ${Math.floor(x/48)+1}열 ${Math.floor(y/48)+1}행`,source.label,width,height));
  }
}
export const artList = (kind: ArtKind) => lists[kind];
export const artFor = (kind: ArtKind, style: number): TileArt => lists[kind][style] ?? lists[kind][0];
export function placementFor(kind: ArtKind, style: number): { col: number; row: number; style: number }[] {
  const selected = artFor(kind, style);
  if (!selected?.parts) return [{col:0,row:0,style}];
  const cols = selected.width / TILE;
  return selected.parts.map((part, i) => ({ col:i % cols, row:Math.floor(i / cols), style:part }));
}
