
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type SkillsConfigWriteParams = {
	path?: AbsolutePathBuf | null,
	name?: string | null, enabled: boolean,
};
