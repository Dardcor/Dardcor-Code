
import type { QueuedSubmission } from "./QueuedSubmission.js";

export type ThreadQueueListResponse = {
	data: Array<QueuedSubmission>,
	nextCursor: string | null,
};
