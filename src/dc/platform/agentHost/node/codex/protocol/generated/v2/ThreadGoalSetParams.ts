
import type { ThreadGoalStatus } from "./ThreadGoalStatus.js";

export type ThreadGoalSetParams = { threadId: string, objective?: string | null, status?: ThreadGoalStatus | null, tokenBudget?: number | null, };
