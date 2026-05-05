const SESSION_CODE_LENGTH = 6;
const SESSION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class SessionManager {
  private readonly code: string;

  constructor() {
    this.code = SessionManager.generateCode();
  }

  getCode(): string {
    return this.code;
  }

  matches(candidate: string): boolean {
    return candidate.trim().toUpperCase() === this.code;
  }

  static generateCode(): string {
    let output = "";
    for (let index = 0; index < SESSION_CODE_LENGTH; index += 1) {
      const nextIndex = Math.floor(Math.random() * SESSION_ALPHABET.length);
      output += SESSION_ALPHABET[nextIndex];
    }
    return output;
  }
}

