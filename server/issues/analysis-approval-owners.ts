/** Server-owned correlation for analysis approvals. IDs and owners never come from model text. */
export class AnalysisApprovalOwners {
  private readonly approvals = new Map<string, { owner: AbortSignal; threadId: string }>();

  add(id: string, owner: AbortSignal, threadId: string): boolean {
    if (!id || !threadId || owner.aborted || this.approvals.has(id) || this.approvals.size >= 128) return false;
    this.approvals.set(id, { owner, threadId });
    return true;
  }

  has(id: string): boolean { return this.approvals.has(id); }
  owns(id: string, owner: AbortSignal | undefined): boolean {
    const entry = this.approvals.get(id);
    return Boolean(entry && owner && !owner.aborted && entry.owner === owner);
  }
  belongsTo(id: string, owner: AbortSignal, threadId: string): boolean {
    const entry = this.approvals.get(id);
    return Boolean(entry && entry.owner === owner && entry.threadId === threadId);
  }
  remove(id: string): void { this.approvals.delete(id); }
}
