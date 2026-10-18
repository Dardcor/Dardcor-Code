
import type { ThreadSearchOccurrence } from "./ThreadSearchOccurrence.js";

export type ThreadSearchOccurrencesResponse = {
	data: Array<ThreadSearchOccurrence>,
	nextCursor: string | null,
};
