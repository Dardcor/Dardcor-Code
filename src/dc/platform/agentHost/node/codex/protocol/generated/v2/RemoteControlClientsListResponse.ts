
import type { RemoteControlClient } from "./RemoteControlClient.js";

export type RemoteControlClientsListResponse = { data: Array<RemoteControlClient>, nextCursor: string | null, };
