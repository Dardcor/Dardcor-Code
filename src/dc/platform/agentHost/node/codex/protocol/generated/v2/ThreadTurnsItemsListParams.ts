// @ts-nocheck

import type { SortDirection } from "./SortDirection.js";

export type ThreadTurnsItemsListParams = {
	threadId: string, turnId: string,
	cursor?: string | null,
	limit?: number | null,
	sortDirection?: SortDirection | null,
};

