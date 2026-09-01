import type { ApprovalRequest } from "../../shared/protocol";

type Props = {
  approval: ApprovalRequest;
  onResolve: (decision: "accept" | "acceptForSession" | "decline" | "cancel") => void;
};

export function ApprovalDialog({ approval, onResolve }: Props) {
  return (
    <div className="approval-backdrop" role="presentation">
      <section className="approval-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-title">
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
        <p className="security-note">브라우저는 승인 ID만 전달합니다. 실제 명령과 권한 검사는 로컬 Codex가 수행합니다.</p>
        <div className="approval-actions">
          <button className="button-secondary danger" type="button" onClick={() => onResolve("decline")}>거절</button>
          <button className="button-secondary" type="button" onClick={() => onResolve("acceptForSession")}>이 세션에서 승인</button>
          <button className="button-primary" type="button" onClick={() => onResolve("accept")}>이번만 승인</button>
        </div>
      </section>
    </div>
  );
}

