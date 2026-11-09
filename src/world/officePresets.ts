import manifest from './assetManifest.json';
import { defaultOffice, indexAt, objectSize, validateOffice, type OfficeMap } from './officeMap';
import { ROLE_ORDER } from './pixelWorld';
import { condoHallStyles, condoInvisibleDoorStyle, condoLobbyStyles, gymSmallStyles, iceCreamStyles } from './officeArt';
import { EXTRA_INTERIOR_ASSETS } from './extraAssets';
import iceCreamComponents from './iceCreamComponents.json';

type Preset = { id: string; name: string; preview: string; theme: number; items: number[]; floor: number; wall: number; layout: number };
const preview = (folder: string, file: string) => `/assets/Home_Designs/${folder}/48x48/${file}_preview_48x48.png`;
// Reconstructed with individually editable tiles and objects, not original source coordinates.
export const OFFICE_PRESETS: Preset[] = [
  {id:'condo-hall',name:'공동주택 복도',preview:preview('Condominium_Designs','Condominium_Design_2'),theme:2,items:[14,15,16,102],floor:2,wall:2,layout:0},
  {id:'condo-lobby',name:'공동주택 로비',preview:preview('Condominium_Designs','Condominium_Design'),theme:26,items:[21,28,34,50],floor:2,wall:2,layout:1},
  {id:'home',name:'일반 주택',preview:preview('Generic_Home_Designs','Generic_Home_1'),theme:2,items:[14,15,16,102,106],floor:0,wall:3,layout:2},
  {id:'gym-small',name:'소형 체육관',preview:preview('Gym_Designs','Gym_2'),theme:8,items:[100,104,108,110],floor:3,wall:2,layout:0},
  {id:'gym',name:'체육관',preview:preview('Gym_Designs','Gym'),theme:8,items:[101,105,109,112,114],floor:3,wall:2,layout:2},
  {id:'icecream',name:'아이스크림 가게',preview:preview('Ice-Cream_Shop_Designs','Ice_Cream_Shop_Design'),theme:24,items:[14,16,17,100,101,102],floor:1,wall:4,layout:1},
  {id:'japanese',name:'일본식 주택',preview:preview('Japanese_Interiors_Home_Designs','Japanese_Home_1'),theme:20,items:[100,101,102,105,106],floor:5,wall:3,layout:2},
  {id:'museum-entry',name:'박물관 입구',preview:preview('Museum_Designs','Museum_entrance'),theme:22,items:[100,103,106,109],floor:3,wall:2,layout:0},
  {id:'museum-1',name:'박물관 전시실 1',preview:preview('Museum_Designs','Museum_room_1'),theme:22,items:[101,104,107,110,113],floor:3,wall:2,layout:1},
  {id:'museum-2',name:'박물관 전시실 2',preview:preview('Museum_Designs','Museum_room_2'),theme:22,items:[102,105,108,111,114],floor:5,wall:2,layout:2},
  {id:'museum-3',name:'박물관 전시실 3',preview:preview('Museum_Designs','Museum_room_3'),theme:22,items:[103,106,109,112,115],floor:3,wall:3,layout:0},
  {id:'museum-4',name:'박물관 기념품점',preview:preview('Museum_Designs','Museum_room_4'),theme:22,items:[104,107,110,113,116],floor:3,wall:2,layout:1},
  {id:'shooting',name:'사격장',preview:preview('Shooting_Range_Designs','Shooting_Range_Design'),theme:25,items:[1,10,11,13,23],floor:0,wall:2,layout:2},
  {id:'tv',name:'방송 스튜디오',preview:preview('TV_Studio_Designs','Tv_Studio_Design'),theme:23,items:[1,2,12,14,16],floor:3,wall:2,layout:1},
];
const positions = [
  [[1,1],[5,1],[9,1],[13,1],[16,1],[1,10],[16,10]],
  [[2,1],[6,1],[10,1],[14,1],[1,5],[16,5],[1,10]],
  [[1,1],[7,1],[13,1],[1,5],[16,5],[1,10],[16,10]],
] as const;
function itemPath(theme: number, number: number): string | undefined {
  return [...manifest.interiors, ...EXTRA_INTERIOR_ASSETS].find(path => path.split('/').at(-2)?.startsWith(`${theme}_`) && path.endsWith(`_${number}.png`));
}
export function createOfficePreset(id: string): OfficeMap | null {
  const preset = OFFICE_PRESETS.find(item => item.id === id);
  if (!preset) return null;
  const map = defaultOffice();
  map.styles = map.cells.map(cell => cell === 'wall' ? preset.wall : cell === 'floor' ? preset.floor : 0);
  if (id === 'icecream') {
    map.cells.fill('wall');
    map.styles.fill(condoLobbyStyles[0].wallStyle);
    for (const tile of iceCreamStyles) {
      const i=indexAt(map,tile.col+1,tile.row+1);
      map.cells[i]=tile.wall ? 'wall' : 'floor';
      map.styles[i]=tile.wall ? tile.wallStyle : tile.floorStyle;
    }
    for (const col of [6,7]) {
      map.cells[indexAt(map,col,11)]='floor';
      map.styles[indexAt(map,col,11)]=condoLobbyStyles[0].floorStyle;
      map.cells[indexAt(map,col,12)]='door';
      map.styles[indexAt(map,col,12)]=condoInvisibleDoorStyle;
    }
    const points = [[2,8],[3,8],[4,8],[5,8],[7,8],[8,8],[9,8],[10,8]] as const;
    map.stationLayout = Object.fromEntries(ROLE_ORDER.map((role,i)=>[role,{col:points[i][0],row:points[i][1]}])) as NonNullable<OfficeMap['stationLayout']>;
    map.objects=iceCreamComponents.map((part,i)=>{
      const px=part.x+48,py=part.y+48;
      return {id:`preset-icecream-${i}`,asset:part.asset,col:Math.floor(px/48),row:Math.floor(py/48),offsetX:px%48,offsetY:py%48,blocks:false,overlay:true};
    });
    return map;
  }
  if (id === 'gym-small') {
    map.cells.fill('wall');
    map.styles.fill(condoLobbyStyles[0].wallStyle);
    for (const tile of gymSmallStyles) {
      const i = indexAt(map, tile.col + 1, tile.row + 1);
      map.cells[i] = tile.wall ? 'wall' : 'floor';
      map.styles[i] = tile.wall ? tile.wallStyle : tile.floorStyle;
    }
    const points = [[3,4],[5,4],[7,4],[9,4],[3,6],[5,6],[7,6],[9,6]] as const;
    map.stationLayout = Object.fromEntries(ROLE_ORDER.map((role, i) => [role, {col:points[i][0], row:points[i][1]}])) as NonNullable<OfficeMap['stationLayout']>;
    const placements: Array<[number,number,number]> = [
      [131,48,16],[172,288,48],[186,336,48],[169,192,48],[184,144,75],
      [159,480,81],[163,192,117],[204,48,144],[210,96,138],[188,448,192],[143,90,225],[125,240,240],
    ];
    map.objects = placements.map(([number,x,y], i) => {
      const asset = itemPath(8,number);
      if (!asset) throw new Error(`Missing gym asset ${number}`);
      const px=x+48,py=y+48;
      return {id:`preset-gym-small-${i}`,asset,col:Math.floor(px/48),row:Math.floor(py/48),offsetX:px%48,offsetY:py%48,blocks:false,overlay:true};
    });
    return map;
  }
  if (id === 'condo-hall') {
    map.cells.fill('wall');
    map.styles.fill(condoLobbyStyles[0].wallStyle);
    for (const tile of condoHallStyles) {
      const i = indexAt(map, tile.col + 1, tile.row + 1);
      map.cells[i] = tile.wall ? 'wall' : 'floor';
      map.styles[i] = tile.wall ? tile.wallStyle : tile.floorStyle;
    }
    const points = [[3,5],[4,5],[5,5],[6,5],[8,5],[9,5],[11,5],[12,5]] as const;
    map.stationLayout = Object.fromEntries(ROLE_ORDER.map((role, i) => [role, {col:points[i][0], row:points[i][1]}])) as NonNullable<OfficeMap['stationLayout']>;
    const placements: Array<[number,number,number,number,number?]> = [
      [26,85,80,0],[26,85,224,0],[26,86,368,0],[26,86,512,0],
      [26,70,96,96],[26,69,240,96],[26,69,384,96],[26,70,528,96],
      [26,72,192,80],[26,71,576,48],[2,17,144,32],[2,17,480,32],[26,91,288,32],
      [2,16,48,192,48],[2,16,576,192,48],
      [26,87,48,48],[26,87,192,48],[26,87,423,48],[26,87,567,48],
      [26,90,96,240],[26,90,480,240],
    ];
    map.objects = placements.map(([theme,number,x,y,clipHeight], i) => {
      const asset = itemPath(theme,number);
      if (!asset) throw new Error(`Missing hallway asset ${theme}/${number}`);
      const px=x+48, py=y+48;
      return {id:`preset-condo-hall-${i}`,asset,col:Math.floor(px/48),row:Math.floor(py/48),offsetX:px%48,offsetY:py%48,blocks:false,overlay:true,...(clipHeight ? {clipHeight} : {})};
    });
    return map;
  }
  if (id === 'condo-lobby') {
    map.cells.fill('wall');
    map.styles.fill(condoLobbyStyles[0].wallStyle);
    for (const tile of condoLobbyStyles) {
      const i = indexAt(map, tile.col + 1, tile.row + 1);
      map.cells[i] = tile.wall ? 'wall' : 'floor';
      map.styles[i] = tile.wall ? tile.wallStyle : tile.floorStyle;
    }
    map.cells[indexAt(map,3,map.height-1)] = 'door';
    map.cells[indexAt(map,11,map.height-1)] = 'door';
    map.styles[indexAt(map,3,map.height-1)] = condoInvisibleDoorStyle;
    map.styles[indexAt(map,11,map.height-1)] = condoInvisibleDoorStyle;
    const points = [[2,7],[4,7],[11,7],[13,7],[2,10],[5,10],[10,10],[13,10]] as const;
    map.stationLayout = Object.fromEntries(ROLE_ORDER.map((role, i) => [role, {col:points[i][0], row:points[i][1]}])) as NonNullable<OfficeMap['stationLayout']>;
    // Verified source-layer matches; the 48px inset leaves room for the
    // editor's existing perimeter. Walls and other objects remain incomplete.
    const placements: Array<[number, number, number]> = [
      [10,96,0], [12,144,0], [10,480,0], [12,528,0],
      [13,112,0], [13,496,0], [46,288,384], [48,336,384],
      [65,291,339], [65,99,480], [65,483,480],
      [67,99,195], [67,483,195], [80,240,163], [82,352,157],
    ];
    map.objects = placements.map(([number,x,y], i) => {
      const asset = itemPath(26, number);
      if (!asset) throw new Error(`Missing condominium asset ${number}`);
      const px = x + 48, py = y + 48;
      return {id:`preset-condo-lobby-${i}`,asset,col:Math.floor(px/48),row:Math.floor(py/48),offsetX:px%48,offsetY:py%48,blocks:false,overlay:true};
    });
    return map;
  }
  for (const number of preset.items) {
    const asset = itemPath(preset.theme, number);
    if (!asset) continue;
    const size = objectSize({asset});
    // Try every preferred slot for every object; one failed object must not
    // consume the slots needed by the remaining objects.
    const slots: ReadonlyArray<readonly [number, number]> = [
      ...positions[preset.layout],
      ...Array.from({length:(map.width - 2) * (map.height - 2)}, (_, i) => [1 + i % (map.width - 2), 1 + Math.floor(i / (map.width - 2))] as const),
    ];
    for (const [col,row] of slots) {
      if (col + size.cols >= map.width || row + size.rows >= map.height) continue;
      const object = {id:`preset-${id}-${number}`,asset,col,row,blocks:true};
      const candidate = {...map,objects:[...map.objects,object]};
      if (!validateOffice(candidate)) { map.objects.push(object); break; }
    }
  }
  // Retain an explicit door in every reconstructed design.
  map.styles[indexAt(map,9,map.height-1)] = 0;
  return map;
}
