
import type { ExternalAgentConfigImportHistoryRecordSuccessParams } from "./ExternalAgentConfigImportHistoryRecordSuccessParams.js";
import type { ExternalAgentConfigImportItemTypeFailure } from "./ExternalAgentConfigImportItemTypeFailure.js";
import type { ExternalAgentConfigMigrationItemType } from "./ExternalAgentConfigMigrationItemType.js";

export type ExternalAgentConfigImportHistoryRecordTypeResultParams = { itemType: ExternalAgentConfigMigrationItemType, successes: Array<ExternalAgentConfigImportHistoryRecordSuccessParams>, failures: Array<ExternalAgentConfigImportItemTypeFailure>, };
