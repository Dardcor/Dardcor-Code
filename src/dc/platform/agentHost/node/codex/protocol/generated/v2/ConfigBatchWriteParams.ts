
import type { ConfigEdit } from "./ConfigEdit.js";

export type ConfigBatchWriteParams = {
	edits: Array<ConfigEdit>,
	filePath?: string | null, expectedVersion?: string | null,
	reloadUserConfig?: boolean,
};
