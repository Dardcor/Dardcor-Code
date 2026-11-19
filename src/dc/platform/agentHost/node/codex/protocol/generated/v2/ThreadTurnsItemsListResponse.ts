// @ts-nocheck

import type { ThreadItem } from "./ThreadItem.js";

export type ThreadTurnsItemsListResponse = {
	data: Array<ThreadItem>,
	nextCursor: string | null,
	backwardsCursor: string | null,
};

