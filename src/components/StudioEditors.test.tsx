import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioPalette } from './StudioEditors';
import { artList } from '../world/officeArt';

describe('room builder palette', () => {
  const props = { setTool:vi.fn(), style:0, setStyle:vi.fn(), objectPath:'', setObjectPath:vi.fn(), kind:'interior' as const, setKind:vi.fn(), blocks:true, setBlocks:vi.fn(), motion:false };
  it('renders a path tool and a bounded page of real source previews', () => {
    const html=renderToStaticMarkup(<StudioPalette {...props} tool="path"/>);
    expect(html).toContain('길 선택');
    expect(html).toContain('Room_Builder_Floor_Paths_48x48.png');
    expect(html).toContain('길 연결');
    expect(html).toContain(`${artList('path').length}개`);
    expect((html.match(/class="studio-tile-thumb"/g) ?? []).length).toBeLessThanOrEqual(24);
  });
  it('renders selectable full arches with actual images', () => {
    const html=renderToStaticMarkup(<StudioPalette {...props} tool="door"/>);
    expect(html).toContain('완성된 아치');
    expect(html).toContain('아치 통로 1');
    expect(html).toContain('Room_Builder_Arched_Entryways_48x48.png');
    expect(html).toContain('width:96px;height:144px');
  });
});
