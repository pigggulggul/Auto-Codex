/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { artFor, artList, placementFor, ROOM_SOURCES, type ArtKind } from './officeArt';
import raw from './roomBuilderTiles.json';
import { defaultOffice, indexAt, placeArt, validateOffice } from './officeMap';
import { defaultAppearance } from './officeAppearance';
import { ROLE_ORDER } from './pixelWorld';

describe('room builder catalog', () => {
  it('exposes all nine supplied sheets with nonempty classified tiles inside image bounds', () => {
    expect(new Set(ROOM_SOURCES.map(source => source.file)).size).toBe(9);
    for (const source of ROOM_SOURCES) {
      const bytes = readFileSync(`public/assets/Interiors/Room_Builder_subfiles_48x48/${source.file}`);
      const width=bytes.readUInt32BE(16), height=bytes.readUInt32BE(20);
      expect(raw[source.file].length, source.file).toBeGreaterThan(0);
      expect(artList(source.kind).some(item => item.group === source.label),source.file).toBe(true);
      for (const [x,y,w,h] of raw[source.file]) expect(x >= 0 && y >= 0 && x+w <= width && y+h <= height,source.file).toBe(true);
    }
    for (const kind of ['floor','path','wall','door'] as ArtKind[]) expect(artList(kind).filter(item => !item.hidden).length).toBeGreaterThan(20);
  });
  it('stamps complete arches as source-aligned cells and preserves them in a map', () => {
    const style=artList('door').findIndex(item => item.group === '완성된 아치');
    const arch=artFor('door',style), parts=placementFor('door',style);
    expect(parts).toHaveLength(6);
    for (const part of parts) {
      const tile=artFor('door',part.style);
      expect([tile.x,tile.y]).toEqual([arch.x+part.col*48,arch.y+part.row*48]);
    }
    const map=defaultOffice();
    expect(placeArt(map,'door',style,map.width-1,map.height-1)).toBeNull();
    const edited=placeArt(map,'door',style,9,4)!;
    for (const part of parts) expect(edited.cells[indexAt(edited,9+part.col,4+part.row)]).toBe('door');
    expect(validateOffice(edited)).toBeNull();
  });
  it('keeps paths walkable and serializable', () => {
    const map=placeArt(defaultOffice(),'path',10,9,5)!;
    const loaded=JSON.parse(JSON.stringify(map));
    expect(loaded.cells[indexAt(loaded,9,5)]).toBe('path');
    expect(artFor('path',loaded.styles[indexAt(loaded,9,5)]).group).toBe('길');
    expect(validateOffice(loaded)).toBeNull();
  });
});

describe('role defaults', () => {
  it('provides different built-in looks while keeping valid adult and child layers', () => {
    expect(new Set(ROLE_ORDER.map(role => JSON.stringify(defaultAppearance(role)))).size).toBe(ROLE_ORDER.length);
    for (const role of ROLE_ORDER) for (const type of ['adult','kid'] as const) {
      const look=defaultAppearance(role,type);
      expect([look.body,look.eyes,look.outfit,look.hair].every(path => path.startsWith('/assets/Character_Generator/'))).toBe(true);
    }
  });
});
