
import type { SortDirection } from "./SortDirection.js";
import type { TurnItemsView } from "./TurnItemsView.js";

export type ThreadResumeInitialTurnsPageParams = {
	limit?: number | null,
	sortDirection?: SortDirection | null,
	itemsView?: TurnItemsView | null,
};
