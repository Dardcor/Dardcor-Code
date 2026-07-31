/**
 * Dardcor Code - Login Shell Environment Resolver (Task 181)
 * Mirrors: vs/platform/environment/node/shellEnv.ts
 */

declare const process: any;
declare const require: any;

export async function resolveUserShellEnv(): Promise<Record<string, string>> {
	if (typeof process === 'undefined' || !process.env) return {};
	if (process.platform === 'win32') {
		return { ...process.env };
	}
	try {
		const os = require('os');
		const userInfo = os.userInfo();
		const shell = userInfo.shell || '/bin/bash';
		const child_process = require('child_process');
		const res = child_process.execSync(`${shell} -ilc env`, { encoding: 'utf8', timeout: 3000 });
		const lines = res.split('\n');
		const env: Record<string, string> = {};
		for (const line of lines) {
			const idx = line.indexOf('=');
			if (idx > 0) {
				env[line.substring(0, idx)] = line.substring(idx + 1).trim();
			}
		}
		return env;
	} catch {
		return { ...process.env };
	}
}
