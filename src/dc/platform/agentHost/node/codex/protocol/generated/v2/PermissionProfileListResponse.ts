
import type { PermissionProfileSummary } from "./PermissionProfileSummary.js";

export type PermissionProfileListResponse = {
	data: Array<PermissionProfileSummary>,
	nextCursor: string | null,
};
