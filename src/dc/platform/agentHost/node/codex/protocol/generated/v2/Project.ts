
import type { ProjectRoot } from "./ProjectRoot.js";

export type Project = { id: string, name: string, roots: Array<ProjectRoot>, metadata: { [key in string]?: string }, position: number, createdAt: number, updatedAt: number, };
