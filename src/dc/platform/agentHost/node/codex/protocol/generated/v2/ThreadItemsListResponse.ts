
import type { ThreadItemEntry } from "./ThreadItemEntry.js";

export type ThreadItemsListResponse = {
	data: Array<ThreadItemEntry>,
	nextCursor: string | null,
	backwardsCursor: string | null,
};
