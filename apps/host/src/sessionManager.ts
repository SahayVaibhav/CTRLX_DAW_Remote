import { randomInt } from "node:crypto";

type SessionListener = () => void;

export class SessionManager {
  private readonly listeners = new Set<SessionListener>();
  private sessionCode = this.generateCode();
  private activeClientId: string | null = null;

  getSessionCode(): string {
    return this.sessionCode;
  }

  getActiveClientId(): string | null {
    return this.activeClientId;
  }

  hasActiveClient(): boolean {
    return this.activeClientId !== null;
  }

  rotateSessionCode(): string {
    this.sessionCode = this.generateCode();
    this.notify();
    return this.sessionCode;
  }

  attachClient(clientId: string): void {
    this.activeClientId = clientId;
    this.notify();
  }

  detachClient(clientId: string): void {
    if (this.activeClientId === clientId) {
      this.activeClientId = null;
      this.notify();
    }
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private generateCode(): string {
    return Array.from({ length: 6 }, () => randomInt(0, 10)).join("");
  }
}
