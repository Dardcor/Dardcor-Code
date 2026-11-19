
import type { SortDirection } from "./SortDirection.js";
import type { ThreadSearchSortKey } from "./ThreadSearchSortKey.js";
import type { ThreadSourceKind } from "./ThreadSourceKind.js";

export type ThreadSearchParams = {
	cursor?: string | null,
	limit?: number | null,
	sortKey?: ThreadSearchSortKey | null,
	sortDirection?: SortDirection | null,
	sourceKinds?: Array<ThreadSourceKind> | null,
	archived?: boolean | null,
	searchTerm: string,
};
