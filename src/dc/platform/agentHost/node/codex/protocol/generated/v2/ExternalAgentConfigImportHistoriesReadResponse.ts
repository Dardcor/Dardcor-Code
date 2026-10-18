
import type { ExternalAgentConfigImportHistory } from "./ExternalAgentConfigImportHistory.js";
import type { ExternalAgentImportedConnectorCandidate } from "./ExternalAgentImportedConnectorCandidate.js";

export type ExternalAgentConfigImportHistoriesReadResponse = { data: Array<ExternalAgentConfigImportHistory>, connectors: Array<ExternalAgentImportedConnectorCandidate>, };
