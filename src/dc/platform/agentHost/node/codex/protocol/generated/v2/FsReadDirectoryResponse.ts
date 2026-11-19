
import type { FsReadDirectoryEntry } from "./FsReadDirectoryEntry.js";

export type FsReadDirectoryResponse = {
	entries: Array<FsReadDirectoryEntry>,
};
