
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type FsRemoveParams = {
	path: AbsolutePathBuf,
	recursive?: boolean | null,
	force?: boolean | null,
};
