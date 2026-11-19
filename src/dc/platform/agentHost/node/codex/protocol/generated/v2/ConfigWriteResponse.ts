
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { OverriddenMetadata } from "./OverriddenMetadata.js";
import type { WriteStatus } from "./WriteStatus.js";

export type ConfigWriteResponse = {
	status: WriteStatus, version: string,
	filePath: AbsolutePathBuf, overriddenMetadata: OverriddenMetadata | null,
};
