
import type { SortDirection } from "./SortDirection.js";
import type { TurnItemsView } from "./TurnItemsView.js";

export type ThreadTurnsListParams = {
	threadId: string,
	cursor?: string | null,
	limit?: number | null,
	sortDirection?: SortDirection | null,
	itemsView?: TurnItemsView | null,
};
