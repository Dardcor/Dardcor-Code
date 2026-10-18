/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { toErrorMessage } from '../../../../../base/common/errorMessage.js';
import { IAgentHostService, type IAgentConnection } from '../../../../../platform/agentHost/common/agentService.js';
import { agentHostAuthority } from '../../../../../platform/agentHost/common/agentHostUri.js';
import { IRemoteAgentHostService } from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { ActionType, NotificationType, type ActionEnvelope, type ChatUsageAction, type INotification, type SessionCustomizationsChangedAction } from '../../../../../platform/agentHost/common/state/sessionActions.js';
import { isDefaultChatUri, parseChatUri, readUsageInfoMeta, type Customization } from '../../../../../platform/agentHost/common/state/sessionState.js';
import { getCopilotCliSessionRawId } from '../copilotCliEventsUri.js';

const USAGE_DIR = 'agentHostUsage';

export interface IAgentHostUsageRecord {
	readonly turnId: string;
	readonly model?: string;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cacheReadTokens?: number;
	readonly totalNanoAiu?: number;
	readonly ts: string;
}

export function buildAgentHostUsageUri(baseDir: URI, rawSessionId: string): URI {
	return joinPath(baseDir, USAGE_DIR, `${sanitizeSessionId(rawSessionId)}.jsonl`);
}

function sanitizeSessionId(rawSessionId: string): string {
	return rawSessionId.replace(/[^\w.-]/g, '_');
}

export async function readAgentHostUsageRecords(fileService: IFileService, uri: URI): Promise<IAgentHostUsageRecord[]> {
	let text: string;
	try {
		const content = await fileService.readFile(uri);
		text = content.value.toString();
	} catch {
		return [];
	}
	const records: IAgentHostUsageRecord[] = [];
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed && typeof parsed.turnId === 'string' && typeof parsed.ts === 'string') {
				records.push(parsed as IAgentHostUsageRecord);
			}
		} catch {
		}
	}
	return records;
}

type IAgentHostActionSource = Pick<IAgentHostService, 'onDidAction' | 'onDidNotification'>;


































abstract class AgentHostActionRecorder extends Disposable {

	private readonly _remoteListeners = this._register(new DisposableMap<string>());

	private readonly _queues = new Map<string, Promise<void>>();

	private readonly _remoteConnections = new Map<string, IAgentConnection>();

	constructor(
		protected readonly _baseDir: URI,
		protected readonly _isEnabled: () => boolean,
		protected readonly _fileService: IFileService,
		protected readonly _logService: ILogService,
		agentHostService: IAgentHostActionSource,
		private readonly _remoteAgentHostService: IRemoteAgentHostService,
	) {
		super();

		this._register(agentHostService.onDidAction(envelope => this._dispatch(envelope)));
		this._register(agentHostService.onDidNotification(notification => this._onNotification(notification)));

		this._register(this._remoteAgentHostService.onDidChangeConnections(() => this._syncRemoteListeners()));
		this._syncRemoteListeners();
	}

	private _dispatch(envelope: ActionEnvelope): void {
		if (!this._isEnabled()) {
			return;
		}
		this._onAction(envelope);
	}

	private _onNotification(notification: INotification): void {
		if (notification.type !== NotificationType.SessionRemoved) {
			return;
		}
		const rawId = getCopilotCliSessionRawId(URI.parse(notification.session));
		if (!rawId) {
			return;
		}
		const uri = this._sidecarUri(rawId);
		const pending = this.queued(rawId, () => this._fileService.del(uri));
		void pending.finally(() => {
			if (this._queues.get(rawId) === pending) {
				this._queues.delete(rawId);
			}
		});
	}

	protected queued(rawSessionId: string, operation: () => Promise<unknown>): Promise<void> {
		const previous = this._queues.get(rawSessionId) ?? Promise.resolve();
		const next = previous
			.then(operation)
			.then(() => undefined)
			.catch(err => {
				this._logService.trace(`[${this.constructor.name}] sidecar operation failed for ${rawSessionId}: ${toErrorMessage(err)}`);
			});
		this._queues.set(rawSessionId, next);
		return next;
	}

	protected abstract _onAction(envelope: ActionEnvelope): void;

	protected abstract _sidecarUri(rawSessionId: string): URI;

	private _syncRemoteListeners(): void {
		const seen = new Set<string>();
		for (const info of this._remoteAgentHostService.connections) {
			const authority = agentHostAuthority(info.address);
			seen.add(authority);
			const connection = this._remoteAgentHostService.getConnectionByAuthority(authority);
			if (!connection) {
				continue;
			}
			if (this._remoteConnections.get(authority) === connection) {
				continue;
			}
			this._remoteConnections.set(authority, connection);
			const store = new DisposableStore();
			store.add(connection.onDidAction(envelope => this._dispatch(envelope)));
			store.add(connection.onDidNotification(notification => this._onNotification(notification)));
			this._remoteListeners.set(authority, store);
		}
		for (const authority of [...this._remoteListeners.keys()]) {
			if (!seen.has(authority)) {
				this._remoteListeners.deleteAndDispose(authority);
				this._remoteConnections.delete(authority);
			}
		}
	}
}

export class AgentHostUsageRecorder extends AgentHostActionRecorder {

	protected _sidecarUri(rawSessionId: string): URI {
		return buildAgentHostUsageUri(this._baseDir, rawSessionId);
	}

	protected _onAction(envelope: ActionEnvelope): void {
		const action = envelope.action;
		if (action.type !== ActionType.ChatUsage) {
			return;
		}
		if (!isDefaultChatUri(envelope.channel)) {
			return;
		}
		const usage = (action as ChatUsageAction).usage;
		const meta = readUsageInfoMeta(usage);
		if (meta.contextAttribution) {
			return;
		}
		const session = parseChatUri(envelope.channel)?.session;
		if (!session) {
			return;
		}
		const rawId = getCopilotCliSessionRawId(URI.parse(session));
		if (!rawId) {
			return;
		}
		const record: IAgentHostUsageRecord = {
			turnId: (action as ChatUsageAction).turnId,
			model: usage.model,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			cacheReadTokens: usage.cacheReadTokens,
			totalNanoAiu: meta.copilotUsage?.totalNanoAiu,
			ts: new Date().toISOString(),
		};
		this._append(rawId, record);
	}

	private _append(rawId: string, record: IAgentHostUsageRecord): void {
		const uri = this._sidecarUri(rawId);
		const line = JSON.stringify(record) + '\n';
		void this.queued(rawId, () => this._fileService.writeFile(uri, VSBuffer.fromString(line), { append: true }));
	}
}

const CUSTOMIZATIONS_DIR = 'agentHostCustomizations';

export function buildAgentHostCustomizationsUri(baseDir: URI, rawSessionId: string): URI {
	return joinPath(baseDir, CUSTOMIZATIONS_DIR, `${sanitizeSessionId(rawSessionId)}.json`);
}

export async function readAgentHostCustomizationsSnapshot(fileService: IFileService, uri: URI): Promise<Customization[] | undefined> {
	let text: string;
	try {
		const content = await fileService.readFile(uri);
		text = content.value.toString();
	} catch {
		return undefined;
	}
	try {
		const parsed = JSON.parse(text);
		if (Array.isArray(parsed)) {
			return parsed as Customization[];
		}
	} catch {
	}
	return undefined;
}

export class AgentHostCustomizationRecorder extends AgentHostActionRecorder {

	protected _sidecarUri(rawSessionId: string): URI {
		return buildAgentHostCustomizationsUri(this._baseDir, rawSessionId);
	}

	protected _onAction(envelope: ActionEnvelope): void {
		if (envelope.action.type !== ActionType.SessionCustomizationsChanged) {
			return;
		}
		const rawId = getCopilotCliSessionRawId(URI.parse(envelope.channel));
		if (!rawId) {
			return;
		}
		this._write(rawId, (envelope.action as SessionCustomizationsChangedAction).customizations);
	}

	private _write(rawId: string, customizations: readonly Customization[]): void {
		const uri = this._sidecarUri(rawId);
		const content = JSON.stringify(customizations);
		void this.queued(rawId, () => this._fileService.writeFile(uri, VSBuffer.fromString(content)));
	}
}
