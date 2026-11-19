
import type { RemoteControlConnectionStatus } from "./RemoteControlConnectionStatus.js";

export type RemoteControlDisableResponse = { status: RemoteControlConnectionStatus, serverName: string, installationId: string, environmentId: string | null, };
