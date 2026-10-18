
import type { RateLimitResetCreditsSummary } from "./RateLimitResetCreditsSummary.js";
import type { RateLimitSnapshot } from "./RateLimitSnapshot.js";

export type GetAccountRateLimitsResponse = {
	rateLimits: RateLimitSnapshot,
	rateLimitsByLimitId: { [key in string]?: RateLimitSnapshot } | null, rateLimitResetCredits: RateLimitResetCreditsSummary | null,
};
