
import type { RateLimitResetCreditStatus } from "./RateLimitResetCreditStatus.js";
import type { RateLimitResetType } from "./RateLimitResetType.js";

export type RateLimitResetCredit = {
	id: string, resetType: RateLimitResetType, status: RateLimitResetCreditStatus,
	grantedAt: number,
	expiresAt: number | null,
	title: string | null,
	description: string | null,
};
