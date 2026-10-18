
import type { AccountTokenUsageDailyBucket } from "./AccountTokenUsageDailyBucket.js";
import type { AccountTokenUsageSummary } from "./AccountTokenUsageSummary.js";
import type { ThreadUsage } from "./ThreadUsage.js";

export type GetAccountTokenUsageResponse = {
	summary: AccountTokenUsageSummary, dailyUsageBuckets: Array<AccountTokenUsageDailyBucket> | null,
	threadUsage?: ThreadUsage | null,
};
