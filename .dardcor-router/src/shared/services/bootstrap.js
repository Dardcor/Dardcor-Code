import initializeApp from "./initializeApp.js";

const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build"
  || process.env.NEXT_PHASE === "phase-export"
  || process.env.NEXT_PHASE === "phase-static";


if (typeof window === "undefined" && !isBuildPhase && !global.__appBootstrapped) {
  global.__appBootstrapped = true;
  initializeApp().catch((e) => console.error("[Bootstrap] init failed:", e.message));
}
