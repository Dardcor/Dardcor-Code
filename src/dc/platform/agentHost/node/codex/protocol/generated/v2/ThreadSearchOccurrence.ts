
import type { ThreadSearchTextRange } from "./ThreadSearchTextRange.js";

export type ThreadSearchOccurrence = {
	turnId: string, itemId: string, snippet: string,
	snippetMatchRange: ThreadSearchTextRange,
	turnCursor: string,
};
