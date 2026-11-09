import { useMemo, useState } from 'react';
import type { AgentRole } from '../../shared/protocol';
import { ROLE_LABELS } from '../world/pixelWorld';
import manifest from '../world/assetManifest.json';
import { EXTRA_INTERIOR_ASSETS } from '../world/extraAssets';
import { objectSize, type Cell } from '../world/officeMap';
import { artList, CHARACTER_FRONT_COLUMN, CHARACTER_IDLE_ROW, TILE, type ArtKind, type TileArt } from '../world/officeArt';
import type { Appearance } from '../world/officeAppearance';

export type StudioTool = Cell | 'object' | 'erase';
const themeNames: Record<string, string> = {
  '2':'거실', '3':'욕실', '4':'침실', '5':'교실·도서관', '6':'음악·스포츠', '7':'미술', '8':'체육관', '9':'낚시',
  '10':'생일 파티', '11':'핼러윈', '12':'주방', '13':'회의장', '14':'지하실', '15':'크리스마스', '16':'식료품점',
  '18':'감옥', '19':'병원', '20':'일본식 인테리어', '21':'의류점', '22':'박물관', '23':'방송·촬영 스튜디오',
  '24':'아이스크림 가게', '25':'사격장', '26':'공동주택',
};
export function themeName(category: string): string {
  return themeNames[category.match(/^\d+/)?.[0] ?? ''] ?? '기타';
}
export function assetName(path: string): string {
  if (!path) return '없음';
  const filename = path.split('/').at(-1) ?? '';
  if (path.includes('/Interiors/')) {
    const category = path.split('/').at(-2) ?? '';
    const number = filename.match(/_(\d+)\.png$/i)?.[1];
    return `${themeName(category)} 오브젝트 ${number ?? ''}`.trim();
  }
  if (path.includes('/Animated_Objects/')) {
    const index = manifest.animated.indexOf(path);
    return `움직이는 오브젝트 ${index >= 0 ? index + 1 : ''}`.trim();
  }
  if (path.includes('/Character_Generator/')) {
    const group = path.split('/').at(-3) ?? '';
    const labels: Record<string, string> = { Bodies:'몸', Bodies_kids:'어린이 몸', Eyes:'눈', Eyes_kids:'어린이 눈', Hairstyles:'머리', Hairstyles_kids:'어린이 머리', Outfits:'의상', Outfits_kids:'어린이 의상', Accessories:'소품' };
    const entries = groups[group as keyof typeof groups] ?? [];
    const index = entries.indexOf(path);
    return `${labels[group] ?? '캐릭터'} ${index >= 0 ? index + 1 : ''}`.trim();
  }
  return '이미지';
}
const pageSize = 18;
const groups = manifest.parts;
// File paths and their Korean labels do not change during a session.
const objectIndex = {
  interior: [...manifest.interiors, ...EXTRA_INTERIOR_ASSETS].map(path => ({ path, category: path.split('/').at(-2) ?? '', original: path.toLowerCase(), label: assetName(path).toLowerCase() })),
  animated: manifest.animated.map(path => ({ path, category: '', original: path.toLowerCase(), label: assetName(path).toLowerCase() })),
};
const interiorCategories = [...new Set(objectIndex.interior.map(item => item.category))];
type PaletteProps = {
  tool: StudioTool; setTool: (tool: StudioTool) => void;
  style: number; setStyle: (style: number) => void;
  objectPath: string; setObjectPath: (path: string) => void;
  kind: 'interior' | 'animated'; setKind: (kind: 'interior' | 'animated') => void;
  blocks: boolean; setBlocks: (blocks: boolean) => void;
  motion: boolean;
};
const tools: [StudioTool, string][] = [['floor','바닥'],['path','길'],['wall','벽'],['door','문·통로'],['object','오브젝트'],['empty','바닥 지우기'],['erase','오브젝트 지우기']];
function TileThumb({ art }: { art: TileArt }) {
  const scale = Math.min(1, 60/art.width, 68/art.height);
  return <span className="studio-tile-frame" aria-hidden="true"><span className="studio-tile-thumb" style={{ width:art.width,height:art.height,backgroundImage: `url("${art.sheet}")`, backgroundPosition: `-${art.x}px -${art.y}px`,transform:`scale(${scale})` }} /></span>;
}
function Pager({ page, pages, setPage }: { page: number; pages: number; setPage: (page: number) => void }) {
  return <div className="studio-pager"><button type="button" disabled={page <= 0} onClick={() => setPage(page - 1)}>이전</button><span>{pages ? page + 1 : 0} / {pages}</span><button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>다음</button></div>;
}
export function StudioPalette(props: PaletteProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [tileGroup, setTileGroup] = useState('');
  const [tilePage, setTilePage] = useState(0);
  const categories = interiorCategories;
  const filtered = useMemo(() => {
    if (props.tool !== 'object') return [];
    const search = query.toLowerCase();
    return objectIndex[props.kind].filter(item => (!category || item.category === category) && (!search || item.original.includes(search) || item.label.includes(search))).map(item => item.path);
  }, [props.kind, props.tool, category, query]);
  const pages = Math.ceil(filtered.length / pageSize);
  const items = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const art = props.tool === 'floor' || props.tool === 'wall' || props.tool === 'door' || props.tool === 'path' ? artList(props.tool as ArtKind) : null;
  const visibleArt = art?.map((item,index) => ({item,index})).filter(({item}) => !item.hidden && (!tileGroup || item.group === tileGroup)) ?? [];
  const artGroups = [...new Set((art ?? []).filter(item => !item.hidden).map(item => item.group))];
  const artPages = Math.ceil(visibleArt.length / 24);
  const chooseTool = (tool: StudioTool) => { props.setTool(tool); props.setStyle(0); setTileGroup(''); setTilePage(0); };
  return <div className="studio-palette">
    <div className="studio-tool-tabs" role="group" aria-label="맵 편집 도구">{tools.map(([value,label]) => <button type="button" key={value} aria-pressed={props.tool === value} onClick={() => chooseTool(value)}>{label}</button>)}</div>
    {art && <><div className="studio-palette-heading"><strong>{tools.find(([t]) => t === props.tool)?.[1]} 선택</strong><span>원본 조각을 선택해 맵에 배치하세요. 완성된 아치는 2×3칸입니다.</span></div><label className="studio-art-group">종류<select value={tileGroup} onChange={e => { const group=e.target.value; setTileGroup(group); setTilePage(0); const first=art.findIndex(item => !item.hidden && (!group || item.group === group)); if(first >= 0) props.setStyle(first); }}><option value="">전체</option>{artGroups.map(group => <option key={group} value={group}>{group}</option>)}</select></label><div className="studio-tile-list" aria-label="타일 미리보기">{visibleArt.slice(tilePage*24,(tilePage+1)*24).map(({item,index}) => <button type="button" key={`${item.group}-${index}`} title={item.label} aria-label={item.label} aria-pressed={props.style === index} onClick={() => props.setStyle(index)}><TileThumb art={item}/><span>{item.label}</span></button>)}</div><div className="studio-palette-footer"><span>{visibleArt.length}개 · 선택: {art[props.style]?.label}</span><Pager page={tilePage} pages={artPages} setPage={setTilePage}/></div></>}
    {props.tool === 'object' && <><div className="studio-palette-heading"><strong>오브젝트 선택</strong><span>이미지 크기대로 48px 격자에 배치</span></div><div className="studio-filters"><label>종류<select value={props.kind} onChange={e => { props.setKind(e.target.value as 'interior' | 'animated'); setCategory(''); setPage(0); }}><option value="interior">인테리어 Singles</option><option value="animated">움직이는 오브젝트</option></select></label>{props.kind === 'interior' && <label>테마<select value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}><option value="">모든 테마</option>{categories.map(name => <option key={name} value={name}>{themeName(name)}</option>)}</select></label>}<label>검색<input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="이름 또는 번호" /></label><label className="studio-check"><input type="checkbox" checked={props.blocks} onChange={e => props.setBlocks(e.target.checked)} /> 이동을 막는 가구</label></div>
      <div className="studio-object-list" aria-label="오브젝트 미리보기">{items.map(path => { const size = objectSize({asset:path}); const still = props.kind === 'animated' && !props.motion; const source = still ? path.replace('/gif/', '/spritesheets/').replace(/\.gif$/, '.png') : path; return <button type="button" key={path} title={`${assetName(path)} · ${size.width}×${size.height}px`} aria-label={`${assetName(path)}, ${size.cols} × ${size.rows}칸`} aria-pressed={props.objectPath === path} onClick={() => props.setObjectPath(path)}><span className="studio-object-image">{still ? <span className="studio-still-frame" style={{backgroundImage:`url("${source}")`, width:size.width, height:size.height}}/> : <img src={source} loading="lazy" alt="" />}</span><small>{assetName(path)} · {size.cols}×{size.rows}칸</small></button>; })}</div>
      {!items.length && <p>검색 결과가 없습니다.</p>}<div className="studio-palette-footer"><span>선택: {assetName(props.objectPath)} · {objectSize({asset:props.objectPath}).cols}×{objectSize({asset:props.objectPath}).rows}칸</span><Pager page={page} pages={pages} setPage={setPage}/></div></>}
    <p>초록: 배치 가능 · 빨강: 배치 불가. 외벽과 실내 바닥, 연결된 통로가 필요합니다.</p>
  </div>;
}

type Part = 'body' | 'eyes' | 'outfit' | 'hair' | 'accessory';
const partLabels: Record<Part,string> = {body:'몸', eyes:'눈', outfit:'의상', hair:'머리', accessory:'소품'};
function CharacterPicture({ look, className = '' }: { look: Appearance; className?: string }) {
  return <span className={`studio-character-picture ${className}`} aria-hidden="true">{[look.body,look.eyes,look.outfit,look.hair,look.accessory].filter(Boolean).map((path,i) => <span key={`${i}-${path}`} style={{ backgroundImage:`url("${path}")`, backgroundPosition:`-${CHARACTER_FRONT_COLUMN*TILE}px -${CHARACTER_IDLE_ROW}px` }}/>)}</span>;
}
type CharacterProps = { role: AgentRole; appearance: Appearance; status: string; task?: string; skill?: string; close: () => void; change: (appearance: Appearance) => void; reset: (type?: 'adult' | 'kid') => void };
export function CharacterEditor({ role, appearance, status, task, skill, close, change, reset }: CharacterProps) {
  const [part, setPart] = useState<Part>('hair');
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const adult = appearance.type === 'adult';
  const catalog: Record<Part, string[]> = { body:adult ? groups.Bodies : groups.Bodies_kids, eyes:adult ? groups.Eyes : groups.Eyes_kids, outfit:adult ? groups.Outfits : groups.Outfits_kids, hair:adult ? groups.Hairstyles : groups.Hairstyles_kids, accessory:adult ? groups.Accessories : [] };
  const entries = (part === 'hair' || part === 'accessory' ? ['', ...catalog[part]] : catalog[part]).filter(path => !query || assetName(path).toLowerCase().includes(query.toLowerCase()));
  const pages = Math.ceil(entries.length / 12);
  return <aside className="studio-character-editor" aria-label={`${ROLE_LABELS[role]} 캐릭터 설정`}>
    <div className="studio-character-header"><div><small>CHARACTER STUDIO</small><h3>{ROLE_LABELS[role]}</h3></div><button type="button" onClick={close} aria-label="캐릭터 설정 닫기">×</button></div>
    <div className="studio-character-layout"><div className="studio-character-summary"><div className="studio-character-stage"><CharacterPicture look={appearance} className="studio-character-large"/></div><strong>{ROLE_LABELS[role]}</strong><span>{status}</span>{task && <small>작업: {task}</small>}{skill && <small>스킬 배정: {skill}</small>}<button type="button" onClick={() => reset()}>기본 외형</button></div>
      <div className="studio-character-choices"><label className="studio-body-type">체형 <select value={appearance.type} onChange={e => {reset(e.target.value as 'adult' | 'kid'); setPage(0); setQuery('');}}><option value="adult">성인</option><option value="kid">어린이</option></select></label><div className="studio-character-tabs" role="group" aria-label="캐릭터 구성 요소">{(Object.keys(partLabels) as Part[]).map(key => <button type="button" key={key} aria-pressed={part === key} onClick={() => {setPart(key);setPage(0);setQuery('');}}>{partLabels[key]}</button>)}</div><label className="studio-character-search">{partLabels[part]} 검색<input value={query} onChange={e => {setQuery(e.target.value);setPage(0);}} placeholder="이름 또는 번호" /></label>
      <div className="studio-character-grid" aria-label={`${partLabels[part]} 미리보기`}>{entries.slice(page * 12, (page + 1) * 12).map(path => <button type="button" key={path || 'none'} title={assetName(path)} aria-label={`${partLabels[part]} ${assetName(path)}`} aria-pressed={appearance[part] === path} onClick={() => change({...appearance,[part]:path})}><CharacterPicture look={{...appearance,[part]:path}}/><span>{path ? assetName(path).replace(/_48x48/g,'') : '없음'}</span></button>)}</div>{!entries.length && <p>선택할 항목이 없습니다.</p>}<Pager page={page} pages={pages} setPage={setPage}/></div></div>
    <small className="studio-character-note">외형은 이 브라우저에 저장됩니다. 상태는 실제 런타임 이벤트를 따릅니다.</small>
  </aside>;
}
