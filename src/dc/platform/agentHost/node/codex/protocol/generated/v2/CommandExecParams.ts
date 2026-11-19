
import type { CommandExecTerminalSize } from "./CommandExecTerminalSize.js";
import type { SandboxPolicy } from "./SandboxPolicy.js";

export type CommandExecParams = {
	command: Array<string>,
	processId?: string | null,
	tty?: boolean,
	streamStdin?: boolean,
	streamStdoutStderr?: boolean,
	outputBytesCap?: number | null,
	disableOutputCap?: boolean,
	disableTimeout?: boolean,
	timeoutMs?: number | null,
	cwd?: string | null,
	env?: { [key in string]?: string | null } | null,
	size?: CommandExecTerminalSize | null,
	sandboxPolicy?: SandboxPolicy | null,
	permissionProfile?: string | null,
};
