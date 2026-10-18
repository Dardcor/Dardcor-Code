
import type { AppToolApproval } from "./AppToolApproval.js";

export type AppToolsConfig = { [key in string]?: { enabled: boolean | null, approval_mode: AppToolApproval | null, } };
