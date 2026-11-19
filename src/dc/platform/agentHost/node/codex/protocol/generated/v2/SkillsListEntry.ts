
import type { SkillErrorInfo } from "./SkillErrorInfo.js";
import type { SkillMetadata } from "./SkillMetadata.js";

export type SkillsListEntry = { cwd: string, skills: Array<SkillMetadata>, errors: Array<SkillErrorInfo>, };
