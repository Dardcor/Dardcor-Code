
import type { Thread } from "./Thread.js";

export type ThreadListResponse = {
	data: Array<Thread>,
	nextCursor: string | null,
	backwardsCursor: string | null,
};
