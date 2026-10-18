
import type { AbsolutePathBuf } from "./AbsolutePathBuf.js";

export type InitializeResponse = {
	userAgent: string,
	codexHome: AbsolutePathBuf,
	platformFamily: string,
	platformOs: string,
};
