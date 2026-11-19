
import type { ExternalAgentConfigImportItemTypeFailure } from "./ExternalAgentConfigImportItemTypeFailure.js";
import type { ExternalAgentConfigImportItemTypeSuccess } from "./ExternalAgentConfigImportItemTypeSuccess.js";

export type ExternalAgentConfigImportHistory = { importId: string, providerId: string | null, completedAtMs: bigint, successes: Array<ExternalAgentConfigImportItemTypeSuccess>, failures: Array<ExternalAgentConfigImportItemTypeFailure>, };
