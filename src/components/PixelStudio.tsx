import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRole, PetState, RunSnapshot } from '../../shared/protocol';
import { PET_PRESENTATIONS } from '../lib/petCatalog';
import { taskSkillLabel } from '../lib/taskSkill';
import { ROLE_LABELS, ROLE_ORDER } from '../world/pixelWorld';
import manifest from '../world/assetManifest.json';
import { EXTRA_INTERIOR_ASSETS } from '../world/extraAssets';
import { defaultOffice, eraseTopObject, expandOffice, indexAt, objectSize, placeArt, stations, stationsForMap, validStationLayout, validateOffice, type OfficeMap, type OfficeObject } from '../world/officeMap';
import { artFor, CHARACTER_FRONT_COLUMN, CHARACTER_HEIGHT, CHARACTER_IDLE_ROW, placementFor, TILE } from '../world/officeArt';
import { defaultAppearance, type Appearance } from '../world/officeAppearance';
import { createOfficePreset, OFFICE_PRESETS } from '../world/officePresets';
import { StudioPalette, CharacterEditor, assetName, type StudioTool } from './StudioEditors';
type Props = {
  run: RunSnapshot | null;
  bridgeConnected: boolean;
  appServerReady: boolean;
  soloState: PetState;
  activeRole: AgentRole;
  modelLabel: string;
  animationEnabled: boolean;
  onToggleAnimation: () => void;
  onOpenResults: () => void;
};
import './pixelStudio.css';

const SIZE = TILE;
const MAP_KEY = 'auto-codex.pixel-studio.map.v1';
const CHARACTER_KEY = 'auto-codex.pixel-studio.appearance.v1';
const groups = manifest.parts;
function readMap(): OfficeMap {
  try {
    const value = JSON.parse(localStorage.getItem(MAP_KEY) || 'null') as OfficeMap | null;
    if (value && Number.isInteger(value.width) && Number.isInteger(value.height) && value.width >= 18 && value.height >= 13 && value.width <= 40 && value.height <= 30
      && Array.isArray(value.cells) && value.cells.length === value.width * value.height && value.cells.every(cell => ['floor','wall','door','path','empty'].includes(cell))
      && (!value.styles || (Array.isArray(value.styles) && value.styles.length === value.cells.length && value.styles.every(style => Number.isInteger(style) && style >= 0 && style <= 10000)))
      && (value.stationLayout === undefined || validStationLayout(value.stationLayout, value.width, value.height))
      && Array.isArray(value.objects) && value.objects.length <= 1200
      && value.objects.every(obj => obj && typeof obj.id === 'string' && typeof obj.blocks === 'boolean'
        && Number.isInteger(obj.col) && Number.isInteger(obj.row) && obj.col >= 0 && obj.row >= 0 && obj.col < value.width && obj.row < value.height
        && (obj.offsetX === undefined || (Number.isInteger(obj.offsetX) && obj.offsetX >= 0 && obj.offsetX < SIZE))
        && (obj.offsetY === undefined || (Number.isInteger(obj.offsetY) && obj.offsetY >= 0 && obj.offsetY < SIZE))
        && (obj.overlay === undefined || (obj.overlay === true && !obj.blocks))
        && (obj.clipHeight === undefined || (Number.isInteger(obj.clipHeight) && obj.clipHeight > 0 && obj.clipHeight <= objectSize({asset:obj.asset}).height && !obj.animated))
        && (obj.animated === true ? manifest.animated.includes(obj.asset) : manifest.interiors.includes(obj.asset) || EXTRA_INTERIOR_ASSETS.includes(obj.asset)))) {
      // Before native-size footprints were introduced, the default desks occupied one tile.
      // Move only untouched default placements; custom layouts remain available to repair.
      if (!value.styles) value.objects = value.objects.map(obj => {
        const role = ROLE_ORDER.find(r => obj.id === `desk-${r}`);
        if (!role) return obj;
        const station = stations[role];
        return obj.asset === defaultOffice().objects.find(item => item.id === obj.id)?.asset && obj.col === station.col && obj.row === station.row - 1 ? {...obj, row:obj.row - 1} : obj;
      });
      return value;
    }
  } catch { /* use default */ }
  return defaultOffice();
}
function readAppearances(): Partial<Record<AgentRole, Appearance>> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHARACTER_KEY) || '{}') as Partial<Record<AgentRole, Appearance>>;
    const result: Partial<Record<AgentRole, Appearance>> = {};
    for (const role of ROLE_ORDER) {
      const v = parsed[role]; if (!v || !['adult', 'kid'].includes(v.type)) continue;
      const adult = v.type === 'adult';
      if ((adult ? groups.Bodies : groups.Bodies_kids).includes(v.body) && (adult ? groups.Eyes : groups.Eyes_kids).includes(v.eyes) && (adult ? groups.Outfits : groups.Outfits_kids).includes(v.outfit) && (!v.hair || (adult ? groups.Hairstyles : groups.Hairstyles_kids).includes(v.hair)) && (!v.accessory || groups.Accessories.includes(v.accessory))) result[role] = v;
    }
    return result;
  } catch { return {}; }
}

export function PixelStudio({ run, bridgeConnected, appServerReady, soloState, activeRole, modelLabel, animationEnabled, onToggleAnimation, onOpenResults }: Props) {
  const [saved, setSaved] = useState<OfficeMap>(readMap);
  const [draft, setDraft] = useState<OfficeMap>(saved);
  const [editing, setEditing] = useState(false);
  const [presetId, setPresetId] = useState(OFFICE_PRESETS[0].id);
  const [tool, setTool] = useState<StudioTool>('wall');
  const [tileStyle, setTileStyle] = useState(0);
  const [objectPath, setObjectPath] = useState(manifest.interiors.find(path => path.includes('Classroom_and_Library_Singles_48x48_25.png')) || manifest.interiors[0]);
  const [objectKind, setObjectKind] = useState<'interior' | 'animated'>('interior');
  const [blocks, setBlocks] = useState(true);
  const [selectedRole, setSelectedRole] = useState<AgentRole | null>(null);
  const [appearances, setAppearances] = useState(readAppearances);
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState({ col: 1, row: 1 });
  const [reduced, setReduced] = useState(false);
  const map = editing ? draft : saved;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<{ col: number; row: number } | null>(null);
  const agents = useMemo(() => ROLE_ORDER.map(role => {
    const live = run?.agents.find(agent => agent.role === role);
    const soloActive = role === activeRole && !run && !['idle', 'connecting', 'success', 'error'].includes(soloState);
    return { role, activity: live?.activity ?? (role === activeRole && !run ? soloState : 'idle'), status: live?.status ?? (soloActive ? 'working' : 'idle'), task: run?.tasks.find(task => task.id === live?.currentTaskId) };
  }), [run, activeRole, soloState]);
  const error = validateOffice(draft);
  const preset = OFFICE_PRESETS.find(item => item.id === presetId)!;
  const appearance = selectedRole ? appearances[selectedRole] || defaultAppearance(selectedRole) : null;

  useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const candidate = (col: number, row: number): OfficeMap | null => {
    if (tool === 'object') {
      const obj: OfficeObject = { id: `object-${Date.now()}`, col, row, asset: objectPath, blocks, animated: objectKind === 'animated' };
      return { ...draft, objects: [...draft.objects, obj] };
    }
    if (tool === 'erase') return eraseTopObject(draft, col, row);
    if (tool !== 'empty') return placeArt(draft, tool, tileStyle, col, row);
    const cells = [...draft.cells]; cells[indexAt(draft, col, row)] = tool;
    const styles = draft.styles ? [...draft.styles] : cells.map(() => 0); styles[indexAt(draft, col, row)] = tileStyle;
    return { ...draft, cells, styles };
  };
  const apply = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= draft.width || row >= draft.height) return;
    const next = candidate(col, row);
    if (!next) { setStatus('선택한 타일 전체가 맵 안에 들어가야 합니다.'); return; }
    if (tool === 'object') { const why = validateOffice(next); if (why) { setStatus(why); return; } }
    setDraft(next); setStatus('편집 중입니다. 저장해야 화면에 적용됩니다.');
  };
  const hoverValid = useMemo(() => {
    if (!editing || !hover) return false;
    if (tool === 'object') return !validateOffice({ ...draft, objects: [...draft.objects, { id:'hover-preview', col:hover.col, row:hover.row, asset:objectPath, blocks, animated:objectKind === 'animated' }] });
    if (tool === 'floor' || tool === 'wall' || tool === 'door' || tool === 'path') {
      if (!placeArt(draft, tool, tileStyle, hover.col, hover.row)) return false;
    }
    return hover.col > 0 && hover.row > 0 && hover.col < draft.width - 1 && hover.row < draft.height - 1 || tool === 'wall' || tool === 'door';
  }, [editing, hover, tool, draft, objectPath, blocks, objectKind, tileStyle]);
  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return;
    let frame = 0, disposed = false;
    const image = (url: string) => {
      let result = images.current.get(url);
      if (!result) { result = new Image(); result.onerror = () => setStatus(`이미지를 불러오지 못했습니다: ${assetName(url)}`); result.src = url; images.current.set(url, result); }
      return result.complete && result.naturalWidth > 0 ? result : null;
    };
    const draw = (time: number) => {
      if (disposed) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.imageSmoothingEnabled = false;
      const paintTile = (art: ReturnType<typeof artFor>, x: number, y: number) => {
        const sheet = image(art.sheet); if (!sheet) return;
        const width = Math.min(art.width,SIZE), height = Math.min(art.height,SIZE);
        ctx.drawImage(sheet, art.x, art.y, width, height, x, y, width, height);
      };
      const wallAt = (col: number, row: number) => col >= 0 && row >= 0 && col < map.width && row < map.height && ['wall','door'].includes(map.cells[indexAt(map,col,row)]);
      for (let row = 0; row < map.height; row++) for (let col = 0; col < map.width; col++) {
        const index = indexAt(map, col, row), cell = map.cells[index], style = map.styles?.[index] ?? 0, x = col * SIZE, y = row * SIZE;
        if (cell === 'empty') { ctx.fillStyle = '#323844'; ctx.fillRect(x, y, SIZE, SIZE); continue; }
        const selectedArt = cell === 'floor' || cell === 'wall' || cell === 'path' || cell === 'door' ? artFor(cell,style) : null;
        if (!selectedArt?.replaceBase) { ctx.fillStyle = '#cdb898'; ctx.fillRect(x, y, SIZE, SIZE); paintTile(artFor('floor', 0), x, y); }
        if (cell === 'floor') paintTile(artFor('floor',style), x, y);
        if (cell === 'path') paintTile(artFor('path',style), x, y);
        if (cell === 'wall') {
          const left=wallAt(col-1,row), right=wallAt(col+1,row), up=wallAt(col,row-1), down=wallAt(col,row+1), h=left||right, v=up||down, art=artFor('wall',style);
          if (style === 0) {
            // Legacy/default walls use the sheet's authored grey edges and corners.
            // User-selected pieces (other styles) are always drawn exactly as authored.
            let sx=8, sy=0;
            if (h && v) { sx = right && !left ? 10 : 13; sy = up && !down ? 5 : 0; }
            else if (v && !h) { sx = col > map.width / 2 ? 14 : 9; sy = 2; }
            else if (row === map.height - 1) { sx = 11; sy = 5; }
            paintTile({...art,sheet:'/assets/Interiors/Room_Builder_subfiles_48x48/Room_Builder_3d_walls_48x48.png',x:sx*SIZE,y:sy*SIZE},x,y);
          } else paintTile(art,x,y);
        }
        if (cell === 'door') paintTile(artFor('door', style), x, y);
      }
      for (const obj of map.objects) {
        // GIFs are animated by the browser; use the first PNG frame when motion is disabled.
        const source = obj.animated && (!animationEnabled || reduced) ? obj.asset.replace('/gif/', '/spritesheets/').replace(/\.gif$/, '.png') : obj.asset;
        const pic = image(source); if (!pic) continue;
        const animatedStill = obj.animated && (!animationEnabled || reduced);
        const { width, height } = objectSize(obj);
        const sw = animatedStill ? width : pic.naturalWidth, sh = animatedStill || obj.clipHeight !== undefined ? height : pic.naturalHeight;
        ctx.drawImage(pic, 0, 0, sw, sh, obj.col * SIZE + (obj.offsetX ?? 0), obj.row * SIZE + (obj.offsetY ?? 0), width, height);
      }
      for (const agent of agents) {
        const place = stationsForMap(map)[agent.role], look = appearances[agent.role] || defaultAppearance(agent.role);
        // Each authored cell is 48×96; front-facing idle occupies columns 18–23.
        const tick = !animationEnabled || reduced ? 0 : Math.floor(time / 350) % 6;
        for (const url of [look.body, look.eyes, look.outfit, look.hair, look.accessory].filter(Boolean)) {
          const pic = image(url); if (pic) ctx.drawImage(pic, (CHARACTER_FRONT_COLUMN + tick) * SIZE, CHARACTER_IDLE_ROW, SIZE, CHARACTER_HEIGHT, place.col * SIZE, (place.row + 1) * SIZE - CHARACTER_HEIGHT, SIZE, CHARACTER_HEIGHT);
        }
        if (agent.status === 'working' || agent.status === 'waitingApproval') { ctx.fillStyle = agent.status === 'waitingApproval' ? '#d07731' : '#578e6a'; ctx.fillRect(place.col * SIZE + 34, place.row * SIZE + 5, 8, 8); }
      }
      if (editing && hover) {
        const parts = tool === 'floor' || tool === 'wall' || tool === 'door' || tool === 'path' ? placementFor(tool,tileStyle) : [{col:0,row:0,style:0}];
        const size = tool === 'object' ? objectSize({asset:objectPath}) : {cols:Math.max(...parts.map(p=>p.col))+1,rows:Math.max(...parts.map(p=>p.row))+1};
        ctx.fillStyle = hoverValid ? 'rgba(33,170,90,.5)' : 'rgba(220,47,47,.55)'; ctx.fillRect(hover.col * SIZE, hover.row * SIZE, size.cols * SIZE, size.rows * SIZE);
      }
      if (hover) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(hover.col * SIZE + 1, hover.row * SIZE + 1, SIZE - 2, SIZE - 2); }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { disposed = true; cancelAnimationFrame(frame); };
  }, [map, agents, appearances, animationEnabled, reduced, editing, hover, hoverValid, tool, tileStyle, objectPath, blocks, objectKind]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => { const rect = e.currentTarget.getBoundingClientRect(); return { col: Math.floor((e.clientX - rect.left) / SIZE), row: Math.floor((e.clientY - rect.top) / SIZE) }; };
  const choose = (col: number, row: number) => {
    if (editing) { apply(col, row); return; }
    const activeStations = stationsForMap(map);
    const role = ROLE_ORDER.find(item => activeStations[item].col === col && (activeStations[item].row === row || activeStations[item].row - 1 === row)); if (role) setSelectedRole(role);
  };
  const save = () => { const why = validateOffice(draft); if (why) { setStatus(why); return; } try { localStorage.setItem(MAP_KEY, JSON.stringify(draft)); setSaved(draft); setEditing(false); setStatus('맵을 이 브라우저에 저장했습니다.'); } catch { setStatus('저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.'); } };
  const changeAppearance = (next: Appearance) => { if (!selectedRole) return; const value = { ...appearances, [selectedRole]: next }; try { localStorage.setItem(CHARACTER_KEY, JSON.stringify(value)); setAppearances(value); setStatus('캐릭터를 이 브라우저에 저장했습니다.'); } catch { setStatus('캐릭터를 저장하지 못했습니다.'); } };

  return <section className="world-shell pixel-studio">
    <div className="pixel-studio-bar"><div><strong>PIXEL AGENT OFFICE</strong><small>{appServerReady ? 'LIVE RUNTIME' : bridgeConnected ? 'BRIDGE CONNECTING' : 'OFFLINE'} · {modelLabel}</small></div><div className="pixel-studio-actions"><button type="button" onClick={onOpenResults}>결과 화면</button><button type="button" aria-pressed={animationEnabled} onClick={onToggleAnimation}>{animationEnabled ? '애니 ON' : '애니 OFF'}</button>{!editing ? <button type="button" onClick={() => { setDraft(saved); setEditing(true); setSelectedRole(null); }}>맵 편집</button> : <><button type="button" onClick={() => setDraft(expandOffice(draft))}>맵 확장</button><button type="button" onClick={save}>저장</button><button type="button" onClick={() => { setDraft(saved); setEditing(false); setStatus('편집을 취소했습니다.'); }}>취소</button></>}</div></div>
    {editing && <><details className="studio-presets"><summary>공간 프리셋</summary><div className="studio-preset-content"><img src={preset.preview} alt={`${preset.name} 원본 참고 이미지`} /><div><label>디자인 선택 <select value={presetId} onChange={e => setPresetId(e.target.value)}>{OFFICE_PRESETS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><p>원본을 참고해 편집 가능한 타일과 오브젝트로 재구성했습니다. 원본과 배치가 다를 수 있습니다.</p><button type="button" onClick={() => { if (!window.confirm('현재 편집 중인 내용을 프리셋으로 바꾸시겠습니까? 저장된 맵은 저장하기 전까지 유지됩니다.')) return; const next = createOfficePreset(presetId); if (next) { setDraft(next); setStatus(`${preset.name} 프리셋을 불러왔습니다. 저장하면 적용됩니다.`); } }}>프리셋 불러오기</button></div></div></details><StudioPalette tool={tool} setTool={setTool} style={tileStyle} setStyle={setTileStyle} objectPath={objectPath} setObjectPath={setObjectPath} kind={objectKind} setKind={kind => { setObjectKind(kind); setObjectPath((kind === 'interior' ? manifest.interiors : manifest.animated)[0]); }} blocks={blocks} setBlocks={setBlocks} motion={animationEnabled && !reduced}/></>}
    <p className="pixel-studio-status" role="status">{status || (editing ? error || '저장할 수 있는 맵입니다.' : validateOffice(saved) ? `저장된 맵을 편집해 배치를 확인하세요: ${validateOffice(saved)}` : '캐릭터를 선택해 외형과 실제 상태를 확인하세요. 드래그하여 맵을 이동합니다.')}{editing && error && status !== error ? ` ${error}` : ''}</p>
    <div ref={viewportRef} className="pixel-studio-viewport" role="region" aria-label="픽셀 사무실 맵. 드래그 또는 스크롤로 이동" tabIndex={0}>
      <canvas ref={canvasRef} width={map.width * SIZE} height={map.height * SIZE} tabIndex={0} aria-label="사무실 맵. 방향키로 위치 선택 후 Enter로 적용" onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(cursor.col, cursor.row); } else { const delta: Record<string, [number, number]> = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] }; if (delta[e.key]) { e.preventDefault(); const [x,y] = delta[e.key]; const next = { col: Math.max(0, Math.min(map.width - 1, cursor.col + x)), row: Math.max(0, Math.min(map.height - 1, cursor.row + y)) }; setCursor(next); setHover(next); } } }}
        onPointerDown={e => { if (e.button !== 0) return; const v = viewportRef.current!; drag.current = { x:e.clientX,y:e.clientY,left:v.scrollLeft,top:v.scrollTop,moved:false }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { const d = drag.current; if (d) { const dx=e.clientX-d.x, dy=e.clientY-d.y; if (Math.abs(dx)+Math.abs(dy)>6) d.moved=true; if (d.moved && viewportRef.current) { viewportRef.current.scrollLeft=d.left-dx; viewportRef.current.scrollTop=d.top-dy; } } else setHover(point(e)); }}
        onPointerLeave={() => setHover(null)} onPointerUp={e => { if (drag.current && !drag.current.moved) { const p=point(e); setCursor(p); choose(p.col,p.row); } drag.current=null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { drag.current=null; }} />
    </div>
    <div className="pixel-studio-roster">{agents.map(agent => <button type="button" key={agent.role} onClick={() => setSelectedRole(agent.role)} aria-pressed={selectedRole === agent.role}><strong>{ROLE_LABELS[agent.role]}</strong><span>{PET_PRESENTATIONS[agent.activity].label}</span></button>)}</div>
    {appearance && selectedRole && <CharacterEditor key={selectedRole} role={selectedRole} appearance={appearance} status={`${agents.find(a => a.role === selectedRole)?.status} · ${PET_PRESENTATIONS[agents.find(a => a.role === selectedRole)!.activity].label}`} task={agents.find(a => a.role === selectedRole)?.task?.title} skill={agents.find(a => a.role === selectedRole)?.task ? taskSkillLabel(agents.find(a => a.role === selectedRole)!.task!) : undefined} close={() => setSelectedRole(null)} change={changeAppearance} reset={type => changeAppearance(defaultAppearance(selectedRole,type))} />}
  </section>;
}
