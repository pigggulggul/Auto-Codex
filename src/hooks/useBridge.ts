import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActivityEvent,
  ApprovalRequest,
  BridgeSnapshot,
  ClientMessage,
  ServerMessage,
  SkillInfo,
  ExecutionMode,
} from "../../shared/protocol";

const EMPTY_SNAPSHOT: BridgeSnapshot = {
  connected: false,
  appServerReady: false,
  projectPath: null,
  threadId: null,
  turnId: null,
  petState: "connecting",
  selectedSkill: null,
  activeRole: "general",
  projectTrust: "untrusted",
  activeRun: null,
};

function bridgeUrl(): string {
  const configured = import.meta.env.VITE_BRIDGE_URL as string | undefined;
  if (configured) return configured;
  if (window.location.port !== "4780") {
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${window.location.host}/ws`;
  }
  return "ws://127.0.0.1:4781/ws";
}

export function useBridge() {
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillErrors, setSkillErrors] = useState<string[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [skillRationale, setSkillRationale] = useState<string>("");
  const [assistantText, setAssistantText] = useState("");
  const [taskOutputs, setTaskOutputs] = useState<Record<string, string>>({});
  const [turnStatus, setTurnStatus] = useState("idle");
  const [isPickingProject, setIsPickingProject] = useState(false);
  const [isTrustingProject, setIsTrustingProject] = useState(false);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(bridgeUrl());
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        retryCountRef.current = 0;
        setLastError(null);
      });
      socket.addEventListener("message", (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          setLastError("브리지에서 해석할 수 없는 메시지를 받았습니다.");
          return;
        }
        switch (message.type) {
          case "bridge.state":
            setSnapshot(message.snapshot);
            break;
          case "run.state":
            setSnapshot((current) => ({ ...current, activeRun: message.run }));
            break;
          case "project.selected":
            window.localStorage.setItem("auto-codex.project", message.path);
            setIsPickingProject(false);
            break;
          case "project.trust":
            setIsTrustingProject(false);
            break;
          case "project.picker":
            setIsPickingProject(message.status === "opened");
            break;
          case "skills.list":
            setSkills(message.skills);
            setSkillErrors(message.errors);
            break;
          case "skill.selected":
            setSkillRationale(message.rationale);
            break;
          case "turn.state":
            setTurnStatus(message.status);
            break;
          case "assistant.text":
            if (message.taskId) {
              setTaskOutputs((current) => ({ ...current, [message.taskId!]: message.text }));
            } else {
              setAssistantText(message.text);
            }
            break;
          case "activity.event":
            setActivities((current) => [message.event, ...current].slice(0, 40));
            break;
          case "approval.request":
            setApprovals((current) =>
              current.some((item) => item.approvalId === message.approval.approvalId)
                ? current
                : [...current, message.approval],
            );
            break;
          case "approval.resolved":
            setApprovals((current) => current.filter((item) => item.approvalId !== message.approvalId));
            break;
          case "error":
            setIsPickingProject(false);
            setIsTrustingProject(false);
            setLastError(message.message);
            break;
          case "protocol.event":
            break;
        }
      });
      socket.addEventListener("close", () => {
        socketRef.current = null;
        setSnapshot((current) => ({ ...current, connected: false, appServerReady: false, petState: "connecting" }));
        if (!disposed) {
          const delay = Math.min(5_000, 500 * 2 ** retryCountRef.current++);
          retryRef.current = window.setTimeout(connect, delay);
        }
      });
      socket.addEventListener("error", () => socket.close());
    };

    connect();
    return () => {
      disposed = true;
      if (retryRef.current !== null) window.clearTimeout(retryRef.current);
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setLastError("로컬 브리지에 연결되어 있지 않습니다.");
      return false;
    }
    setLastError(null);
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  return {
    snapshot,
    skills,
    skillErrors,
    activities,
    approvals,
    lastError,
    skillRationale,
    turnStatus,
    isPickingProject,
    isTrustingProject,
    clearError: () => setLastError(null),
    selectProject: (projectPath: string) => send({ type: "project.select", path: projectPath }),
    pickProject: () => {
      if (!send({ type: "project.pick" })) return false;
      setIsPickingProject(true);
      return true;
    },
    trustProject: () => {
      const sent = send({ type: "project.trust" });
      if (sent) setIsTrustingProject(true);
      return sent;
    },
    refreshSkills: () => send({ type: "skills.refresh" }),
    assistantText,
    taskOutputs,
    startTurn: (prompt: string, skillMode: "auto" | "manual", skillPath: string | undefined, executionMode: ExecutionMode) => {
      const sent = send({ type: "turn.start", prompt, skillMode, skillPath, executionMode });
      if (sent) {
        setAssistantText("");
        setTaskOutputs({});
      }
      return sent;
    },
    interruptTurn: () => send({ type: "turn.interrupt" }),
    resolveApproval: (
      approvalId: string,
      decision: "accept" | "acceptForSession" | "decline" | "cancel",
    ) => send({ type: "approval.resolve", approvalId, decision }),
  };
}
