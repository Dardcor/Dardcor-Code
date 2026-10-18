
import type { PluginSharePrincipalRole } from "./PluginSharePrincipalRole.js";
import type { PluginSharePrincipalType } from "./PluginSharePrincipalType.js";

export type PluginSharePrincipal = { principalType: PluginSharePrincipalType, principalId: string, role: PluginSharePrincipalRole, name: string, };
