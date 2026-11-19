
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { SkillInterface } from "./SkillInterface.js";

export type SkillSummary = { name: string, description: string, shortDescription: string | null, interface: SkillInterface | null, path: AbsolutePathBuf | null, enabled: boolean, };
