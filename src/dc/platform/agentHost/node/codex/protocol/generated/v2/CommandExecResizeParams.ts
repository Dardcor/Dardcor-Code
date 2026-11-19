
import type { CommandExecTerminalSize } from "./CommandExecTerminalSize.js";

export type CommandExecResizeParams = {
	processId: string,
	size: CommandExecTerminalSize,
};
