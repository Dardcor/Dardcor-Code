/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { createDirectoryIfNotExists, IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { findLast } from '../../../util/dardcor/base/common/arraysFind';
import { disposableTimeout, SequencerByKey, ThrottledDelayer } from '../../../util/dardcor/base/common/async';
import { Disposable, DisposableMap } from '../../../util/dardcor/base/common/lifecycle';
import { dirname } from '../../../util/dardcor/base/common/resources';
import { ChatSessionMetadataFile, IChatSessionMetadataStore, RepositoryProperties, RequestDetails, WorkspaceFolderEntry } from '../common/chatSessionMetadataStore';
import { ChatSessionWorktreeProperties } from '../common/chatSessionWorktreeService';
import { isUntitledSessionId } from '../common/utils';
import { IWorkspaceInfo } from '../common/workspaceInfo';
import { getDardcorBulkMetadataFile, getDardcorSessionDir } from '../common/node/sessionStatePaths';

const LEGACY_BULK_METADATA_FILENAME = 'dardcorcli.session.metadata.json';
const LEGACY_BULK_MIGRATED_KEY = 'github.dardcor.cli.legacyBulkMigrated';
const REQUEST_MAPPING_FILENAME = 'vscode.requests.metadata.json';

const MAX_BULK_STORAGE_ENTRIES = 1000;

const BULK_SEQUENCER_KEY = 'bulk';

export class ChatSessionMetadataStore extends Disposable implements IChatSessionMetadataStore {
	declare _serviceBrand: undefined;

	private _cache: Record<string, ChatSessionMetadataFile> = {};

	private readonly _sessionFolderEntry = new Map<string, { path: string; kind: 'worktree' | 'folder' }>();
	private readonly _folderToSessions = new Map<string, Set<string>>();

	private readonly _cacheFile = Uri.file(getDardcorBulkMetadataFile());

	private _ready: Promise<void>;

	private readonly _updateStorageDebouncer = this._register(new ThrottledDelayer<void>(1_000));
	private readonly _requestMappingWriteSequencer = new SequencerByKey<string>();
	private readonly _requestMappingReadSequencer = new SequencerByKey<string>();
	private readonly _metadataWriteSequencer = new SequencerByKey<string>();
	private readonly _metadataReadSequencer = new SequencerByKey<string>();
	private readonly _requestDetailsCache = new Map<string, RequestDetails[]>();
	private readonly _requestDetailsCacheTimers = this._register(new DisposableMap<string>());

	private readonly _bulkSequencer = new SequencerByKey<string>();

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@ILogService private readonly logService: ILogService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
	) {
		super();

		this._ready = this.initializeStorage();
		this._ready.catch(error => {
			this.logService.error('[ChatSessionMetadataStore] Initialization failed: ', error);
		});
	}

	public refresh(): Promise<void> {
		this._ready = this._ready.catch(() => undefined).then(() => this.reloadBulkFromDisk());
		return this._ready;
	}

	public getSessionIdsForFolder(folder: vscode.Uri): string[] {
		return Array.from(this._folderToSessions.get(folder.fsPath) ?? []);
	}

	public getWorktreeSessions(folder: vscode.Uri): string[] {
		const sessions = this._folderToSessions.get(folder.fsPath);
		if (!sessions) {
			return [];
		}
		const result: string[] = [];
		for (const sessionId of sessions) {
			if (this._sessionFolderEntry.get(sessionId)?.kind === 'worktree') {
				result.push(sessionId);
			}
		}
		return result;
	}

	private _updateFolderIndex(sessionId: string, metadata: ChatSessionMetadataFile | undefined): void {
		const old = this._sessionFolderEntry.get(sessionId);
		if (old) {
			const set = this._folderToSessions.get(old.path);
			if (set) {
				set.delete(sessionId);
				if (set.size === 0) {
					this._folderToSessions.delete(old.path);
				}
			}
			this._sessionFolderEntry.delete(sessionId);
		}

		if (!metadata) {
			return;
		}

		const worktreePath = metadata.worktreeProperties?.worktreePath;
		const folderPath = metadata.workspaceFolder?.folderPath;
		const path = worktreePath ?? folderPath;
		if (!path) {
			return;
		}

		const kind: 'worktree' | 'folder' = worktreePath ? 'worktree' : 'folder';
		this._sessionFolderEntry.set(sessionId, { path, kind });
		let set = this._folderToSessions.get(path);
		if (!set) {
			set = new Set();
			this._folderToSessions.set(path, set);
		}
		set.add(sessionId);
	}

	private async initializeStorage(): Promise<void> {
		await this.migrateLegacyBulkFile();

		this._cache = await this.getGlobalStorageData().catch(() => ({} as Record<string, ChatSessionMetadataFile>));
		for (const [sessionId, metadata] of Object.entries(this._cache)) {
			if (sessionId.startsWith('untitled-')) {
				delete this._cache[sessionId];
				continue;
			}
			if (!(metadata.workspaceFolder || metadata.worktreeProperties || metadata.additionalWorkspaces?.length)) {
				delete this._cache[sessionId];
			}
		}

		for (const [sessionId, metadata] of Object.entries(this._cache)) {
			this._updateFolderIndex(sessionId, metadata);
		}

	}

	public getMetadataFileUri(sessionId: string): vscode.Uri {
		return Uri.joinPath(Uri.file(getDardcorSessionDir(sessionId)), 'vscode.metadata.json');
	}

	private getRequestMappingFileUri(sessionId: string): vscode.Uri {
		return Uri.joinPath(Uri.file(getDardcorSessionDir(sessionId)), REQUEST_MAPPING_FILENAME);
	}

	async deleteSessionMetadata(sessionId: string): Promise<void> {
		await this._ready;
		this._requestDetailsCache.delete(sessionId);
		this._requestDetailsCacheTimers.deleteAndDispose(sessionId);
		if (sessionId in this._cache) {
			delete this._cache[sessionId];
			this._updateFolderIndex(sessionId, undefined);
			const data = await this.getGlobalStorageData().catch(() => ({} as Record<string, ChatSessionMetadataFile>));
			delete data[sessionId];
			await this.writeToGlobalStorage(data);
		}
		try {
			await Promise.allSettled([
				this.fileSystemService.delete(this.getMetadataFileUri(sessionId)),
				this.fileSystemService.delete(this.getRequestMappingFileUri(sessionId))
			]);
		} catch {
		}
	}

	private async updateMetadataFields(sessionId: string, fields: Partial<ChatSessionMetadataFile>): Promise<void> {
		if (isUntitledSessionId(sessionId)) {
			return;
		}
		await this._ready;
		const existing = this._cache[sessionId] ?? {};
		this._cache[sessionId] = { ...existing, ...fields };
		this._updateFolderIndex(sessionId, this._cache[sessionId]);
		await this.updateSessionMetadata(sessionId, fields);
		this.updateGlobalStorage();
	}

	async storeWorktreeInfo(sessionId: string, properties: ChatSessionWorktreeProperties): Promise<void> {
		await this.updateMetadataFields(sessionId, { worktreeProperties: properties });
	}

	async storeWorkspaceFolderInfo(sessionId: string, entry: WorkspaceFolderEntry): Promise<void> {
		await this.updateMetadataFields(sessionId, { workspaceFolder: entry });
	}

	async storeRepositoryProperties(sessionId: string, properties: RepositoryProperties): Promise<void> {
		await this.updateMetadataFields(sessionId, { repositoryProperties: properties });
	}

	async getRepositoryProperties(sessionId: string): Promise<RepositoryProperties | undefined> {
		const metadata = await this.getSessionMetadata(sessionId);
		return metadata?.repositoryProperties;
	}

	async getWorktreeProperties(sessionId: string): Promise<ChatSessionWorktreeProperties | undefined> {
		await this._ready;
		const metadata = await this.getSessionMetadata(sessionId);
		return metadata?.worktreeProperties;
	}

	async getSessionWorkspaceFolder(sessionId: string): Promise<vscode.Uri | undefined> {
		const metadata = await this.getSessionMetadata(sessionId);
		if (!metadata) {
			return undefined;
		}
		if (metadata.worktreeProperties) {
			return undefined;
		}
		return metadata.workspaceFolder?.folderPath ? Uri.file(metadata.workspaceFolder.folderPath) : undefined;
	}

	async getSessionWorkspaceFolderEntry(sessionId: string): Promise<WorkspaceFolderEntry | undefined> {
		const metadata = await this.getSessionMetadata(sessionId);
		if (!metadata) {
			return undefined;
		}
		return metadata.workspaceFolder;
	}

	async getAdditionalWorkspaces(sessionId: string): Promise<IWorkspaceInfo[]> {
		const metadata = await this.getSessionMetadata(sessionId);
		if (!metadata?.additionalWorkspaces?.length) {
			return [];
		}
		return metadata.additionalWorkspaces.map(ws => ({
			folder: !ws.worktreeProperties && ws.workspaceFolder?.folderPath ? Uri.file(ws.workspaceFolder.folderPath) : undefined,
			repository: ws.worktreeProperties?.repositoryPath ? Uri.file(ws.worktreeProperties.repositoryPath) : undefined,
			repositoryProperties: undefined,
			worktree: ws.worktreeProperties?.worktreePath ? Uri.file(ws.worktreeProperties.worktreePath) : undefined,
			worktreeProperties: ws.worktreeProperties,
		}));
	}

	async setAdditionalWorkspaces(sessionId: string, workspaces: IWorkspaceInfo[]): Promise<void> {
		const additionalWorkspaces = workspaces.map(ws => ({
			worktreeProperties: ws.worktreeProperties,
			workspaceFolder: !ws.worktreeProperties && ws.folder ? { folderPath: ws.folder.fsPath, timestamp: Date.now() } : undefined,
		}));
		await this.updateMetadataFields(sessionId, { additionalWorkspaces });
	}

	async getSessionFirstUserMessage(sessionId: string): Promise<string | undefined> {
		const metadata = await this.getSessionMetadata(sessionId);
		return metadata?.firstUserMessage;
	}

	async getCustomTitle(sessionId: string): Promise<string | undefined> {
		const metadata = await this.getSessionMetadata(sessionId);
		return metadata?.customTitle;
	}

	async setCustomTitle(sessionId: string, title: string): Promise<void> {
		await this.updateMetadataFields(sessionId, { customTitle: title });
	}

	async setSessionFirstUserMessage(sessionId: string, message: string): Promise<void> {
		await this.updateMetadataFields(sessionId, { firstUserMessage: message });
	}

	async getRequestDetails(sessionId: string): Promise<RequestDetails[]> {
		const details = this._requestDetailsCache.get(sessionId);
		if (details) {
			this.cacheRequestDetails(sessionId, details);
			return details;
		}
		return this._requestMappingReadSequencer.queue(sessionId, async () => {
			await this._ready;
			const fileUri = this.getRequestMappingFileUri(sessionId);
			try {
				const content = await this.fileSystemService.readFile(fileUri);
				const details = JSON.parse(new TextDecoder().decode(content)) as RequestDetails[];
				this.cacheRequestDetails(sessionId, details);
				return details;
			} catch {
				return [];
			}
		});
	}

	private cacheRequestDetails(sessionId: string, details: RequestDetails[]): void {
		this._requestDetailsCache.set(sessionId, details);
		this._requestDetailsCacheTimers.set(sessionId, disposableTimeout(() => {
			this._requestDetailsCache.delete(sessionId);
			this._requestDetailsCacheTimers.deleteAndLeak(sessionId);
		}, 5_000));
	}

	async updateRequestDetails(sessionId: string, details: (Partial<RequestDetails> & { vscodeRequestId: string })[]): Promise<void> {
		await this._ready;
		if (isUntitledSessionId(sessionId)) {
			return;
		}

		await this._requestMappingWriteSequencer.queue(sessionId, async () => {
			const existing = await this.getRequestDetails(sessionId);

			for (const item of details) {
				const existingDetails = existing.find(e => e.vscodeRequestId === item.vscodeRequestId);
				if (existingDetails) {
					const defined = Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
					Object.assign(existingDetails, defined);
				} else {
					const newEntry = { ...item, toolIdEditMap: item.toolIdEditMap ?? {} };
					existing.push(newEntry);
				}
			}
			await this.writeRequestDetails(sessionId, existing);
		});
	}

	async getSessionAgent(sessionId: string): Promise<string | undefined> {
		const details = await this.getRequestDetails(sessionId);
		return findLast(details, d => !!d.modeInstructions)?.modeInstructions?.uri ?? findLast(details, d => !!d.agentId)?.agentId;
	}

	private async writeRequestDetails(sessionId: string, details: RequestDetails[]): Promise<void> {
		await this._ready;
		if (isUntitledSessionId(sessionId)) {
			return;
		}
		this.cacheRequestDetails(sessionId, details);
		const fileUri = this.getRequestMappingFileUri(sessionId);
		const dirUri = dirname(fileUri);
		await createDirectoryIfNotExists(this.fileSystemService, dirUri);
		const content = new TextEncoder().encode(JSON.stringify(details, null, 2));
		await this.fileSystemService.writeFile(fileUri, content);
	}

	async storeForkedSessionMetadata(sourceSessionId: string, targetSessionId: string, customTitle: string): Promise<void> {
		await this._ready;
		const sourceMetadata = await this.getSessionMetadata(sourceSessionId);
		const forkedMetadata: ChatSessionMetadataFile = {
			...sourceMetadata,
			customTitle,
			writtenToDisc: true,
			parentSessionId: sourceSessionId,
			origin: 'vscode',
			kind: 'forked',
			archived: false,
		};
		await this.updateMetadataFields(targetSessionId, forkedMetadata);
	}

	public async setSessionOrigin(sessionId: string): Promise<void> {
		await this._ready;
		await this.updateMetadataFields(sessionId, { origin: 'vscode' });
	}

	public async getSessionOrigin(sessionId: string): Promise<'vscode' | 'other'> {
		const metadata = await this.getSessionMetadata(sessionId, false);
		if (!metadata || Object.keys(metadata).length === 0) {
			return 'other';
		}
		if (metadata.origin) {
			return metadata.origin;
		}
		if (metadata?.repositoryProperties || metadata?.worktreeProperties || metadata?.workspaceFolder) {
			return 'vscode';
		}
		return 'other';
	}

	public async setSessionParentId(sessionId: string, parentSessionId: string): Promise<void> {
		await this._ready;
		await this.updateMetadataFields(sessionId, { parentSessionId, kind: 'sub-session' });
	}

	public async getSessionParentId(sessionId: string): Promise<{ parentSessionId: string; kind: 'forked' | 'sub-session' } | undefined> {
		const metadata = await this.getSessionMetadata(sessionId, false);
		if (!metadata?.parentSessionId || !metadata.kind) {
			return undefined;
		}
		return { parentSessionId: metadata.parentSessionId, kind: metadata.kind };
	}

	public async setSessionArchived(sessionId: string, archived: boolean): Promise<void> {
		await this._ready;
		await this.updateMetadataFields(sessionId, { archived });
	}

	public async getSessionArchived(sessionId: string): Promise<boolean> {
		const metadata = await this.getSessionMetadata(sessionId, false);
		return metadata?.archived === true;
	}

	private async getSessionMetadata(sessionId: string, createMetadataFileIfNotFound = true): Promise<ChatSessionMetadataFile | undefined> {
		if (isUntitledSessionId(sessionId)) {
			return undefined;
		}
		if (sessionId in this._cache) {
			return this._cache[sessionId];
		}
		await this._ready;
		if (sessionId in this._cache) {
			return this._cache[sessionId];
		}

		const metadata = await this.readSessionMetadataFile(sessionId);
		if (metadata) {
			return metadata;
		}

		this._cache[sessionId] = {};
		if (createMetadataFileIfNotFound) {
			await this.updateSessionMetadata(sessionId, { origin: 'other' });
			this.updateGlobalStorage();
		}
		return undefined;
	}

	private async readSessionMetadataFile(sessionId: string): Promise<ChatSessionMetadataFile | undefined> {
		return this._metadataReadSequencer.queue(sessionId, async () => {
			try {
				const fileUri = this.getMetadataFileUri(sessionId);
				const content = await this.fileSystemService.readFile(fileUri);
				const metadata = JSON.parse(new TextDecoder().decode(content)) as ChatSessionMetadataFile;
				if (metadata) {
					this._cache[sessionId] = metadata;
					this._updateFolderIndex(sessionId, metadata);
					return metadata;
				}

				this._cache[sessionId] = {};
				return undefined;
			} catch {
				this._cache[sessionId] = {};
				return undefined;
			}
		});
	}

	private async updateSessionMetadata(sessionId: string, updates: Partial<ChatSessionMetadataFile>, createDirectoryIfNotFound = true): Promise<void> {
		if (isUntitledSessionId(sessionId)) {
			return;
		}

		await this._metadataWriteSequencer.queue(sessionId, async () => {
			const fileUri = this.getMetadataFileUri(sessionId);
			const dirUri = dirname(fileUri);

			let existing: ChatSessionMetadataFile = {};
			let diskFileExisted = true;
			try {
				const rawContent = await this.fileSystemService.readFile(fileUri);
				existing = JSON.parse(new TextDecoder().decode(rawContent));
			} catch {
				diskFileExisted = false;
				try {
					await this.fileSystemService.stat(dirUri);
				} catch {
					if (!createDirectoryIfNotFound) {
						this._cache[sessionId] = { ...updates, writtenToDisc: true };
						this._updateFolderIndex(sessionId, this._cache[sessionId]);
						this.updateGlobalStorage();
						return;
					}
					await this.fileSystemService.createDirectory(dirUri);
				}
			}

			const cacheExisting = diskFileExisted ? {} : (this._cache[sessionId] ?? {});
			const merged: ChatSessionMetadataFile = { ...cacheExisting, ...existing };
			for (const [key, value] of Object.entries(updates)) {
				if (value === undefined) {
					delete (merged as Record<string, unknown>)[key];
				} else {
					(merged as Record<string, unknown>)[key] = value;
				}
			}

			const now = Date.now();
			merged.modified = now;
			if (merged.created === undefined) {
				merged.created = now;
			}

			const content = new TextEncoder().encode(JSON.stringify(merged, null, 2));
			await this.fileSystemService.writeFile(fileUri, content);

			this._cache[sessionId] = { ...merged, writtenToDisc: true };
			this._updateFolderIndex(sessionId, this._cache[sessionId]);
			this.updateGlobalStorage();
		});
	}

	private async getGlobalStorageData() {
		const data = await this.fileSystemService.readFile(this._cacheFile);
		return JSON.parse(new TextDecoder().decode(data)) as Record<string, ChatSessionMetadataFile>;
	}

	private updateGlobalStorage() {
		this._updateStorageDebouncer.trigger(() => this.updateGlobalStorageImpl()).catch(() => { });
	}

	private async updateGlobalStorageImpl() {
		try {
			await this._bulkSequencer.queue(BULK_SEQUENCER_KEY, async () => {
				const data: Record<string, ChatSessionMetadataFile> = { ...this._cache };
				try {
					const storageData = await this.getGlobalStorageData();
					for (const [sessionId, diskEntry] of Object.entries(storageData)) {
						const local = data[sessionId];
						if (!local) {
							data[sessionId] = diskEntry;
							this._cache[sessionId] = diskEntry;
							this._updateFolderIndex(sessionId, diskEntry);
							continue;
						}
						const localModified = local.modified ?? 0;
						const diskModified = diskEntry.modified ?? 0;
						if (diskModified > localModified) {
							data[sessionId] = diskEntry;
							this._cache[sessionId] = diskEntry;
							this._updateFolderIndex(sessionId, diskEntry);
						}
					}
				} catch {
				}
				await this.writeToGlobalStorage(data);
			});
		} catch (error) {
			this.logService.error('[ChatSessionMetadataStore] Failed to update global storage: ', error);
		}
	}

	private async writeToGlobalStorage(allMetadata: Record<string, ChatSessionMetadataFile>): Promise<void> {
		const entries = Object.entries(allMetadata);
		let toWrite: Record<string, ChatSessionMetadataFile>;
		if (entries.length <= MAX_BULK_STORAGE_ENTRIES) {
			toWrite = { ...allMetadata };
		} else {
			entries.sort(([, a], [, b]) => (b.modified ?? 0) - (a.modified ?? 0));
			toWrite = Object.fromEntries(entries.slice(0, MAX_BULK_STORAGE_ENTRIES));
		}

		const dirUri = dirname(this._cacheFile);
		try {
			await this.fileSystemService.stat(dirUri);
		} catch {
			await this.fileSystemService.createDirectory(dirUri);
		}

		const content = new TextEncoder().encode(JSON.stringify(toWrite, null, 2));
		await this.fileSystemService.writeFile(this._cacheFile, content);
	}

	private async reloadBulkFromDisk(): Promise<void> {
		return this._bulkSequencer.queue(BULK_SEQUENCER_KEY, async () => {
			let onDisk: Record<string, ChatSessionMetadataFile>;
			try {
				onDisk = await this.getGlobalStorageData();
			} catch {
				return;
			}
			for (const [id, diskEntry] of Object.entries(onDisk)) {
				const local = this._cache[id];
				if (!local) {
					this._cache[id] = diskEntry;
					this._updateFolderIndex(id, diskEntry);
					continue;
				}
				const localModified = local.modified ?? 0;
				const diskModified = diskEntry.modified ?? 0;
				if (diskModified > localModified) {
					this._cache[id] = diskEntry;
					this._updateFolderIndex(id, diskEntry);
				}
			}
		});
	}

	private async migrateLegacyBulkFile(): Promise<void> {
		if (this.extensionContext.globalState.get<boolean>(LEGACY_BULK_MIGRATED_KEY)) {
			return;
		}

		const legacyCacheFile = Uri.joinPath(this.extensionContext.globalStorageUri, 'dardcorcli', LEGACY_BULK_METADATA_FILENAME);
		let legacyData: Record<string, ChatSessionMetadataFile>;
		try {
			const raw = await this.fileSystemService.readFile(legacyCacheFile);
			legacyData = JSON.parse(new TextDecoder().decode(raw));
		} catch {
			await this.extensionContext.globalState.update(LEGACY_BULK_MIGRATED_KEY, true);
			return;
		}

		try {
			await createDirectoryIfNotExists(this.fileSystemService, dirname(this._cacheFile));

			let sharedData: Record<string, ChatSessionMetadataFile> = {};
			try {
				const raw = await this.fileSystemService.readFile(this._cacheFile);
				sharedData = JSON.parse(new TextDecoder().decode(raw));
			} catch {
			}

			let merged = false;
			for (const [id, legacyEntry] of Object.entries(legacyData)) {
				const sharedEntry = sharedData[id];
				if (!sharedEntry) {
					sharedData[id] = legacyEntry;
					merged = true;
				} else {
					const sharedModified = sharedEntry.modified ?? 0;
					const legacyModified = legacyEntry.modified ?? 0;
					if (legacyModified > sharedModified) {
						sharedData[id] = legacyEntry;
						merged = true;
					}
				}
			}

			if (merged) {
				const content = new TextEncoder().encode(JSON.stringify(sharedData, null, 2));
				await this.fileSystemService.writeFile(this._cacheFile, content);
			}

			await this.extensionContext.globalState.update(LEGACY_BULK_MIGRATED_KEY, true);
			this.logService.info('[ChatSessionMetadataStore] Migrated legacy bulk metadata file to ~/.dardcor/');
		} catch (err) {
			this.logService.error('[ChatSessionMetadataStore] Failed to migrate legacy bulk file: ', err);
		}
	}
}
