export type ServerLifecyclePhase = "starting" | "ready" | "stopping";

declare global {
  var __dardcorCodeServerLifecycle: ServerLifecyclePhase | undefined;
}

export function getServerLifecyclePhase(): ServerLifecyclePhase {
  return globalThis.__dardcorCodeServerLifecycle ?? "starting";
}

export function markServerStarting(): void {
  globalThis.__dardcorCodeServerLifecycle = "starting";
}

export function markServerReady(): void {
  if (getServerLifecyclePhase() !== "stopping") {
    globalThis.__dardcorCodeServerLifecycle = "ready";
  }
}

export function markServerStopping(): void {
  globalThis.__dardcorCodeServerLifecycle = "stopping";
}
