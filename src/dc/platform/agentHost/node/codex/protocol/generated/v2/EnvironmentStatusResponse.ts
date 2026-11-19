
import type { EnvironmentStatusKind } from "./EnvironmentStatusKind.js";

export type EnvironmentStatusResponse = {
	status: EnvironmentStatusKind,
	error?: string,
};
