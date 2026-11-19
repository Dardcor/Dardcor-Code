
import type { SortDirection } from "./SortDirection.js";

export type ThreadItemsListParams = {
	threadId: string,
	turnId?: string | null,
	cursor?: string | null,
	limit?: number | null,
	sortDirection?: SortDirection | null,
};
