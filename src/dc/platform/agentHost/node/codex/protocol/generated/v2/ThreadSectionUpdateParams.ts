
import type { ThreadSectionAppearance } from "./ThreadSectionAppearance.js";

export type ThreadSectionUpdateParams = {
	sectionId: string,
	name: string,
	appearance?: ThreadSectionAppearance | null,
};
