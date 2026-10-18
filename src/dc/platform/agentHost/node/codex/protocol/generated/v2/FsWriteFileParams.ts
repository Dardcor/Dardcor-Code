
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type FsWriteFileParams = {
	path: AbsolutePathBuf,
	dataBase64: string,
};
