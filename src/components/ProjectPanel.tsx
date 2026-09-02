import { useEffect, useState } from "react";

type Props = {
  currentPath: string | null;
  connected: boolean;
  isPicking: boolean;
  trustStatus: "trusted" | "untrusted";
  isTrusting: boolean;
  disabled: boolean;
  onSelect: (path: string) => void;
  onPick: () => void;
  onTrust: () => void;
};

export function ProjectPanel({ currentPath, connected, isPicking, trustStatus, isTrusting, disabled, onSelect, onPick, onTrust }: Props) {
  const [value, setValue] = useState(() => window.localStorage.getItem("auto-codex.project") ?? "");
  const [confirmingTrust, setConfirmingTrust] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (currentPath) setValue(currentPath);
  }, [currentPath]);

  return (
    <details className="control-section project-control control-collapsible" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="section-heading">
        <div>
          <span className="eyebrow">01 · WORKSPACE</span>
          <h2>프로젝트 연결</h2>
        </div>
        <span className="summary-status">{currentPath && <span className="check-mark" title="연결됨">✓</span>}<span className="collapse-glyph" aria-hidden="true">⌄</span></span>
      </summary>
      <div className="control-section-body">
        <label className="path-field">
        <span>LOCAL PATH</span>
        <div>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="C:\\Users\\me\\Projects\\my-app"
            spellCheck={false}
            disabled={disabled}
          />
          <button type="button" onClick={() => onSelect(value)} disabled={disabled || !value.trim()}>
            경로 열기
          </button>
        </div>
        </label>
        <button className="folder-picker-button" type="button" onClick={onPick} disabled={!connected || disabled || isPicking}>
        <span aria-hidden="true">▱</span>
        {isPicking ? "폴더 선택창을 확인하세요" : "폴더 선택…"}
        </button>
        {currentPath && trustStatus === "trusted" ? (
        <div className="trust-confirmed"><span>✓</span> 이 프로젝트는 신뢰됨</div>
      ) : currentPath && (
        <div className="trust-box">
          <p><strong>프로젝트 신뢰 필요</strong><span>프로젝트의 .codex 설정, 훅, 실행 정책을 활성화합니다.</span></p>
          {confirmingTrust ? (
            <div className="trust-actions">
              <button type="button" className="trust-accept" onClick={() => { setConfirmingTrust(false); onTrust(); }} disabled={isTrusting}>
                {isTrusting ? "적용 중…" : "신뢰하고 재시작"}
              </button>
              <button type="button" className="trust-cancel" onClick={() => setConfirmingTrust(false)} disabled={isTrusting}>취소</button>
            </div>
          ) : (
            <button type="button" className="trust-button" onClick={() => setConfirmingTrust(true)} disabled={disabled || isTrusting}>
              이 프로젝트 신뢰하기
            </button>
          )}
        </div>
        )}
        {!connected && (
        <div className="bridge-offline-help">
          <strong>로컬 브리지가 꺼져 있습니다.</strong>
          <span><code>START_AUTO_CODEX.cmd</code>를 더블클릭해 열린 페이지에서 사용하세요.</span>
        </div>
        )}
        {currentPath && <p className="path-caption" title={currentPath}>{currentPath}</p>}
      </div>
    </details>
  );
}
