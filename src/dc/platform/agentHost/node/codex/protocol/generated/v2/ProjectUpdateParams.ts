
import type { ProjectRoot } from "./ProjectRoot.js";

export type ProjectUpdateParams = { projectId: string, name?: string | null, roots?: Array<ProjectRoot> | null, metadata?: { [key in string]?: string } | null, };
