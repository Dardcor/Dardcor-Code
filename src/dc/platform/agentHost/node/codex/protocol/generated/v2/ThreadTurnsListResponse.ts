
import type { Turn } from "./Turn.js";

export type ThreadTurnsListResponse = {
	data: Array<Turn>,
	nextCursor: string | null,
	backwardsCursor: string | null,
};
