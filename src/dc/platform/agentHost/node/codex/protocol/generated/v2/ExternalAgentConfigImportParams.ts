
import type { ExternalAgentConfigMigrationItem } from "./ExternalAgentConfigMigrationItem.js";

export type ExternalAgentConfigImportParams = {
	migrationItems: Array<ExternalAgentConfigMigrationItem>,
	source?: string | null,
	providerId?: string | null,
	migrationSource?: string | null,
};
