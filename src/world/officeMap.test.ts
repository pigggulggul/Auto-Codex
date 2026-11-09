import { describe, expect, it } from 'vitest';
import { defaultOffice, DESK, eraseTopObject, expandOffice, indexAt, objectCovers, objectSize, stations, stationsForMap, validateOffice } from './officeMap';

describe('editable office layout', () => {
  it('starts with a closed, connected office and extends it without losing its contents', () => {
    const map = defaultOffice();
    expect(validateOffice(map)).toBeNull();
    const extended = expandOffice(map);
    expect(extended.width).toBeGreaterThan(map.width);
    expect(extended.objects).toEqual(map.objects);
    expect(validateOffice(extended)).toBeNull();
  });
  it('rejects a broken exterior or missing floor while accepting an explicit door', () => {
    const map = defaultOffice();
    map.cells[indexAt(map, 4, 0)] = 'empty';
    expect(validateOffice(map)).toMatch(/외벽/);
    map.cells[indexAt(map, 4, 0)] = 'door';
    expect(validateOffice(map)).toBeNull();
    map.cells[indexAt(map, 5, 5)] = 'empty';
    expect(validateOffice(map)).toMatch(/바닥/);
  });
  it('rejects furniture on a workstation or a wall and barriers that split the room', () => {
    const map = defaultOffice();
    map.objects.push({id:'bad', asset:'synthetic', col:3, row:4, blocks:true});
    expect(validateOffice(map)).not.toBeNull();
    map.objects.pop();
    map.objects.push({id:'bad', asset:'synthetic', col:0, row:1, blocks:true});
    expect(validateOffice(map)).toMatch(/바닥/);
    map.objects.pop();
    for (let y=1; y<map.height-1; y++) map.cells[indexAt(map, 6, y)]='wall';
    expect(validateOffice(map)).toMatch(/통로/);
  });
  it('allows a passable small object on a workstation', () => {
    const map = defaultOffice();
    map.objects.push({id:'small', asset:'synthetic', col:3, row:4, blocks:false});
    expect(validateOffice(map)).toBeNull();
  });
  it('erases just the topmost object when multiple objects occupy the same cell', () => {
    const map = defaultOffice();
    map.objects.push({id:'bottom',asset:'synthetic',col:1,row:5,blocks:false});
    map.objects.push({id:'top',asset:'synthetic',col:1,row:5,blocks:false});
    const edited = eraseTopObject(map,1,5);
    expect(edited.objects.some(object => object.id === 'bottom')).toBe(true);
    expect(edited.objects.some(object => object.id === 'top')).toBe(false);
    expect(map.objects.some(object => object.id === 'top')).toBe(true);
    expect(eraseTopObject(map,0,0)).toBe(map);
  });
  it('uses the real 96×80 desk size for placement, overlap and removal', () => {
    expect(objectSize({asset:DESK})).toEqual({width:96,height:80,cols:2,rows:2});
    const map = defaultOffice(), desk = map.objects[0];
    expect(objectCovers(desk, desk.col + 1, desk.row + 1)).toBe(true);
    expect(objectCovers(desk, desk.col + 2, desk.row)).toBe(false);
    map.objects.push({id:'overlap',asset:'synthetic',col:desk.col + 1,row:desk.row + 1,blocks:true});
    expect(validateOffice(map)).toMatch(/겹/);
  });
  it('includes offset pixels in the covered cells and rejects invalid offsets', () => {
    const map = defaultOffice();
    const object = {id:'offset', asset:'synthetic', col:1, row:5, offsetX:12, offsetY:8, blocks:false};
    map.objects.push(object);
    expect(objectCovers(object, 2, 6)).toBe(true);
    expect(objectCovers(object, 3, 6)).toBe(false);
    expect(validateOffice(map)).toBeNull();
    object.offsetX = 48;
    expect(validateOffice(map)).toMatch(/보정값/);
    object.offsetX = -1;
    expect(validateOffice(map)).toMatch(/보정값/);
  });
  it('keeps tile variants in place when the room is expanded', () => {
    const map = defaultOffice(); map.styles = map.cells.map(() => 0);
    map.styles[indexAt(map, 4, 5)] = 3;
    const expanded = expandOffice(map);
    expect(expanded.styles?.[indexAt(expanded, 4, 5)]).toBe(3);
    expect(validateOffice(expanded)).toBeNull();
  });
  it('validates and preserves explicit character locations without changing old maps', () => {
    const map = defaultOffice();
    expect(stationsForMap(map)).toBe(stations);
    map.stationLayout = structuredClone(stations);
    expect(validateOffice(map)).toBeNull();
    expect(expandOffice(map).stationLayout).toEqual(map.stationLayout);
    map.stationLayout.builder = {...map.stationLayout.researcher};
    expect(validateOffice(map)).toMatch(/작업석 위치/);
  });
  it('uses clipped dimensions for placement and rejects invalid clipping', () => {
    const map = defaultOffice();
    const part = {id:'part',asset:DESK,col:1,row:5,clipHeight:20,blocks:false};
    map.objects.push(part);
    expect(objectSize(part).height).toBe(20);
    expect(objectCovers(part, 1, 6)).toBe(false);
    expect(validateOffice(map)).toBeNull();
    part.clipHeight = 81;
    expect(validateOffice(map)).toMatch(/크기/);
  });
});
