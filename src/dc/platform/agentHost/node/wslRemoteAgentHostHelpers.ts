/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { join } from '../../../base/common/path.js';
import { TelemetryConfiguration } from '../../telemetry/common/telemetry.js';
import { AgentHostTelemetryLevelEnvKey } from '../common/agentHostTelemetryEnv.js';
import type { IWSLDistro } from '../common/wslRemoteAgentHost.js';
import {
	buildAgentHostBaseCommand,
	buildCLIDownloadUrl,
	buildCleanupOldCLIsCommand,
	extractAgentHostWebSocketURL,
	getRemoteCLIBin,
	getRemoteCLIDataDir,
	getRemoteCLIInstallRoot,
	shellEscape,
	validateAgentHostTelemetryLevel,
	validateShellToken,
} from './sshRemoteAgentHostHelpers.js';

export { extractAgentHostWebSocketURL };

export function getWslExePath(): string {
	const systemRoot = process.env['SystemRoot'];
	if (!systemRoot) {
		return 'wsl.exe';
	}
	return join(systemRoot, 'System32', 'wsl.exe');
}

export async function isWSLSupported(): Promise<boolean> {
	if (process.platform !== 'win32') {
		return false;
	}
	try {
		const result = await runWslCommand(['--status'], { timeout: 5_000 });
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

export interface IRunWslCommandOptions {
	readonly timeout?: number;
	readonly distro?: string;
}

export interface IRunWslCommandResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

export function runWslCommand(args: readonly string[], options?: IRunWslCommandOptions): Promise<IRunWslCommandResult> {
	return new Promise((resolve, reject) => {
		const fullArgs = options?.distro ? ['-d', options.distro, ...args] : [...args];
		const child = cp.spawn(getWslExePath(), fullArgs, {
			env: { ...process.env, WSL_UTF8: '1' },
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let settled = false;

		const timeout = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			try {
				child.kill('SIGKILL');
			} catch { }
			reject(new Error(`wsl.exe ${fullArgs.join(' ')} timed out after ${options?.timeout ?? 30_000}ms`));
		}, options?.timeout ?? 30_000);

		child.stdout?.on('data', chunk => stdoutChunks.push(chunk));
		child.stderr?.on('data', chunk => stderrChunks.push(chunk));

		child.on('error', err => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			reject(err);
		});

		child.on('close', exitCode => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			resolve({
				stdout: decodeWslOutput(Buffer.concat(stdoutChunks)),
				stderr: decodeWslOutput(Buffer.concat(stderrChunks)),
				exitCode: exitCode ?? -1,
			});
		});
	});
}

export function decodeWslOutput(buffer: Buffer): string {
	if (buffer.length === 0) {
		return '';
	}
	if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
		return buffer.toString('utf16le', 2);
	}
	const sampleLen = Math.min(buffer.length, 16);
	if (sampleLen >= 4) {
		let zeros = 0;
		let total = 0;
		for (let i = 1; i < sampleLen; i += 2) {
			total++;
			if (buffer[i] === 0) {
				zeros++;
			}
		}
		if (total > 0 && zeros / total >= 0.75) {
			let text = buffer.toString('utf16le');
			if (text.charCodeAt(0) === 0xfeff) {
				text = text.slice(1);
			}
			return text;
		}
	}
	let text = buffer.toString('utf8');
	if (text.charCodeAt(0) === 0xfeff) {
		text = text.slice(1);
	}
	return text;
}

export function parseWslListVerbose(output: string): IWSLDistro[] {
	if (!output) {
		return [];
	}
	const stripped = output.charCodeAt(0) === 0xfeff ? output.slice(1) : output;
	const lines = stripped.split(/\r\n|\r|\n/);
	const distros: IWSLDistro[] = [];
	let headerSeen = false;
	for (const rawLine of lines) {
		const line = rawLine.replace(/\s+$/, '');
		if (!line.trim()) {
			continue;
		}
		if (!headerSeen) {
			const upper = line.trim().toUpperCase();
			if (upper.startsWith('NAME')) {
				headerSeen = true;
				continue;
			}
		}
		let working = line;
		let isDefault = false;
		if (working.startsWith('* ') || working.startsWith('*\t')) {
			isDefault = true;
			working = working.slice(2);
		} else if (working.startsWith('  ') || working.startsWith(' \t')) {
			working = working.slice(2);
		} else if (working.startsWith(' ')) {
			working = working.slice(1);
		}
		const columns = working.trim().split(/\s+/);
		if (columns.length < 3) {
			continue;
		}
		const version = parseInt(columns[columns.length - 1], 10);
		if (version !== 2) {
			continue;
		}
		const state = columns[columns.length - 2];
		const name = columns.slice(0, columns.length - 2).join(' ');
		if (!name) {
			continue;
		}
		distros.push({
			name,
			isDefault,
			isRunning: state.toLowerCase() === 'running',
			version: 2,
		});
	}
	return distros;
}

export function parseRunningDistros(output: string): string[] {
	if (!output) {
		return [];
	}
	const stripped = output.charCodeAt(0) === 0xfeff ? output.slice(1) : output;
	return stripped
		.split(/\r\n|\r|\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0);
}

export interface IComposeAgentHostBootstrapScriptArgs {
	readonly serverDataFolderName: string;
	readonly quality: string;
	readonly commit: string | undefined;
	readonly os: string;
	readonly arch: string;
	readonly telemetryLevel?: TelemetryConfiguration;
	readonly remoteAgentHostCommand?: string;
}

export function composeAgentHostBootstrapScript(args: IComposeAgentHostBootstrapScriptArgs): string {
	const telemetryLevel = validateAgentHostTelemetryLevel(args.telemetryLevel ?? TelemetryConfiguration.OFF);
	if (args.remoteAgentHostCommand) {
		return `export ${AgentHostTelemetryLevelEnvKey}=${telemetryLevel} && ${args.remoteAgentHostCommand}`;
	}
	const installRoot = getRemoteCLIInstallRoot(args.serverDataFolderName);
	const cliBin = getRemoteCLIBin(args.serverDataFolderName, args.quality, args.commit);
	const cliDataDir = getRemoteCLIDataDir(args.serverDataFolderName);
	const url = buildCLIDownloadUrl(args.os, args.arch, args.quality, args.commit);
	const agentHostCommand = buildAgentHostBaseCommand(cliBin, cliDataDir, telemetryLevel);
	const launch = buildWslAgentHostLaunch(agentHostCommand);

	if (args.commit) {
		const cleanup = buildCleanupOldCLIsCommand(args.serverDataFolderName, args.quality);
		const installSteps = [
			`tmpdir=$(mktemp -d ${installRoot}/.cli-install-XXXXXX)`,
			`(cd "$tmpdir" && curl -fsSL ${shellEscape(url)} | tar xz)`,
			`mv "$tmpdir"/* ${cliBin}`,
			`chmod +x ${cliBin}`,
			`rm -rf "$tmpdir"`,
		].join(' && ');
		return [
			`mkdir -p ${installRoot}`,
			`if [ ! -x ${cliBin} ]; then ${installSteps}; fi`,
			`touch -- ${cliBin} 2>/dev/null || true`,
			`(${cleanup}) >/dev/null 2>&1 || true`,
			launch,
		].join(' && ');
	}

	const installLoose = `curl -fsSL ${shellEscape(url)} | tar xz -C ${installRoot} && chmod +x ${cliBin}`;
	return [
		`mkdir -p ${installRoot}`,
		`if [ ! -x ${cliBin} ]; then ${installLoose}; fi`,
		launch,
	].join(' && ');
}

function buildWslAgentHostLaunch(command: string, idleTimeoutSec = 300): string {
	if (!Number.isSafeInteger(idleTimeoutSec) || idleTimeoutSec <= 0) {
		throw new Error(`Unsafe idle timeout value for shell interpolation: ${JSON.stringify(idleTimeoutSec)}`);
	}
	return `exec ${command} --idle-timeout ${idleTimeoutSec}`;
}

export function validateDistroName(name: string): string {
	return validateShellToken(name, 'WSL distro name');
}
