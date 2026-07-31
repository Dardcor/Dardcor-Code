/**
 * Dardcor Code - Shell Detector & Argument Escaping Engine
 */

import { isWindows } from '../environment/platform.js';

declare const process: any;

export namespace Shell {
	export function escape(arg: string): string {
		if (isWindows) {
			if (/[\s"^&|<>]/g.test(arg)) {
				return `"${arg.replace(/"/g, '""')}"`;
			}
			return arg;
		}
		if (/[\s"'&()|<>;]/g.test(arg)) {
			return `'${arg.replace(/'/g, "'\\''")}'`;
		}
		return arg;
	}

	export function getDefaultShell(): string {
		if (typeof process !== 'undefined' && process.env) {
			if (isWindows) {
				return process.env.COMSPEC || 'powershell.exe';
			}
			return process.env.SHELL || '/bin/bash';
		}
		return isWindows ? 'powershell.exe' : '/bin/bash';
	}
}
