/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import { join } from '../../../base/common/path.js';
import { ILogService } from '../../log/common/log.js';
import { IRemoteAgentHostState, parseRemoteAgentHostState } from '../common/remoteAgentHostMetadata.js';
import { dialAgentHostHost, validateShellToken } from './sshRemoteAgentHostHelpers.js';

const LOG_PREFIX = '[AgentHostLockfile]';

export function getLocalAgentHostLockfilePath(serverDataFolderName: string, quality: string): string {
	const d = validateShellToken(serverDataFolderName, 'server data folder name');
	const q = validateShellToken(quality, 'quality');
	return join(os.homedir(), d, 'cli', `agent-host-${q}.lock`);
}

export async function readLocalAgentHostLockfile(lockfilePath: string, logService?: ILogService): Promise<IRemoteAgentHostState | undefined> {
	let raw: string;
	try {
		raw = await fs.promises.readFile(lockfilePath, 'utf8');
	} catch (err: unknown) {
		const code = (err as NodeJS.ErrnoException | undefined)?.code;
		if (code !== 'ENOENT') {
			logService?.warn(`${LOG_PREFIX} Failed to read agent host lockfile ${lockfilePath}: ${err}`);
		}
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		logService?.info(`${LOG_PREFIX} Agent host lockfile ${lockfilePath} contains invalid JSON`);
		return undefined;
	}

	const state = parseRemoteAgentHostState(parsed);
	if (!state) {
		logService?.info(`${LOG_PREFIX} Agent host lockfile ${lockfilePath} does not match expected schema`);
		return undefined;
	}
	return state;
}

export type LocalAgentHostLookupResult =
	| { readonly kind: 'notFound' }
	| { readonly kind: 'stale'; readonly pid: number }
	| { readonly kind: 'compatible'; readonly pid: number; readonly host: string; readonly port: number; readonly connectionToken: string | undefined };

export async function readActiveAgentHostFromLockfile(lockfilePath: string, logService: ILogService): Promise<LocalAgentHostLookupResult> {
	const state = await readLocalAgentHostLockfile(lockfilePath, logService);
	if (!state) {
		return { kind: 'notFound' };
	}

	if (!isPidAlive(state.pid)) {
		logService.info(`${LOG_PREFIX} Stale agent host lockfile ${lockfilePath} (PID ${state.pid} not running)`);
		return { kind: 'stale', pid: state.pid };
	}

	logService.info(`${LOG_PREFIX} Found running agent host via ${lockfilePath}: PID ${state.pid}, port ${state.port}`);
	return {
		kind: 'compatible',
		pid: state.pid,
		host: dialAgentHostHost(state.host),
		port: state.port,
		connectionToken: state.connectionToken ?? undefined,
	};
}

export function isPidAlive(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (err: unknown) {
		const code = (err as NodeJS.ErrnoException | undefined)?.code;
		return code === 'EPERM';
	}
}
