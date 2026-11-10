import { describe, expect, it } from 'vitest';
import { changedRegions, type DrawState } from './PixelStudio';
import { defaultOffice } from '../world/officeMap';

function state(): DrawState {
  return { map: defaultOffice(), editing: false, hover: null, hoverValid: false, tool: 'wall', tileStyle: 0, objectPath: '' };
}

describe('pixel map invalidation', () => {
  it('draws once initially and does nothing when the scene is unchanged', () => {
    const scene = state();
    expect(changedRegions(null, scene)).toEqual([{ x: 0, y: 0, width: 18 * 48, height: 13 * 48 }]);
    expect(changedRegions(scene, { ...scene })).toEqual([]);
  });

  it('only invalidates the changed object when one is added', () => {
    const scene = state();
    const object = { ...scene.map.objects[0], id: 'added', col: 8, row: 4 };
    const regions = changedRegions(scene, { ...scene, map: { ...scene.map, objects: [...scene.map.objects, object] } });
    expect(regions).toHaveLength(1);
    expect(regions[0].x).toBe(8 * 48);
    expect(regions[0].y).toBe(4 * 48);
    expect(regions[0].width).toBeLessThan(scene.map.width * 48);
  });

  it('invalidates the old and new hover areas', () => {
    const scene = { ...state(), hover: { col: 2, row: 3 } };
    expect(changedRegions(scene, { ...scene, hover: { col: 3, row: 3 } })).toEqual([
      { x: 96, y: 144, width: 48, height: 48 },
      { x: 144, y: 144, width: 48, height: 48 },
    ]);
  });
});
