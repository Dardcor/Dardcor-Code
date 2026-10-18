
import type { PluginAuthPolicy } from "./PluginAuthPolicy.js";
import type { PluginAvailability } from "./PluginAvailability.js";
import type { PluginDisabledReason } from "./PluginDisabledReason.js";
import type { PluginInstallPolicy } from "./PluginInstallPolicy.js";
import type { PluginInstallPolicySource } from "./PluginInstallPolicySource.js";
import type { PluginInterface } from "./PluginInterface.js";
import type { PluginShareContext } from "./PluginShareContext.js";
import type { PluginSource } from "./PluginSource.js";

export type PluginSummary = {
	id: string,
	remotePluginId: string | null,
	version: string | null,
	localVersion: string | null, name: string,
	shareContext: PluginShareContext | null, source: PluginSource, installed: boolean,
	installedAt: number | null, enabled: boolean, installPolicy: PluginInstallPolicy, installPolicySource: PluginInstallPolicySource | null, mustShowInstallationInterstitial: boolean | null, authPolicy: PluginAuthPolicy,
	availability: PluginAvailability,
	disabledReason: PluginDisabledReason | null,
	eligiblePlanTypes: Array<string> | null, interface: PluginInterface | null, keywords: Array<string>,
};
