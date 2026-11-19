
import type { ExperimentalFeature } from "./ExperimentalFeature.js";

export type ExperimentalFeatureListResponse = {
	data: Array<ExperimentalFeature>,
	nextCursor: string | null,
};
