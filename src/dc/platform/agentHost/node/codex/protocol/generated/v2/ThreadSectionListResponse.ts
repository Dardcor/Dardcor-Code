
import type { ThreadSection } from "./ThreadSection.js";

export type ThreadSectionListResponse = {
	data: Array<ThreadSection>,
	nextCursor: string | null,
};
