
import type { ProcessTerminalSize } from "./ProcessTerminalSize.js";

export type ProcessResizePtyParams = {
	processHandle: string,
	size: ProcessTerminalSize,
};
