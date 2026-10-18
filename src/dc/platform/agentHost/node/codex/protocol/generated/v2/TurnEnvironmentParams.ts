
import type { LegacyAppPathString } from "../LegacyAppPathString.js";

export type TurnEnvironmentParams = {
	environmentId: string, cwd: LegacyAppPathString,
	runtimeWorkspaceRoots?: Array<LegacyAppPathString> | null,
};
