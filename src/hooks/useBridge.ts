import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActivityEvent,
  ApprovalRequest,
  BridgeSnapshot,
  ClientMessage,
  ServerMessage,
  SkillInfo,
  ExecutionMode,
  ModelInfo,
  ReasoningEffort,
  WorkspaceMode,
  ConversationMessage,
} from "../../shared/protocol";
import { loadTokenUsage, mergeTokenUsage, saveTokenUsage, summarizeTokenUsage } from "../lib/tokenUsage";
import { AtelierApi } from '../features/atelier/api';

const EMPTY_SNAPSHOT: BridgeSnapshot = {
  connected: false,
  appServerReady: false,
  projectPath: null,
  workspaceMode: "project",
  researchNetworkAccess: false,
  threadId: null,
  turnId: null,
  petState: "connecting",
  selectedSkill: null,
  activeRole: "general",
  activeModel: null,
  activeEffort: null,
  projectTrust: "untrusted",
  activeRun: null,
  activeConversationId: "",
  conversations: [],
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
  const atelierRef = useRef<AtelierApi | null>(null);
  if (!atelierRef.current) atelierRef.current = new AtelierApi();
  const atelierApi = atelierRef.current;
  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const renameRef=useRef<{id:string;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}|null>(null);
  const failRename=(reason:string)=>{const pending=renameRef.current;if(pending){clearTimeout(pending.timer);renameRef.current=null;pending.reject(new Error(reason));}};
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillErrors, setSkillErrors] = useState<string[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelErrors, setModelErrors] = useState<string[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [skillRationale, setSkillRationale] = useState<string>("");
  const [assistantText, setAssistantText] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [taskOutputs, setTaskOutputs] = useState<Record<string, string>>({});
  const [turnStatus, setTurnStatus] = useState("idle");
  const [isPickingProject, setIsPickingProject] = useState(false);
  const [isTrustingProject, setIsTrustingProject] = useState(false);
  const [tokenEntries, setTokenEntries] = useState(loadTokenUsage);
  const tokenUsage = useMemo(() => summarizeTokenUsage(tokenEntries), [tokenEntries]);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(bridgeUrl());
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        atelierApi.connect(text => socket.send(text));
        retryCountRef.current = 0;
        setLastError(null);
      });
      socket.addEventListener("message", (event) => {
        let message: ServerMessage;
        try {
          const decoded: unknown = JSON.parse(String(event.data));
          if (atelierApi.receive(decoded)) return;
          message = decoded as ServerMessage;
        } catch {
          setLastError("브리지에서 해석할 수 없는 메시지를 받았습니다.");
          return;
        }
        switch (message.type) {
          case 'conversation.rename.result':{
            const pending=renameRef.current;if(pending?.id!==message.clientRequestId)break;
            if(!message.ok){failRename(message.error||'대화 이름 저장 실패');break;}
            clearTimeout(pending.timer);renameRef.current=null;pending.resolve();break;
          }
          case "bridge.state":
            setSnapshot(message.snapshot);
            break;
          case "conversation.state":
            setMessages(message.state.messages ?? []);
            setAssistantText(message.state.assistantText);
            setTaskOutputs(message.state.taskOutputs);
            setActivities(message.state.activities);
            setSnapshot((current) => ({ ...current, activeRun: message.state.activeRun }));
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
          case "models.list":
            setModels(message.models);
            setModelErrors(message.errors);
            break;
          case "skill.selected":
            setSkillRationale(message.rationale);
            break;
          case "turn.state":
            setTurnStatus(message.status);
            if (!message.taskId && message.status !== "inProgress") setMessages((current) => current.map((entry, index) => index === current.length - 1 && entry.role === "assistant" ? { ...entry, status: message.status === "completed" ? "completed" : message.status === "interrupted" ? "interrupted" : "failed" } : entry));
            break;
          case "assistant.text":
            if (message.taskId) {
              setTaskOutputs((current) => ({ ...current, [message.taskId!]: message.text }));
            } else {
              setAssistantText(message.text);
              setMessages((current) => current.map((entry, index) => index === current.length - 1 && entry.role === "assistant" ? { ...entry, text: message.text } : entry));
            }
            break;
          case "activity.event":
            setActivities((current) => [message.event, ...current].slice(0, 40));
            break;
          case "token.usage":
            setTokenEntries((current) => {
              const next = mergeTokenUsage(current, message.usage);
              saveTokenUsage(next);
              return next;
            });
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
            failRename(message.message);
            setIsPickingProject(false);
            setIsTrustingProject(false);
            setLastError(message.message);
            break;
          case "protocol.event":
            break;
        }
      });
      socket.addEventListener("close", () => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        failRename('연결이 끊겨 이름 저장 결과를 확인하지 못했습니다. 재연결 후 저장된 이름을 확인하세요.');
        atelierApi.disconnect();
        setSnapshot((current) => ({ ...current, connected: false, appServerReady: false, petState: "connecting" }));
        setApprovals([]);
        setTurnStatus("idle");
        if (!disposed) {
          const delay = Math.min(5_000, 500 * 2 ** retryCountRef.current++);
          retryRef.current = window.setTimeout(connect, delay);
        }
      });
      socket.addEventListener("error", () => {
        if (socketRef.current === socket) socket.close();
      });
    };

    connect();
    return () => {
      disposed = true;
      failRename('화면이 닫혀 이름 저장 결과를 확인하지 못했습니다.');
      if (retryRef.current !== null) window.clearTimeout(retryRef.current);
      socketRef.current?.close();
      atelierApi.disconnect();
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
    atelierApi,
    snapshot,
    skills,
    skillErrors,
    models,
    modelErrors,
    activities,
    approvals,
    lastError,
    skillRationale,
    turnStatus,
    isPickingProject,
    isTrustingProject,
    clearError: () => setLastError(null),
    selectProject: (projectPath: string) => send({ type: "project.select", path: projectPath }),
    setWorkspaceMode: (mode: WorkspaceMode) => send({ type: "workspace.mode", mode }),
    setResearchNetworkAccess: (enabled: boolean) => send({ type: "workspace.network", enabled }),
    newConversation: () => send({ type: "conversation.new" }),
    selectConversation: (conversationId: string) => send({ type: "conversation.select", conversationId }),
    renameConversation:(conversationId:string,title:string,expectedTitle:string)=>new Promise<void>((resolve,reject)=>{
      if(renameRef.current){reject(new Error('이름 저장 응답을 기다려 주세요.'));return;}
      const id=crypto.randomUUID(),timer=setTimeout(()=>failRename('이름 저장 응답이 지연됩니다. 최신 이름을 확인한 뒤 다시 시도하세요.'),15000);
      renameRef.current={id,timer,resolve,reject};
      if(!send({type:'conversation.rename',conversationId,title,expectedTitle,clientRequestId:id}))failRename('로컬 브리지에 연결되어 있지 않습니다.');
    }),
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
    refreshModels: () => send({ type: "models.refresh" }),
    assistantText,
    messages,
    taskOutputs,
    conversations: snapshot.conversations,
    tokenUsage,
    startTurn: (
      prompt: string,
      skillMode: "auto" | "manual",
      skillPath: string | undefined,
      executionMode: ExecutionMode,
      model?: string,
      effort?: ReasoningEffort,
    ) => {
      const sent = send({ type: "turn.start", prompt, skillMode, skillPath, executionMode, model, effort });
      return sent;
    },
    interruptTurn: () => send({ type: "turn.interrupt" }),
    resolveApproval: (
      approvalId: string,
      decision: "accept" | "acceptForSession" | "decline" | "cancel",
    ) => send({ type: "approval.resolve", approvalId, decision }),
  };
}
