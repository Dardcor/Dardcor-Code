
import type { SortDirection } from "./SortDirection.js";
import type { ThreadSortKey } from "./ThreadSortKey.js";
import type { ThreadSourceKind } from "./ThreadSourceKind.js";

export type ThreadListParams = {
	cursor?: string | null,
	limit?: number | null,
	sortKey?: ThreadSortKey | null,
	sortDirection?: SortDirection | null,
	modelProviders?: Array<string> | null,
	sourceKinds?: Array<ThreadSourceKind> | null,
	archived?: boolean | null,
	sectionId?: string | null,
	projectId?: string | null,
	cwd?: string | Array<string> | null,
	useStateDbOnly?: boolean,
	searchTerm?: string | null,
	parentThreadId?: string | null,
	ancestorThreadId?: string | null,
};
