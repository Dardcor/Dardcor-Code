
import type { ReviewDelivery } from "./ReviewDelivery.js";
import type { ReviewTarget } from "./ReviewTarget.js";

export type ReviewStartParams = {
	threadId: string, target: ReviewTarget,
	delivery?: ReviewDelivery | null,
};
