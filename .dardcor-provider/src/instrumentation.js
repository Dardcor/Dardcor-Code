import { assertNoWeakSecrets } from "./shared/utils/secretPolicy.js";

export async function register() {
  assertNoWeakSecrets();
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();
  }
}
