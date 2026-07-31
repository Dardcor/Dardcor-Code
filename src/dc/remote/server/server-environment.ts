/**
 * Dardcor Code - Remote Host System Information & OS Detector (Task 812)
 */

import os from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { isWindows, isLinux, isMacintosh } from '../../core/environment/platform';

export interface ServerEnvironmentInfo {
	readonly platform: string;
	readonly release: string;
	readonly arch: string;
	readonly cpuCount: number;
	readonly totalMemory: number;
	readonly freeMemory: number;
	readonly hostname: string;
	readonly nodeVersion: string;
	readonly nodeExecPath: string;
	readonly homeDir: string;
	readonly tempDir: string;
	readonly pid: number;
	readonly workspaceRoot: string;
	readonly isWindows: boolean;
	readonly isLinux: boolean;
	readonly isMacintosh: boolean;
	readonly isContainer: boolean;
	readonly uptimeSeconds: number;
}

export function detectContainerEnvironment(): boolean {
	if (typeof process === 'undefined' || !process.versions?.node) {
		return false;
	}
	if (os.platform() !== 'linux') {
		return false;
	}
	try {
		if (existsSync('/.dockerenv')) {
			return true;
		}
		const cgroup = readFileSync('/proc/1/cgroup', 'utf8');
		return cgroup.includes('docker') || cgroup.includes('containerd');
	} catch {
		return false;
	}
}

export class ServerEnvironment {
	constructor(private readonly _workspaceRoot: string) {}

	get workspaceRoot(): string {
		return this._workspaceRoot;
	}

	getInfo(): ServerEnvironmentInfo {
		const isNode = typeof process !== 'undefined' && !!process.versions?.node;
		return {
			platform: isNode ? os.platform() : 'unknown',
			release: isNode ? os.release() : 'unknown',
			arch: isNode ? os.arch() : 'unknown',
			cpuCount: isNode ? os.cpus().length : 0,
			totalMemory: isNode ? os.totalmem() : 0,
			freeMemory: isNode ? os.freemem() : 0,
			hostname: isNode ? os.hostname() : 'unknown',
			nodeVersion: isNode ? process.version : 'unknown',
			nodeExecPath: isNode ? process.execPath : '',
			homeDir: isNode ? os.homedir() : '',
			tempDir: isNode ? os.tmpdir() : '',
			pid: typeof process !== 'undefined' ? process.pid : 0,
			workspaceRoot: this._workspaceRoot,
			isWindows,
			isLinux,
			isMacintosh,
			isContainer: detectContainerEnvironment(),
			uptimeSeconds: isNode ? os.uptime() : 0
		};
	}

	toJson(): string {
		return JSON.stringify(this.getInfo());
	}
}
