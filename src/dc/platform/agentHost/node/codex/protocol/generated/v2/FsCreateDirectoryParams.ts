
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type FsCreateDirectoryParams = {
	path: AbsolutePathBuf,
	recursive?: boolean | null,
};
