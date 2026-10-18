
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type SkillInterface = {
	displayName?: string, shortDescription?: string, iconSmall?: AbsolutePathBuf, iconLarge?: AbsolutePathBuf,
	iconSmallUrl: string | null,
	iconLargeUrl: string | null, brandColor?: string, defaultPrompt?: string,
};
