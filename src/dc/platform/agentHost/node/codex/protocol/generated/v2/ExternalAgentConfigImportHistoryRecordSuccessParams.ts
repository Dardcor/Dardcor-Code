
import type { ExternalAgentConfigMigrationItemType } from "./ExternalAgentConfigMigrationItemType.js";

export type ExternalAgentConfigImportHistoryRecordSuccessParams = {
	itemType: ExternalAgentConfigMigrationItemType, cwd: string | null, source: string | null, target: string | null,
	title?: string | null,
};
