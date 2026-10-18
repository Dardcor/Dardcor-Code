
import type { PathUri } from "../PathUri.js";
import type { EnvironmentShellInfo } from "./EnvironmentShellInfo.js";

export type EnvironmentInfoResponse = {
	shell: EnvironmentShellInfo,
	cwd: PathUri | null,
};
