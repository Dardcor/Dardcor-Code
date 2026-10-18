
import type { AppInfo } from "./AppInfo.js";

export type AppsListResponse = {
	data: Array<AppInfo>,
	nextCursor: string | null,
};
