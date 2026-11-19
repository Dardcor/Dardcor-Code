
import type { AuthMode } from "./AuthMode.js";

export type GetAuthStatusResponse = { authMethod: AuthMode | null, authToken: string | null, requiresOpenaiAuth: boolean | null, };
