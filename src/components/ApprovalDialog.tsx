import { useEffect, useRef } from "react";
import type { ApprovalRequest } from "../../shared/protocol";

type Props = {
  approval: ApprovalRequest;
  onResolve: (decision: "accept" | "acceptForSession" | "decline" | "cancel") => void;
};

export function ApprovalDialog({ approval, onResolve }: Props) {
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = modal.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    element.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      element.close();
      if (opener?.isConnected && opener !== document.body) opener.focus();
      else (document.getElementById("workspace-heading") ?? document.querySelector<HTMLButtonElement>(".run-button, .stop-button"))?.focus();
    };
  }, [approval.approvalId]);
  return (
    <dialog className="approval-native" ref={modal} aria-labelledby="approval-title" aria-describedby="approval-security-note" onCancel={(event) => event.preventDefault()} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <section className="approval-dialog">
        <div className="approval-symbol">!</div>
        <span className="eyebrow">CODEX PERMISSION</span>
        <h2 id="approval-title">{approval.title}</h2>
        <p className="approval-reason">{approval.reason || "Codex가 이 작업을 계속하기 위해 승인을 요청했습니다."}</p>
        {approval.taskId && <p className="approval-task">담당 작업 · {approval.taskId}</p>}
        {(approval.command || approval.grantRoot) && (
          <div className="approval-details">
            <span>{approval.command ? "COMMAND" : "WRITE ROOT"}</span>
            <code>{approval.command || approval.grantRoot}</code>
            {approval.cwd && <small>in {approval.cwd}</small>}
          </div>
        )}
        {approval.requestedPermissions && (
          <div className="approval-details permission-details">
            <span>REQUESTED PERMISSIONS</span>
            <code>{[
              approval.requestedPermissions.network ? "NETWORK: ON" : "NETWORK: unchanged",
              ...approval.requestedPermissions.readPaths.map((item) => `READ: ${item}`),
              ...approval.requestedPermissions.writePaths.map((item) => `WRITE: ${item}`),
            ].join("\n")}</code>
          </div>
        )}
        <p className="security-note" id="approval-security-note">명시적으로 선택할 때까지 요청을 유지합니다. 브라우저는 승인 ID와 결정을 전달하며 실제 명령과 권한 검사는 로컬 Codex가 수행합니다.</p>
        <div className="approval-actions">
          <button className="button-secondary danger" type="button" onClick={() => onResolve("decline")}>거절</button>
          <button className="button-secondary" type="button" onClick={() => onResolve("acceptForSession")}>이 세션에서 승인</button>
          <button className="button-primary" type="button" onClick={() => onResolve("accept")}>이번만 승인</button>
        </div>
      </section>
    </dialog>
  );
}

