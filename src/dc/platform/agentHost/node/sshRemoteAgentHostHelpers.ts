/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { vArray, vObj, vString, vUnknown } from '../../../base/common/validation.js';
import { TelemetryConfiguration } from '../../telemetry/common/telemetry.js';
import { getAgentHostEndpointIdentityKey, IAgentHostEndpointMetadata, parseAgentHostEndpointRegistry } from '../common/agentHostEndpointRegistry.js';
export { redactToken } from '../common/remoteAgentHostBootstrapProgress.js';

export function validateShellToken(value: string, label: string): string {
	if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
		throw new Error(`Unsafe ${label} value for shell interpolation: ${JSON.stringify(value)}`);
	}
	return value;
}

export function validateAgentHostTelemetryLevel(value: unknown): TelemetryConfiguration {
	switch (value) {
		case TelemetryConfiguration.OFF:
		case TelemetryConfiguration.CRASH:
		case TelemetryConfiguration.ERROR:
		case TelemetryConfiguration.ON:
			return value;
		default:
			throw new Error(`Unsafe telemetry level for shell interpolation: ${JSON.stringify(value)}`);
	}
}

export function validateCommit(commit: string): string {
	const normalized = commit.toLowerCase();
	if (!/^[0-9a-f]{40}$/.test(normalized)) {
		throw new Error(`Unsafe commit value (expected 40-char hex SHA): ${JSON.stringify(commit)}`);
	}
	return normalized;
}

export function getRemoteCLIArchiveName(quality: string): string {
	const q = validateShellToken(quality, 'quality');
	switch (q) {
		case 'stable': return 'code';
		case 'exploration': return 'code-exploration';
		default: return 'code-insiders';
	}
}

export function getRemoteCLIInstallRoot(serverDataFolderName: string): string {
	const d = validateShellToken(serverDataFolderName, 'server data folder name');
	return `~/${d}`;
}

export function getRemoteCLIDataDir(serverDataFolderName: string): string {
	return `${getRemoteCLIInstallRoot(serverDataFolderName)}/cli`;
}

export function getRemoteCLIBin(serverDataFolderName: string, quality: string, commit?: string): string {
	const archive = getRemoteCLIArchiveName(quality);
	const root = getRemoteCLIInstallRoot(serverDataFolderName);
	if (commit) {
		const c = validateCommit(commit);
		return `${root}/${archive}-${c}`;
	}
	return `${root}/${archive}`;
}

export function shellEscape(s: string): string {
	const escaped = s.replace(/'/g, '\'\\\'\'');
	return `'${escaped}'`;
}

export function buildAgentHostBaseCommand(cliBin: string, cliDataDir: string, telemetryLevel: TelemetryConfiguration): string {
	return `${cliBin} --cli-data-dir ${cliDataDir} --telemetry-level ${validateAgentHostTelemetryLevel(telemetryLevel)} agent host --port 0`;
}

export function resolveRemotePlatform(unameS: string, unameM: string, libc = ''): { os: string; arch: string } | undefined {
	const os = unameS.trim().toLowerCase();
	const machine = unameM.trim().toLowerCase();
	const normalizedLibc = libc.trim().toLowerCase();

	let platformOs: string;
	if (os === 'linux') {
		platformOs = normalizedLibc === 'musl' ? 'alpine' : 'linux';
	} else if (os === 'darwin') {
		platformOs = 'darwin';
	} else {
		return undefined;
	}

	let arch: string;
	if (machine === 'x86_64' || machine === 'amd64') {
		arch = 'x64';
	} else if (machine === 'aarch64' || machine === 'arm64') {
		arch = 'arm64';
	} else if (machine === 'armv7l') {
		arch = 'armhf';
	} else {
		return undefined;
	}

	if (platformOs === 'alpine' && arch === 'armhf') {
		return undefined;
	}

	return { os: platformOs, arch };
}

export function buildCLIDownloadUrl(os: string, arch: string, quality: string, commit?: string): string {
	const base = 'https://update.code.visualstudio.com';
	const artifact = `cli-${os}-${arch}`;
	if (commit) {
		const c = validateCommit(commit);
		return `${base}/commit:${c}/${artifact}/${quality}`;
	}
	return `${base}/latest/${artifact}/${quality}`;
}

export function buildCleanupOldCLIsCommand(serverDataFolderName: string, quality: string): string {
	const root = getRemoteCLIInstallRoot(serverDataFolderName);
	const archive = getRemoteCLIArchiveName(quality);
	const commitGlob = '[0-9a-f]'.repeat(40);
	return `ls -1t -- ${root}/${archive}-${commitGlob} 2>/dev/null | awk 'NR>5' | xargs -I{} rm -f -- {} 2>/dev/null; true`;
}

export function buildFindFallbackCLICommand(serverDataFolderName: string, quality: string): string {
	const root = getRemoteCLIInstallRoot(serverDataFolderName);
	const relativeRoot = root.slice(2);
	const archive = getRemoteCLIArchiveName(quality);
	const commitGlob = '[0-9a-f]'.repeat(40);
	const q = validateShellToken(quality, 'quality');
	const legacyDir = q === 'stable' ? '~/.vscode-cli' : `~/.vscode-cli-${q}`;
	const legacyBin = `${legacyDir}/${archive}`;
	return [
		`(cd ~ && ls -1t -- ${relativeRoot}/${archive}-${commitGlob} 2>/dev/null | sed 's#^#~/#')`,
		`test ! -f ${legacyBin} || printf '%s\\n' ${shellEscape(legacyBin)}`,
		'true',
	].join('; ');
}

export function isValidFallbackCLIPath(candidate: string, serverDataFolderName: string, quality: string): boolean {
	const root = getRemoteCLIInstallRoot(serverDataFolderName);
	const archive = getRemoteCLIArchiveName(quality);
	const q = validateShellToken(quality, 'quality');
	const legacyDir = q === 'stable' ? '~/.vscode-cli' : `~/.vscode-cli-${q}`;
	const legacyBin = `${legacyDir}/${archive}`;
	if (candidate === legacyBin) {
		return true;
	}
	const pinnedPrefix = `${root}/${archive}-`;
	if (candidate.startsWith(pinnedPrefix)) {
		const suffix = candidate.slice(pinnedPrefix.length);
		return /^[0-9a-f]{40}$/.test(suffix);
	}
	return false;
}

const AGENT_HOST_WS_URL_RE = /ws:\/\/(?:127\.0\.0\.1|localhost):(\d+)(?:\?tkn=([^\s&]+))?/;

export function extractAgentHostWebSocketURL(text: string): { url: string; host: string; port: number; token: string | undefined } | undefined {
	const match = text.match(AGENT_HOST_WS_URL_RE);
	if (!match) {
		return undefined;
	}
	return {
		url: match[0],
		host: '127.0.0.1',
		port: parseInt(match[1], 10),
		token: match[2] || undefined,
	};
}

export interface ISshExec {
	(command: string, opts?: { ignoreExitCode?: boolean }): Promise<{ stdout: string; stderr: string; code: number }>;
}

export function dialAgentHostHost(bound: string | undefined): string {
	if (!bound || bound === '0.0.0.0' || bound === '::' || bound === '[::]') {
		return '127.0.0.1';
	}
	return bound;
}

export function buildAgentEndpointsCommand(cliBin: string, cliDataDir: string, userDataPath?: string): string {
	const userDataArg = userDataPath ? ` --user-data-dir ${shellEscape(userDataPath)}` : '';
	return `${cliBin} --cli-data-dir ${cliDataDir} agent endpoints${userDataArg}`;
}

export function buildAgentHostSpawnCommand(cliBin: string, cliDataDir: string, userDataPath: string, telemetryLevel: TelemetryConfiguration, idleTimeoutSec = 300): string {
	if (!Number.isSafeInteger(idleTimeoutSec) || idleTimeoutSec <= 0) {
		throw new Error(`Unsafe idle timeout value for shell interpolation: ${JSON.stringify(idleTimeoutSec)}`);
	}
	return `${buildAgentHostBaseCommand(cliBin, cliDataDir, telemetryLevel)} --new-instance --user-data-dir ${shellEscape(userDataPath)} --idle-timeout ${idleTimeoutSec}`;
}

export function buildAgentRelayCommand(cliBin: string, cliDataDir: string, instanceId: string, userDataPath: string): string {
	return `${cliBin} --cli-data-dir ${cliDataDir} agent relay ${shellEscape(instanceId)} --user-data-dir ${shellEscape(userDataPath)}`;
}

export interface IAgentEndpointsResult {
	readonly userDataPath: string;
	readonly endpoints: readonly IAgentHostEndpointMetadata[];
}

const agentEndpointsEnvelopeValidator = vObj({
	userDataPath: vString(),
	endpoints: vArray(vUnknown()),
});

export function parseAgentEndpointsOutput(stdout: string): IAgentEndpointsResult | undefined {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return undefined;
	}
	const candidates = [trimmed];
	const lastLine = trimmed.split('\n').at(-1)?.trim();
	if (lastLine && lastLine !== trimmed) {
		candidates.push(lastLine);
	}
	for (const candidate of candidates) {
		const result = parseAgentEndpointsDocument(candidate);
		if (result) {
			return result;
		}
	}
	return undefined;
}

function parseAgentEndpointsDocument(value: string): IAgentEndpointsResult | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(value);
	} catch {
		return undefined;
	}
	const { content, error } = agentEndpointsEnvelopeValidator.validate(raw);
	if (error) {
		return undefined;
	}
	return {
		userDataPath: content.userDataPath,
		endpoints: parseAgentHostEndpointRegistry(content.endpoints),
	};
}

export async function runAgentEndpoints(exec: ISshExec, cliBin: string, cliDataDir: string, userDataPath?: string): Promise<IAgentEndpointsResult> {
	const command = buildAgentEndpointsCommand(cliBin, cliDataDir, userDataPath);
	const { stdout, stderr, code } = await exec(command, { ignoreExitCode: true });
	if (code !== 0) {
		throw new Error(`'agent endpoints' failed (exit code ${code})${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
	}
	const result = parseAgentEndpointsOutput(stdout);
	if (!result) {
		throw new Error(`'agent endpoints' produced unparsable output (${stdout.length} characters)`);
	}
	return result;
}

export async function filterLiveAgentHostEndpoints(exec: ISshExec, entries: readonly IAgentHostEndpointMetadata[]): Promise<IAgentHostEndpointMetadata[]> {
	const pids = [...new Set(entries.map(e => e.pid))];
	const alive = new Set<number>();
	await Promise.all(pids.map(async pid => {
		const { code } = await exec(`kill -0 ${pid} 2>/dev/null`, { ignoreExitCode: true });
		if (code === 0) {
			alive.add(pid);
		}
	}));
	return entries.filter(e => alive.has(e.pid));
}

export function findNewAgentHostEndpoint(before: readonly IAgentHostEndpointMetadata[], after: readonly IAgentHostEndpointMetadata[]): IAgentHostEndpointMetadata | undefined {
	const beforeKeys = new Set(before.map(getAgentHostEndpointIdentityKey));
	return after.find(entry => entry.type === 'standalone' && !beforeKeys.has(getAgentHostEndpointIdentityKey(entry)));
}

export interface IWaitForNewEndpointOptions {
	readonly timeoutMs?: number;
	readonly intervalMs?: number;
	readonly token?: CancellationToken;
	readonly progress?: (elapsedMs: number) => void;
}

const DEFAULT_ENDPOINT_REGISTRATION_POLL_COUNT = 20;
const MAX_ENDPOINT_REGISTRATION_POLL_INTERVAL_MS = 5_000;
const ENDPOINT_REGISTRATION_PROGRESS_INTERVAL_MS = 10_000;
export const COLD_AGENT_HOST_REGISTRATION_TIMEOUT_MS = 300_000;

export function getNewAgentHostRegistrationTimeoutMs(installedCLI: boolean): number | undefined {
	return installedCLI ? COLD_AGENT_HOST_REGISTRATION_TIMEOUT_MS : undefined;
}

export async function waitForNewStandaloneEndpoint(
	exec: ISshExec,
	cliBin: string,
	cliDataDir: string,
	userDataPath: string,
	before: readonly IAgentHostEndpointMetadata[],
	options?: IWaitForNewEndpointOptions,
): Promise<IAgentHostEndpointMetadata> {
	const initialIntervalMs = options?.intervalMs ?? 500;
	const timeoutMs = options?.timeoutMs ?? DEFAULT_ENDPOINT_REGISTRATION_POLL_COUNT * initialIntervalMs;
	const startTime = Date.now();
	const deadline = startTime + timeoutMs;
	let polls = 0;
	let nextProgressReport = ENDPOINT_REGISTRATION_PROGRESS_INTERVAL_MS;

	while (true) {
		if (options?.token?.isCancellationRequested) {
			throw new CancellationError();
		}
		const { endpoints } = await runAgentEndpoints(exec, cliBin, cliDataDir, userDataPath);
		const found = findNewAgentHostEndpoint(before, endpoints);
		if (found) {
			return found;
		}

		polls++;
		const elapsedMs = Date.now() - startTime;
		if (elapsedMs >= nextProgressReport) {
			options?.progress?.(elapsedMs);
			nextProgressReport = (Math.floor(elapsedMs / ENDPOINT_REGISTRATION_PROGRESS_INTERVAL_MS) + 1) * ENDPOINT_REGISTRATION_PROGRESS_INTERVAL_MS;
		}
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for the newly spawned agent host to register itself after ${Date.now() - startTime}ms (deadline ${timeoutMs}ms)`);
		}

		const intervalMs = Math.min(
			initialIntervalMs * 2 ** Math.floor((polls - 1) / 10),
			MAX_ENDPOINT_REGISTRATION_POLL_INTERVAL_MS,
			deadline - Date.now(),
		);
		if (options?.token) {
			await timeout(intervalMs, options.token);
		} else {
			await timeout(intervalMs);
		}
	}
}
