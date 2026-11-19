
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type FsCopyParams = {
	sourcePath: AbsolutePathBuf,
	destinationPath: AbsolutePathBuf,
	recursive?: boolean,
};
