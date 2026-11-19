
import type { Thread } from "./Thread.js";

export type ThreadRevertResponse = {
	thread: Thread,
	turnsBackwardsCursor: string | null,
	itemsBackwardsCursor: string | null,
};
