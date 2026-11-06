import type { ProtocolNotification, ProtocolServerRequest } from "../codex-app-server.js";
import type { AnalysisTransport } from "./analysis-transport.js";

/** Retain previous transports for late events; never discard their thread ownership. */
export class AnalysisRouter {
  private readonly transports: AnalysisTransport[] = [];
  register(transport: AnalysisTransport): void {
    if (this.transports.includes(transport)) return;
    if (this.transports.length >= 128) throw new Error("Analysis router limit reached");
    this.transports.push(transport);
  }
  notification(event: ProtocolNotification): boolean {
    for (let i = this.transports.length - 1; i >= 0; i--) if (this.transports[i].notification(event)) return true;
    return false;
  }
  serverRequest(request: ProtocolServerRequest): boolean {
    for (let i = this.transports.length - 1; i >= 0; i--) if (this.transports[i].serverRequest(request)) return true;
    return false;
  }
}
