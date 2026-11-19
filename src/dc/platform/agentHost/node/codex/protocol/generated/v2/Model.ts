
import type { InputModality } from "../InputModality.js";
import type { ReasoningEffort } from "../ReasoningEffort.js";
import type { ModelAvailabilityNux } from "./ModelAvailabilityNux.js";
import type { ModelServiceTier } from "./ModelServiceTier.js";
import type { ModelUpgradeInfo } from "./ModelUpgradeInfo.js";
import type { MultiAgentVersion } from "./MultiAgentVersion.js";
import type { ReasoningEffortOption } from "./ReasoningEffortOption.js";

export type Model = {
	id: string, model: string, upgrade: string | null, upgradeInfo: ModelUpgradeInfo | null, availabilityNux: ModelAvailabilityNux | null, displayName: string, description: string, modelSpecialty: string | null, hidden: boolean, supportedReasoningEfforts: Array<ReasoningEffortOption>, defaultReasoningEffort: ReasoningEffort, inputModalities: Array<InputModality>, supportsPersonality: boolean,
	multiAgentVersion: MultiAgentVersion | null,
	additionalSpeedTiers: Array<string>, serviceTiers: Array<ModelServiceTier>,
	defaultServiceTier: string | null, isDefault: boolean,
};
