export function createClientId(): string {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `ctrlx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
