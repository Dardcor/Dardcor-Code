
import type { ClientInfo } from "./ClientInfo.js";
import type { InitializeCapabilities } from "./InitializeCapabilities.js";

export type InitializeParams = { clientInfo: ClientInfo, capabilities: InitializeCapabilities | null, };
