
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { SkillDependencies } from "./SkillDependencies.js";
import type { SkillInterface } from "./SkillInterface.js";
import type { SkillScope } from "./SkillScope.js";

export type SkillMetadata = {
	name: string, description: string,
	shortDescription?: string, interface?: SkillInterface, dependencies?: SkillDependencies, path: AbsolutePathBuf, scope: SkillScope, enabled: boolean,
};
