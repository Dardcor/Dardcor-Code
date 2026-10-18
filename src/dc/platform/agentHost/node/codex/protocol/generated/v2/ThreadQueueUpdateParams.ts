
import type { UserInput } from "./UserInput.js";

export type ThreadQueueUpdateParams = { threadId: string, queuedSubmissionId: string, input: Array<UserInput>, };
