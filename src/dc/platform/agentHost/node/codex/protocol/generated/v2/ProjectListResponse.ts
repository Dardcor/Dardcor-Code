
import type { Project } from "./Project.js";

export type ProjectListResponse = { data: Array<Project>, nextCursor: string | null, };
