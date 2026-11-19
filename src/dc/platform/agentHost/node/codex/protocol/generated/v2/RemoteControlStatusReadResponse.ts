
import type { RemoteControlConnectionStatus } from "./RemoteControlConnectionStatus.js";

export type RemoteControlStatusReadResponse = { status: RemoteControlConnectionStatus, serverName: string, installationId: string, environmentId: string | null, };
