
import type { ProjectRoot } from "./ProjectRoot.js";

export type ProjectCreateParams = { name: string, roots: Array<ProjectRoot>, metadata?: { [key in string]?: string } | null, idempotencyKey: string, };
