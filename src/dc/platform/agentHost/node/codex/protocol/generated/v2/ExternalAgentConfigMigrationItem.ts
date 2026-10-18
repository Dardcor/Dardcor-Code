
import type { ExternalAgentConfigMigrationItemType } from "./ExternalAgentConfigMigrationItemType.js";
import type { MigrationDetails } from "./MigrationDetails.js";

export type ExternalAgentConfigMigrationItem = {
	itemType: ExternalAgentConfigMigrationItemType, description: string,
	cwd: string | null, details: MigrationDetails | null,
};
