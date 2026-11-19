
import type { ExternalAgentConfigMigrationItem } from "./ExternalAgentConfigMigrationItem.js";
import type { ExternalAgentDetectedConnectorCandidate } from "./ExternalAgentDetectedConnectorCandidate.js";

export type ExternalAgentConfigDetectResponse = { items: Array<ExternalAgentConfigMigrationItem>, connectors: Array<ExternalAgentDetectedConnectorCandidate>, };
