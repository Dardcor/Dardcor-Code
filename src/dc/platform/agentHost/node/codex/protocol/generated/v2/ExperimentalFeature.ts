
import type { ExperimentalFeatureStage } from "./ExperimentalFeatureStage.js";

export type ExperimentalFeature = {
	name: string,
	stage: ExperimentalFeatureStage,
	displayName: string | null,
	description: string | null,
	announcement: string | null,
	enabled: boolean,
	defaultEnabled: boolean,
};
