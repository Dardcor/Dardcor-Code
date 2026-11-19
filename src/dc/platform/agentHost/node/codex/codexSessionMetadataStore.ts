/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../log/common/log.js';
import { ISessionDataService } from '../../common/sessionDataService.js';
import type { AgentSelection } from '../../common/state/protocol/state.js';
import { AH_META_WORKSPACELESS_DB_KEY } from '../../common/state/sessionState.js';


export interface ICodexSessionOverlay {
	readonly threadId?: string;
	readonly cwd?: URI;
	readonly modelId?: string;
	readonly agent?: AgentSelection;
	readonly workingDirectories?: readonly URI[];
	readonly ownsManagedWorkingDirectory?: boolean;
	readonly managedWorkingDirectory?: URI;
}

export interface ICodexSessionOverlayUpdate {
	readonly threadId?: string;
	readonly cwd?: URI;
	readonly modelId?: string;
	readonly agent?: AgentSelection | null;
	readonly workingDirectories?: readonly URI[];
	readonly ownsManagedWorkingDirectory?: boolean;
	readonly managedWorkingDirectory?: URI | null;
}

export class CodexSessionMetadataStore {

	private static readonly KEY_THREAD_ID = 'codex.threadId';
	private static readonly KEY_CWD = 'codex.cwd';
	private static readonly KEY_MODEL = 'codex.model';
	private static readonly KEY_AGENT = 'codex.agent';
	private static readonly KEY_OWNS_MANAGED_WORKING_DIRECTORY = 'codex.ownsManagedWorkingDirectory';
	private static readonly KEY_MANAGED_WORKING_DIRECTORY = 'codex.managedWorkingDirectory';
	constructor(
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async hasKnownSession(session: URI): Promise<boolean> {
		const ref = await this._sessionDataService.tryOpenDatabase(session);
		if (!ref) {
			return false;
		}
		try {
			const metadata = await ref.object.getMetadataObject({
				[AH_META_WORKSPACELESS_DB_KEY]: true,
				'codex.external': true,
				[CodexSessionMetadataStore.KEY_THREAD_ID]: true,
				[CodexSessionMetadataStore.KEY_CWD]: true,
				[CodexSessionMetadataStore.KEY_MODEL]: true,
				[CodexSessionMetadataStore.KEY_AGENT]: true,
				[CodexSessionMetadataStore.KEY_OWNS_MANAGED_WORKING_DIRECTORY]: true,
				[CodexSessionMetadataStore.KEY_MANAGED_WORKING_DIRECTORY]: true,
			});
			return Object.values(metadata).some(value => value !== undefined);
		} finally {
			ref.dispose();
		}
	}

	async write(session: URI, fields: ICodexSessionOverlayUpdate): Promise<void> {
		try {
			const ref = this._sessionDataService.openDatabase(session);
			const db = ref.object;
			try {
				const work: Promise<void>[] = [];
				if (fields.threadId !== undefined) {
					work.push(db.setMetadata(CodexSessionMetadataStore.KEY_THREAD_ID, fields.threadId));
				}
				if (fields.cwd !== undefined) {
					work.push(db.setMetadata(
						CodexSessionMetadataStore.KEY_CWD,
						serializeCwd(fields.cwd, fields.workingDirectories),
					));
				}
				if (fields.modelId !== undefined) {
					work.push(db.setMetadata(CodexSessionMetadataStore.KEY_MODEL, fields.modelId));
				}
				if (fields.agent !== undefined) {
					work.push(db.setMetadata(
						CodexSessionMetadataStore.KEY_AGENT,
						fields.agent === null ? '' : JSON.stringify({ uri: fields.agent.uri }),
					));
				}
				if (fields.ownsManagedWorkingDirectory !== undefined) {
					work.push(db.setMetadata(
						CodexSessionMetadataStore.KEY_OWNS_MANAGED_WORKING_DIRECTORY,
						fields.ownsManagedWorkingDirectory ? 'true' : 'false',
					));
				}
				if (fields.managedWorkingDirectory !== undefined) {
					work.push(db.setMetadata(
						CodexSessionMetadataStore.KEY_MANAGED_WORKING_DIRECTORY,
						fields.managedWorkingDirectory === null ? '' : fields.managedWorkingDirectory.toString(),
					));
				}
				await Promise.all(work);
			} finally {
				ref.dispose();
			}
		} catch (err) {
			this._logService.warn(`[Codex] metadata write failed for ${session.toString()}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async read(session: URI): Promise<ICodexSessionOverlay> {
		try {
			const ref = await this._sessionDataService.tryOpenDatabase(session);
			if (!ref) {
				return {};
			}
			try {
				const [threadId, cwdRaw, modelId, agentRaw, ownsManagedWorkingDirectoryRaw, managedWorkingDirectoryRaw] = await Promise.all([
					ref.object.getMetadata(CodexSessionMetadataStore.KEY_THREAD_ID),
					ref.object.getMetadata(CodexSessionMetadataStore.KEY_CWD),
					ref.object.getMetadata(CodexSessionMetadataStore.KEY_MODEL),
					ref.object.getMetadata(CodexSessionMetadataStore.KEY_AGENT),
					ref.object.getMetadata(CodexSessionMetadataStore.KEY_OWNS_MANAGED_WORKING_DIRECTORY),
					ref.object.getMetadata(CodexSessionMetadataStore.KEY_MANAGED_WORKING_DIRECTORY),
				]);
				const cwd = parseCwd(cwdRaw);
				return {
					threadId: threadId ?? undefined,
					cwd: cwd.cwd,
					modelId: modelId ?? undefined,
					agent: parseAgentSelection(agentRaw),
					workingDirectories: cwd.workingDirectories,
					...(ownsManagedWorkingDirectoryRaw === 'true' ? { ownsManagedWorkingDirectory: true } : {}),
					...(managedWorkingDirectoryRaw ? { managedWorkingDirectory: URI.parse(managedWorkingDirectoryRaw) } : {}),
				};
			} finally {
				ref.dispose();
			}

		} catch (err) {
			this._logService.warn(`[Codex] metadata read failed for ${session.toString()}: ${err instanceof Error ? err.message : String(err)}`);
			return {};
		}
	}

}

function parseAgentSelection(raw: string | undefined): AgentSelection | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		const value: { uri?: unknown } = JSON.parse(raw);
		return typeof value.uri === 'string' ? { uri: value.uri } : undefined;
	} catch {
		return undefined;
	}
}

function serializeCwd(cwd: URI, workingDirectories: readonly URI[] | undefined): string {
	if (!workingDirectories || workingDirectories.length <= 1) {
		return cwd.toString();
	}
	return JSON.stringify({
		cwd: cwd.toString(),
		workingDirectories: workingDirectories.map(directory => directory.toString()),
	});
}

function parseCwd(raw: string | undefined): { readonly cwd?: URI; readonly workingDirectories?: readonly URI[] } {
	if (!raw) {
		return {};
	}
	if (!raw.startsWith('{')) {
		return { cwd: URI.parse(raw) };
	}
	try {
		const value: { cwd?: unknown; workingDirectories?: unknown } = JSON.parse(raw);
		if (typeof value.cwd !== 'string') {
			return {};
		}
		const workingDirectories = Array.isArray(value.workingDirectories)
			? value.workingDirectories
				.filter((directory): directory is string => typeof directory === 'string')
				.map(directory => URI.parse(directory))
			: undefined;
		return {
			cwd: URI.parse(value.cwd),
			workingDirectories: workingDirectories && workingDirectories.length > 1 ? workingDirectories : undefined,
		};
	} catch {
		return {};
	}
}
