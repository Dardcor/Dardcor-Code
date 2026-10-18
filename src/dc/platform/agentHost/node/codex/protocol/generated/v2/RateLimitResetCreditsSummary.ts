
import type { RateLimitResetCredit } from "./RateLimitResetCredit.js";

export type RateLimitResetCreditsSummary = {
	availableCount: bigint,
	credits: Array<RateLimitResetCredit> | null,
};
