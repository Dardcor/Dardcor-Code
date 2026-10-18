
import type { RemoteControlConnectionStatus } from "./RemoteControlConnectionStatus.js";

export type RemoteControlEnableResponse = { status: RemoteControlConnectionStatus, serverName: string, installationId: string, environmentId: string | null, };
