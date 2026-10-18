
import type { ThreadBackgroundTerminal } from "./ThreadBackgroundTerminal.js";

export type ThreadBackgroundTerminalsListResponse = {
	data: Array<ThreadBackgroundTerminal>,
	nextCursor: string | null,
};
