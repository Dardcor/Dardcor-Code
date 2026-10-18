/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IUserDataProfilesService } from '../../../../platform/userDataProfile/common/userDataProfile.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { AgentsVoiceStorageKeys } from './agentsVoice.js';

export type VoiceTranscriptKind =
	| 'user_voice'
	| 'agent_voice'
	| 'agent_tool_call'
	| 'coding_event';

export interface IVoiceTranscriptEntryMetadata {
	readonly toolName?: string;
	readonly toolArgs?: Record<string, unknown>;
	readonly codingSessionId?: string;
	readonly codingStatus?: string;
	readonly codingSessionLabel?: string;
}

export interface IVoiceTranscriptTurn {
	readonly turnId: string;
	readonly ancestorIds: readonly string[];
	readonly kind: VoiceTranscriptKind;
	readonly role: 'user' | 'assistant';
	readonly text: string;
	readonly timestamp: string;
	readonly metadata?: IVoiceTranscriptEntryMetadata;
}

export interface IVoiceTranscriptIndex {
	readonly entries: { [userId: string]: IVoiceTranscriptIndexEntry };
	readonly version: 1;
}

export interface IVoiceTranscriptIndexEntry {
	readonly userId: string;
	readonly createdAt: string;
	readonly lastUpdatedAt: string;
	readonly turnCount: number;
	readonly archivedBefore?: string;
}

export const IVoiceTranscriptStore = createDecorator<IVoiceTranscriptStore>('voiceTranscriptStore');

export interface IVoiceTranscriptStore {
	readonly _serviceBrand: undefined;

	appendTurn(userId: string, turn: IVoiceTranscriptTurn): Promise<void>;

	loadTurns(userId: string, opts?: { since?: string; limit?: number }): Promise<IVoiceTranscriptTurn[]>;

	getIndexEntry(userId: string): IVoiceTranscriptIndexEntry | undefined;

	archiveUpTo(userId: string, cutoff: string): Promise<void>;

	unarchive(userId: string): Promise<void>;

	deleteAll(userId: string): Promise<void>;
}

export class VoiceTranscriptStore extends Disposable implements IVoiceTranscriptStore {

	declare readonly _serviceBrand: undefined;

	private readonly storageRoot: URI;
	private readonly writeQueue = new Sequencer();

	private indexCache: IVoiceTranscriptIndex;

	private pendingWrite: Promise<void> | undefined;
	private shuttingDown = false;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@IUserDataProfilesService userDataProfilesService: IUserDataProfilesService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this.storageRoot = joinPath(
			userDataProfilesService.defaultProfile.globalStorageHome,
			'voiceTranscripts'
		);

		this.indexCache = this.readIndexFromStorage();

		this._register(this.lifecycleService.onWillShutdown(e => {
			this.shuttingDown = true;
			if (!this.pendingWrite) {
				return;
			}
			e.join(this.pendingWrite, {
				id: 'join.voiceTranscriptStore',
				label: localize('join.voiceTranscriptStore', "Saving voice transcript")
			});
		}));
	}


	async appendTurn(userId: string, turn: IVoiceTranscriptTurn): Promise<void> {
		if (this.shuttingDown) {
			this.logService.warn(`VoiceTranscriptStore: ignoring appendTurn for ${userId} (shutting down)`);
			return;
		}

		const work = this.writeQueue.queue(() => this.doAppendTurn(userId, turn));
		this.pendingWrite = work;
		try {
			await work;
		} finally {
			if (this.pendingWrite === work) {
				this.pendingWrite = undefined;
			}
		}
	}

	async loadTurns(userId: string, opts?: { since?: string; limit?: number }): Promise<IVoiceTranscriptTurn[]> {
		const file = this.fileFor(userId);
		let raw: string;
		try {
			const content = await this.fileService.readFile(file);
			raw = content.value.toString();
		} catch (e) {
			if (toFileOperationResult(e) === FileOperationResult.FILE_NOT_FOUND) {
				return [];
			}
			this.logService.error(`VoiceTranscriptStore: failed to read transcript for ${userId}`, e);
			return [];
		}

		const turns: IVoiceTranscriptTurn[] = [];
		let sawLegacyEntry = false;
		for (const line of raw.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			try {
				const parsed = JSON.parse(trimmed) as Partial<IVoiceTranscriptTurn>;
				if (!parsed.kind) {
					sawLegacyEntry = true;
					break;
				}
				if (opts?.since && parsed.timestamp && parsed.timestamp < opts.since) {
					continue;
				}
				turns.push(parsed as IVoiceTranscriptTurn);
			} catch (e) {
				this.logService.warn(`VoiceTranscriptStore: skipping malformed line in ${userId}.jsonl: ${(e as Error).message}`);
			}
		}

		if (sawLegacyEntry) {
			this.logService.info(`VoiceTranscriptStore: detected pre-timeline transcript for ${userId}, wiping for new schema`);
			await this.deleteAll(userId);
			return [];
		}

		if (opts?.limit !== undefined && turns.length > opts.limit) {
			return turns.slice(turns.length - opts.limit);
		}
		return turns;
	}

	getIndexEntry(userId: string): IVoiceTranscriptIndexEntry | undefined {
		return this.indexCache.entries[userId];
	}

	async archiveUpTo(userId: string, cutoff: string): Promise<void> {
		const existing = this.indexCache.entries[userId];
		if (!existing) {
			return;
		}
		this.updateIndexEntry(userId, { ...existing, archivedBefore: cutoff });
	}

	async unarchive(userId: string): Promise<void> {
		const existing = this.indexCache.entries[userId];
		if (!existing) {
			return;
		}
		const { archivedBefore: _unused, ...rest } = existing;
		this.updateIndexEntry(userId, rest);
	}

	async deleteAll(userId: string): Promise<void> {
		const file = this.fileFor(userId);
		try {
			await this.fileService.del(file);
		} catch (e) {
			if (toFileOperationResult(e) !== FileOperationResult.FILE_NOT_FOUND) {
				this.logService.error(`VoiceTranscriptStore: failed to delete transcript for ${userId}`, e);
			}
		}
		const next = { ...this.indexCache.entries };
		delete next[userId];
		this.indexCache = { ...this.indexCache, entries: next };
		this.flushIndex();
	}


	private fileFor(userId: string): URI {
		const safe = userId.replace(/[^A-Za-z0-9-]/g, '_');
		if (!safe) {
			throw new Error('Invalid userId for transcript storage');
		}
		return joinPath(this.storageRoot, `${safe}.jsonl`);
	}

	private async doAppendTurn(userId: string, turn: IVoiceTranscriptTurn): Promise<void> {
		const file = this.fileFor(userId);
		const line = JSON.stringify(turn) + '\n';

		try {
			try {
				await this.fileService.createFolder(this.storageRoot);
			} catch {
			}
			await this.fileService.writeFile(file, VSBuffer.fromString(line), { append: true });
		} catch (e) {
			this.logService.error(`VoiceTranscriptStore: failed to append turn for ${userId}`, e);
			return;
		}

		const existing = this.indexCache.entries[userId];
		const next: IVoiceTranscriptIndexEntry = existing
			? {
				...existing,
				lastUpdatedAt: turn.timestamp,
				turnCount: existing.turnCount + 1,
			}
			: {
				userId,
				createdAt: turn.timestamp,
				lastUpdatedAt: turn.timestamp,
				turnCount: 1,
			};

		this.updateIndexEntry(userId, next);
	}

	private updateIndexEntry(userId: string, entry: IVoiceTranscriptIndexEntry): void {
		this.indexCache = {
			...this.indexCache,
			entries: { ...this.indexCache.entries, [userId]: entry },
		};
		this.flushIndex();
	}

	private flushIndex(): void {
		try {
			this.storageService.store(
				AgentsVoiceStorageKeys.TranscriptIndex,
				JSON.stringify(this.indexCache),
				StorageScope.PROFILE,
				StorageTarget.MACHINE,
			);
		} catch (e) {
			this.logService.error(`VoiceTranscriptStore: failed to flush transcript index`, e);
		}
	}

	private readIndexFromStorage(): IVoiceTranscriptIndex {
		const raw = this.storageService.get(
			AgentsVoiceStorageKeys.TranscriptIndex,
			StorageScope.PROFILE,
		);
		if (!raw) {
			return { entries: {}, version: 1 };
		}
		try {
			const parsed = JSON.parse(raw) as IVoiceTranscriptIndex;
			if (parsed && typeof parsed === 'object' && parsed.entries && parsed.version === 1) {
				return parsed;
			}
			this.logService.warn('VoiceTranscriptStore: ignoring index with unknown shape, starting fresh');
		} catch (e) {
			this.logService.warn('VoiceTranscriptStore: failed to parse stored index, starting fresh', e);
		}
		return { entries: {}, version: 1 };
	}
}

registerSingleton(IVoiceTranscriptStore, VoiceTranscriptStore, InstantiationType.Delayed);
