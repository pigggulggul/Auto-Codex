import { useEffect, useRef, useState } from "react";
import { MarkdownText } from "./MarkdownText";

export function ResultText({ title, text }: { title: string; text: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(false);
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [text]);
  useEffect(() => { if (opened) dialog.current?.showModal(); }, [opened]);
  const open = () => { setRaw(false); setCopied(false); setOpened(true); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };
  return <>
    <div className="result-text-toolbar"><button type="button" className="result-expand-button" onClick={open} aria-label={`${title} 전체 보기`}>⛶ 전체 보기</button></div>
    <div className="result-text-body"><MarkdownText text={text} /></div>
    <dialog className="result-reader" ref={dialog} aria-label={`${title} 전체 텍스트`} onClose={() => setOpened(false)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      {opened && <div className="result-reader-shell">
        <header className="result-reader-heading"><div><span className="eyebrow">FULL TEXT</span><h2>{title}</h2></div><button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="전체 보기 닫기">✕ 닫기</button></header>
        <div className="result-reader-tools"><button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>마크다운 보기</button><button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>원문 보기</button><button type="button" onClick={() => void copy()}>{copied ? "복사됨" : "원문 복사"}</button></div>
        <div className="result-reader-content" tabIndex={0}>{raw ? <pre className="result-reader-source">{text}</pre> : <MarkdownText text={text} />}</div>
      </div>}
    </dialog>
  </>;
}
