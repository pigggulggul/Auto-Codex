import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createOfficePreset, OFFICE_PRESETS } from './officePresets';
import { defaultOffice, validateOffice } from './officeMap';

describe('editable office presets', () => {
  it('provides every reference design with a real preview and a valid editable map', () => {
    expect(OFFICE_PRESETS).toHaveLength(14);
    expect(new Set(OFFICE_PRESETS.map(p => p.id)).size).toBe(14);
    for (const preset of OFFICE_PRESETS) {
      expect(existsSync(`public${preset.preview}`), preset.name).toBe(true);
      const map = createOfficePreset(preset.id)!;
      expect(validateOffice(map), preset.name).toBeNull();
      if (preset.id === 'icecream') {
        expect(map.objects).toHaveLength(17);
        expect(map.objects.some(object => object.id.startsWith('desk-'))).toBe(false);
      } else if (preset.id === 'gym-small') {
        expect(map.objects).toHaveLength(12);
        expect(map.objects.some(object => object.id.startsWith('desk-'))).toBe(false);
      } else if (preset.id === 'condo-hall') {
        expect(map.objects).toHaveLength(21);
        expect(map.objects.filter(object => object.clipHeight === 48)).toHaveLength(2);
        expect(map.objects.some(object => object.id.startsWith('desk-'))).toBe(false);
      } else if (preset.id === 'condo-lobby') {
        expect(map.objects).toHaveLength(15);
        expect(map.objects.some(object => object.id.startsWith('desk-'))).toBe(false);
        expect(map.stationLayout).toBeDefined();
        const cabinet = map.objects.find(object => object.asset.endsWith('_80.png'))!;
        expect([cabinet.col * 48 + (cabinet.offsetX ?? 0), cabinet.row * 48 + (cabinet.offsetY ?? 0)]).toEqual([288,211]);
      } else {
        expect(map.objects.length, preset.name).toBe(defaultOffice().objects.length + preset.items.length);
      }
      for (const obj of map.objects) expect(existsSync(`public${obj.asset}`), obj.asset).toBe(true);
    }
    expect(createOfficePreset('unknown')).toBeNull();
  });
  it('creates separate drafts without mutating other maps', () => {
    const first = createOfficePreset(OFFICE_PRESETS[0].id)!;
    const second = createOfficePreset(OFFICE_PRESETS[0].id)!;
    first.cells[0] = 'empty';
    expect(validateOffice(second)).toBeNull();
  });
  it('uses source tile pixels that match the reconstructed reference layers', () => {
    const result = execFileSync(process.execPath, ['tools/verify-condo-lobby-tiles.mjs'], {encoding:'utf8', timeout:10000, windowsHide:true});
    expect(result).toContain('PASS: 154');
    expect(result).toContain('PASS: 84');
    expect(result).toContain('Gym_2 tiles match');
    expect(result).toContain('Ice_Cream_Shop_Design tiles match');
  });
  it('checks identified hallway sprites against their reference coordinates', () => {
    const result = execFileSync(process.execPath, ['tools/verify-condo-hall-objects.mjs'], {encoding:'utf8', timeout:10000, windowsHide:true});
    expect(result).toContain('PASS: 15');
  });
  it('composes the hallway objects against the source layer', () => {
    const map = createOfficePreset('condo-hall')!;
    const result = JSON.parse(execFileSync(process.execPath, ['tools/compare-condo-hall-objects.mjs'], {input:JSON.stringify(map.objects), encoding:'utf8', timeout:10000, windowsHide:true})) as {total:number;equal:number;extra:number};
    expect(result.equal, JSON.stringify(result)).toBe(result.total);
    expect(result.extra).toBe(0);
  });
  it('composes the small gym objects against the source layer', () => {
    const map = createOfficePreset('gym-small')!;
    const result = JSON.parse(execFileSync(process.execPath, ['tools/compare-condo-hall-objects.mjs','public/assets/Home_Designs/Gym_Designs/48x48/Gym_2_layer_2_48x48.png'], {input:JSON.stringify(map.objects), encoding:'utf8', timeout:10000, windowsHide:true})) as {total:number;equal:number;extra:number};
    expect(result.equal, JSON.stringify(result)).toBe(result.total);
    expect(result.extra).toBe(0);
  });
  it('composes the ice cream shop objects against both source layers', () => {
    const map = createOfficePreset('icecream')!;
    const root='public/assets/Home_Designs/Ice-Cream_Shop_Designs/48x48/Ice_Cream_Shop_Design_layer_';
    const result = JSON.parse(execFileSync(process.execPath, ['tools/compare-condo-hall-objects.mjs',`${root}2_48x48.png`,`${root}3_48x48.png`], {input:JSON.stringify(map.objects), encoding:'utf8', timeout:10000, windowsHide:true})) as {total:number;equal:number;extra:number};
    expect(result.equal, JSON.stringify(result)).toBe(result.total);
    expect(result.extra).toBe(0);
  });
});
