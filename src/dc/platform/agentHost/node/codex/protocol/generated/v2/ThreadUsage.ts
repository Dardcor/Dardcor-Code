
import type { ThreadUsageBreakdownGroup } from "./ThreadUsageBreakdownGroup.js";

export type ThreadUsage = { threadId: string, estimatedUsageCreditsMicros: bigint, estimatedUsageUsdMicros: bigint | null, groups: Array<ThreadUsageBreakdownGroup>, };
