
import type { ThreadSearchResult } from "./ThreadSearchResult.js";

export type ThreadSearchResponse = {
	data: Array<ThreadSearchResult>,
	nextCursor: string | null,
	backwardsCursor: string | null,
};
