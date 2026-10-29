import { createElement, type ReactNode } from "react";

// Render a small, inert Markdown subset. Stored/model text never becomes HTML,
// and images never trigger automatic requests to external servers.
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|!?\[[^\]\n]+\]\([^\s)]+\))/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("~~") && part.endsWith("~~")) return <del key={index}>{part.slice(2, -2)}</del>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = /^!?\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    if (link && /^https?:\/\//i.test(link[2])) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return part;
  });
}

const listItem = /^\s*(?:[-+*]|\d+[.)])\s+(.+)$/;
const tableDivider = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
const startsBlock = (line: string) => /^(#{1,6}\s|\s*```|\s*~~~|>\s?|\s*(?:---+|___+|\*\*\*+)\s*$)/.test(line) || listItem.test(line);

export function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = i;
    if (!line.trim()) { i += 1; continue; }
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push(<pre key={key}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(createElement(`h${heading[1].length}`, { key }, inline(heading[2]))); i += 1; continue; }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) { blocks.push(<hr key={key} />); i += 1; continue; }
    if (i + 1 < lines.length && line.includes("|") && tableDivider.test(lines[i + 1])) {
      const headers = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(cells(lines[i++]));
      blocks.push(<div className="markdown-table" key={key}><table><thead><tr>{headers.map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{headers.map((_, col) => <td key={col}>{inline(row[col] ?? "")}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key}><p>{inline(quote.join("\n"))}</p></blockquote>);
      continue;
    }
    if (listItem.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && listItem.test(lines[i]) && /^\s*\d/.test(lines[i]) === ordered) {
        const item = [listItem.exec(lines[i++])![1]];
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !listItem.test(lines[i])) item.push(lines[i++].trim());
        items.push(<li key={i}>{inline(item.join("\n"))}</li>);
      }
      blocks.push(ordered ? <ol key={key} start={Number.parseInt(line, 10)}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }
    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !(i + 1 < lines.length && lines[i].includes("|") && tableDivider.test(lines[i + 1]))) paragraph.push(lines[i++]);
    blocks.push(<p key={key}>{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="markdown-text">{blocks}</div>;
}
