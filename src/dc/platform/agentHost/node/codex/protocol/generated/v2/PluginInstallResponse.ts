
import type { AppSummary } from "./AppSummary.js";
import type { PluginAuthPolicy } from "./PluginAuthPolicy.js";

export type PluginInstallResponse = { authPolicy: PluginAuthPolicy, appsNeedingAuth: Array<AppSummary>, };
