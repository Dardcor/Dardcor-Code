
import type { LegacyAppPathString } from "../LegacyAppPathString.js";

export type ThreadBackgroundTerminal = { itemId: string, processId: string, command: string, cwd: LegacyAppPathString, osPid: number | null, cpuPercent: number | null, rssKb: bigint | null, };
