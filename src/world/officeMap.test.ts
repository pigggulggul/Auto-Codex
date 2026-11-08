import { describe, expect, it } from 'vitest';
import { defaultOffice, DESK, expandOffice, indexAt, objectCovers, objectSize, validateOffice } from './officeMap';

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
  it('uses the real 96×80 desk size for placement, overlap and removal', () => {
    expect(objectSize({asset:DESK})).toEqual({width:96,height:80,cols:2,rows:2});
    const map = defaultOffice(), desk = map.objects[0];
    expect(objectCovers(desk, desk.col + 1, desk.row + 1)).toBe(true);
    expect(objectCovers(desk, desk.col + 2, desk.row)).toBe(false);
    map.objects.push({id:'overlap',asset:'synthetic',col:desk.col + 1,row:desk.row + 1,blocks:true});
    expect(validateOffice(map)).toMatch(/겹/);
  });
  it('keeps tile variants in place when the room is expanded', () => {
    const map = defaultOffice(); map.styles = map.cells.map(() => 0);
    map.styles[indexAt(map, 4, 5)] = 3;
    const expanded = expandOffice(map);
    expect(expanded.styles?.[indexAt(expanded, 4, 5)]).toBe(3);
    expect(validateOffice(expanded)).toBeNull();
  });
});
