
import type { PluginSharePrincipalType } from "./PluginSharePrincipalType.js";
import type { PluginShareTargetRole } from "./PluginShareTargetRole.js";

export type PluginShareTarget = { principalType: PluginSharePrincipalType, principalId: string, role: PluginShareTargetRole, };
