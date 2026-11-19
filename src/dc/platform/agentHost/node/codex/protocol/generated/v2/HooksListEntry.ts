
import type { HookErrorInfo } from "./HookErrorInfo.js";
import type { HookMetadata } from "./HookMetadata.js";

export type HooksListEntry = { cwd: string, hooks: Array<HookMetadata>, warnings: Array<string>, errors: Array<HookErrorInfo>, };
