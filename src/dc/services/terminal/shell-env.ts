/**
 * Dardcor Code - Login Shell Environment Resolver (Task 181)
 * Mirrors: vs/platform/environment/node/shellEnv.ts
 */

import { Process } from '../../core/system/process';

export function getEnvironmentVariable(name: string): string | undefined {
	return Process.env[name];
}

export function getEnvironmentVariables(): Record<string, string | undefined> {
	return { ...Process.env };
}

export async function resolveUserShellEnv(): Promise<Record<string, string>> {
	if (typeof process === 'undefined' || typeof process.env !== 'object') {
		return {};
	}
	const current = { ...process.env } as Record<string, string>;
	if (process.platform === 'win32') {
		return current;
	}
	try {
		const os = await import('node:os');
		const { execFileSync } = await import('node:child_process');
		const shell = os.userInfo().shell || '/bin/bash';
		const out = execFileSync(shell, ['-ilc', 'env'], {
			encoding: 'utf8',
			timeout: 3000,
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		const env: Record<string, string> = {};
		for (const line of out.split('\n')) {
			const idx = line.indexOf('=');
			if (idx > 0) {
				env[line.substring(0, idx)] = line.substring(idx + 1);
			}
		}
		return { ...current, ...env };
	} catch {
		return current;
	}
}
