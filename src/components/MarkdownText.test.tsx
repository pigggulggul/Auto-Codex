import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./MarkdownText";

describe("result Markdown", () => {
  it("renders Korean headings, lists, emphasis, tables, quotes and literal fenced code", () => {
    const html = renderToStaticMarkup(<MarkdownText text={'## 결과 보고\n\n**중요한 결론**과 `seed`\n\n1. 첫 항목\n2. 다음 항목\n\n- 비교\n\n| 항목 | 결과 |\n| --- | --- |\n| 시드 | 변화 |\n\n> 참고 내용\n\n```js\nconst x = "<img>";\n```'} />);
    expect(html).toContain('<h2>결과 보고</h2>');
    expect(html).toContain('<strong>중요한 결론</strong>');
    expect(html).toContain('<code>seed</code>');
    expect(html).toContain('<ol start="1"><li>첫 항목</li><li>다음 항목</li></ol>');
    expect(html).toContain('<ul><li>비교</li></ul>');
    expect(html).toContain('<th>항목</th>');
    expect(html).toContain('<td>변화</td>');
    expect(html).toContain('<blockquote><p>참고 내용</p></blockquote>');
    expect(html).toContain('const x = &quot;&lt;img&gt;&quot;;');
  });

  it("keeps HTML inert, rejects executable links and never loads remote images", () => {
    const html = renderToStaticMarkup(<MarkdownText text={'<script>alert(1)</script>\n\n[실행](javascript:alert) [data](data:text/html,unsafe) [file](file:///C:/secret)\n\n[문서](https://example.com/docs) ![그림](https://example.com/image.png)'} />);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/href="(?:javascript|data|file):/);
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("preserves incomplete streamed code fences and unformatted text", () => {
    const html = renderToStaticMarkup(<MarkdownText text={'일반 설명\r\n두 번째 줄\n\n```ts\nconst partial = 1;'} />);
    expect(html).toContain('일반 설명\n두 번째 줄');
    expect(html).toContain('<pre><code>const partial = 1;</code></pre>');
  });
});
