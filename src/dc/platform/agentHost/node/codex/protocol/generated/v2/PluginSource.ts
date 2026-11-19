
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";

export type PluginSource = { "type": "local", path: AbsolutePathBuf, } | { "type": "git", url: string, path: string | null, refName: string | null, sha: string | null, } | {
	"type": "npm", package: string,
	version: string | null,
	registry: string | null,
} | { "type": "remote" };
