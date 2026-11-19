
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { WindowsSandboxSetupMode } from "./WindowsSandboxSetupMode.js";

export type WindowsSandboxSetupStartParams = { mode: WindowsSandboxSetupMode, cwd?: AbsolutePathBuf | null, };
