/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { URI } from '../../../../base/common/uri.js';
import { ClaudePermissionMode, narrowClaudePermissionMode } from '../../common/claudeSessionConfigKeys.js';
import { IAgentChatMetadata } from '../../common/agent.js';
import { ISessionDataService } from '../../common/sessionDataService.js';
import type { AgentSelection, ModelSelection } from '../../common/state/protocol/state.js';
import { AH_META_WORKSPACELESS_DB_KEY } from '../../common/state/sessionState.js';

export interface IClaudeSessionOverlay {
	readonly customizationDirectory?: URI;
	readonly model?: ModelSelection;
	readonly permissionMode?: ClaudePermissionMode;
	readonly agent?: AgentSelection;
	readonly workingDirectories?: readonly URI[];
	readonly transport?: 'proxy' | 'native';
}

export interface IClaudeSessionOverlayUpdate {
	readonly customizationDirectory?: URI;
	readonly model?: ModelSelection;
	readonly permissionMode?: ClaudePermissionMode;
	readonly agent?: AgentSelection | null;
	readonly workingDirectories?: readonly URI[];
	readonly transport?: 'proxy' | 'native';
}

export class ClaudeSessionMetadataStore {

	private static readonly KEY_CUSTOMIZATION_DIRECTORY = 'claude.customizationDirectory';
	private static readonly KEY_MODEL = 'claude.model';
	private static readonly KEY_PERMISSION_MODE = 'claude.permissionMode';
	private static readonly KEY_AGENT = 'claude.agent';
	private static readonly KEY_TRANSPORT = 'claude.transport';
	private static readonly KEY_WORKING_DIRECTORIES = 'claude.workingDirectories';

	constructor(
		@ISessionDataService private readonly _sessionDataService: ISessionDataService,
	) { }

	async hasKnownSession(session: URI): Promise<boolean> {
		const ref = await this._sessionDataService.tryOpenDatabase(session);
		if (!ref) {
			return false;
		}
		try {
			const metadata = await ref.object.getMetadataObject({
				[AH_META_WORKSPACELESS_DB_KEY]: true,
				'claude.external': true,
				[ClaudeSessionMetadataStore.KEY_CUSTOMIZATION_DIRECTORY]: true,
				[ClaudeSessionMetadataStore.KEY_MODEL]: true,
				[ClaudeSessionMetadataStore.KEY_PERMISSION_MODE]: true,
				[ClaudeSessionMetadataStore.KEY_AGENT]: true,
				[ClaudeSessionMetadataStore.KEY_TRANSPORT]: true,
				[ClaudeSessionMetadataStore.KEY_WORKING_DIRECTORIES]: true,
			});
			return Object.values(metadata).some(value => value !== undefined);
		} finally {
			ref.dispose();
		}
	}

	async write(session: URI, fields: IClaudeSessionOverlayUpdate): Promise<void> {
		const dbRef = this._sessionDataService.openDatabase(session);
		const db = dbRef.object;
		try {
			const work: Promise<void>[] = [];
			if (fields.customizationDirectory) {
				work.push(db.setMetadata(ClaudeSessionMetadataStore.KEY_CUSTOMIZATION_DIRECTORY, fields.customizationDirectory.toString()));
			}
			if (fields.model) {
				work.push(db.setMetadata(ClaudeSessionMetadataStore.KEY_MODEL, serializeModelSelection(fields.model)));
			}
			if (fields.permissionMode) {
				work.push(db.setMetadata(ClaudeSessionMetadataStore.KEY_PERMISSION_MODE, fields.permissionMode));
			}
			if (fields.agent !== undefined) {
				work.push(db.setMetadata(
					ClaudeSessionMetadataStore.KEY_AGENT,
					fields.agent === null ? '' : JSON.stringify({ uri: fields.agent.uri }),
				));
			}
			if (fields.transport) {
				work.push(db.setMetadata(ClaudeSessionMetadataStore.KEY_TRANSPORT, fields.transport));
			}
			if (fields.workingDirectories) {
				work.push(db.setMetadata(
					ClaudeSessionMetadataStore.KEY_WORKING_DIRECTORIES,
					JSON.stringify(fields.workingDirectories.map(d => d.toString())),
				));
			}
			await Promise.all(work);
		} finally {
			dbRef.dispose();
		}
	}

	async read(session: URI): Promise<IClaudeSessionOverlay> {
		const ref = await this._sessionDataService.tryOpenDatabase(session);
		if (!ref) {
			return {};
		}
		try {
			const [customizationDirectoryRaw, modelRaw, permissionModeRaw, agentRaw, transportRaw, workingDirectoriesRaw] = await Promise.all([
				ref.object.getMetadata(ClaudeSessionMetadataStore.KEY_CUSTOMIZATION_DIRECTORY),
				ref.object.getMetadata(ClaudeSessionMetadataStore.KEY_MODEL),
				ref.object.getMetadata(ClaudeSessionMetadataStore.KEY_PERMISSION_MODE),
				ref.object.getMetadata(ClaudeSessionMetadataStore.KEY_AGENT),
				ref.object.getMetadata(ClaudeSessionMetadataStore.KEY_TRANSPORT),
				ref.object.getMetadata(ClaudeSessionMetadataStore.KEY_WORKING_DIRECTORIES),
			]);
			return {
				customizationDirectory: customizationDirectoryRaw ? URI.parse(customizationDirectoryRaw) : undefined,
				model: parseModelSelection(modelRaw),
				permissionMode: narrowClaudePermissionMode(permissionModeRaw),
				agent: parseAgentSelection(agentRaw),
				transport: transportRaw === 'proxy' || transportRaw === 'native' ? transportRaw : undefined,
				workingDirectories: parseWorkingDirectories(workingDirectoriesRaw),
			};
		} finally {
			ref.dispose();
		}

	}

	project(entry: SDKSessionInfo): Omit<IAgentChatMetadata, 'chat'> {
		return {
			startTime: entry.createdAt ?? entry.lastModified,
			modifiedTime: entry.lastModified,
			summary: entry.customTitle ?? entry.summary,
			workingDirectories: entry.cwd ? [URI.file(entry.cwd)] : undefined,
		};
	}
}

function parseAgentSelection(raw: string | undefined): AgentSelection | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		const value: { uri?: unknown } = JSON.parse(raw);
		if (value && typeof value === 'object' && typeof value.uri === 'string') {
			return { uri: value.uri };
		}
	} catch {
	}
	return undefined;
}

function parseWorkingDirectories(raw: string | undefined): readonly URI[] | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		const value: unknown = JSON.parse(raw);
		if (Array.isArray(value)) {
			const dirs = value.filter((d): d is string => typeof d === 'string').map(d => URI.parse(d));
			return dirs.length > 0 ? dirs : undefined;
		}
	} catch {
	}
	return undefined;
}

function serializeModelSelection(model: ModelSelection): string {
	return JSON.stringify(model);
}

function parseModelSelection(raw: string | undefined): ModelSelection | undefined {
	if (!raw) {
		return undefined;
	}
	try {
		const value: { id?: unknown; config?: unknown } | string | number | boolean | null = JSON.parse(raw);
		if (value && typeof value === 'object' && typeof value.id === 'string') {
			const result: ModelSelection = { id: value.id };
			if (value.config && typeof value.config === 'object') {
				const config: Record<string, string> = {};
				for (const [key, configValue] of Object.entries(value.config)) {
					if (typeof configValue === 'string') {
						config[key] = configValue;
					}
				}
				if (Object.keys(config).length > 0) {
					result.config = config;
				}
			}
			return result;
		}
	} catch {
	}
	return { id: raw };
}
