
import type { ProjectRoot } from "./ProjectRoot.js";

export type ProjectImportParams = { name: string, roots: Array<ProjectRoot>, metadata?: { [key in string]?: string } | null, threads?: Array<string> | null, idempotencyKey: string, };
