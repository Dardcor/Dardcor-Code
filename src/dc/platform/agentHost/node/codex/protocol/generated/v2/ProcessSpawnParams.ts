
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { ProcessTerminalSize } from "./ProcessTerminalSize.js";

export type ProcessSpawnParams = {
	command: Array<string>,
	processHandle: string,
	cwd: AbsolutePathBuf,
	tty?: boolean,
	streamStdin?: boolean,
	streamStdoutStderr?: boolean,
	outputBytesCap?: number | null,
	timeoutMs?: number | null,
	env?: { [key in string]?: string | null } | null,
	size?: ProcessTerminalSize | null,
};
