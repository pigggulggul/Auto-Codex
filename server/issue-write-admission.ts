/** In-process admission for the short issue export write phase. No cross-process locking. */
export class IssueWriteAdmission {
  private owner: symbol | null = null;
  get busy(): boolean { return this.owner !== null; }

  /** Synchronously check existing runtime reservations and claim before any asynchronous work. */
  tryAcquire(otherBusy: () => boolean): (() => void) | null {
    if (this.owner || otherBusy()) return null;
    const owner = Symbol("issue-export");
    this.owner = owner;
    return () => { if (this.owner === owner) this.owner = null; };
  }
}
