/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IReference, ReferenceCollection } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../files/common/files.js';
import { ILogService } from '../../log/common/log.js';
import { AgentSession } from '../common/agent.js';
import { DEV_CONTAINER_WORKTREE_DATA_ID_PREFIX } from '../common/meta/agentDevContainerWorktreeMeta.js';
import { ISessionDatabase, ISessionDataService, IWillDeleteSessionDataEvent, SESSION_DB_FILENAME } from '../common/sessionDataService.js';
import { SessionDatabase } from './sessionDatabase.js';

class SessionDatabaseCollection extends ReferenceCollection<ISessionDatabase> {

	readonly liveDatabases = new Set<ISessionDatabase>();

	constructor(
		private readonly _getDbPath: (key: string) => string,
		private readonly _logService: ILogService,
	) {
		super();
	}

	protected createReferencedObject(key: string): ISessionDatabase {
		const dbPath = this._getDbPath(key);
		this._logService.trace(`[SessionDataService] Opening database: ${dbPath}`);
		const db = new SessionDatabase(dbPath);
		this.liveDatabases.add(db);
		return db;
	}

	protected destroyReferencedObject(_key: string, object: ISessionDatabase): void {
		this.liveDatabases.delete(object);
		object.dispose();
	}
}

export class SessionDataService implements ISessionDataService {
	declare readonly _serviceBrand: undefined;

	private readonly _basePath: URI;
	private readonly _databases: SessionDatabaseCollection;
	private readonly _onWillDeleteSessionData = new Emitter<IWillDeleteSessionDataEvent>();

	get onWillDeleteSessionData(): Event<IWillDeleteSessionDataEvent> {
		return this._onWillDeleteSessionData.event;
	}

	constructor(
		userDataPath: URI,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		getDbPath?: (key: string) => string,
	) {
		this._basePath = URI.joinPath(userDataPath, 'agentSessionData');
		this._databases = new SessionDatabaseCollection(
			getDbPath ?? (key => URI.joinPath(this._basePath, key, SESSION_DB_FILENAME).fsPath),
			this._logService,
		);
	}

	getSessionDataDir(session: URI): URI {
		return URI.joinPath(this._basePath, this._sanitizedSessionKey(session));
	}

	getSessionDataDirById(sessionId: string): URI {
		const sanitized = sessionId.replace(/[^a-zA-Z0-9_.-]/g, '-');
		return URI.joinPath(this._basePath, sanitized);
	}

	private _sanitizedSessionKey(session: URI): string {
		return this._dataKey(session).replace(/[^a-zA-Z0-9_.-]/g, '-');
	}

	private _dataKey(uri: URI): string {
		const id = AgentSession.id(uri);
		return uri.authority ? `${uri.authority}-${id}` : id;
	}

	openDatabase(session: URI): IReference<ISessionDatabase> {
		return this._databases.acquire(this._sanitizedSessionKey(session));
	}

	async tryOpenDatabase(session: URI): Promise<IReference<ISessionDatabase> | undefined> {
		const key = this._sanitizedSessionKey(session);
		const dbPath = URI.joinPath(this._basePath, key, SESSION_DB_FILENAME);
		try {
			await this._fileService.stat(dbPath);
		} catch (error) {
			if (toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
				return undefined;
			}
			throw error;
		}
		return this._databases.acquire(key);
	}

	async deleteSessionData(session: URI, workingDirectories?: readonly string[]): Promise<void> {
		const dir = this.getSessionDataDir(session);
		const pending: Promise<unknown>[] = [];
		try {
			this._onWillDeleteSessionData.fire({
				session,
				workingDirectories,
				waitUntil: p => { pending.push(p); },
			});
		} catch (err) {
			this._logService.warn(`[SessionDataService] onWillDeleteSessionData listener threw synchronously: ${dir.toString()}`, err);
		}
		if (pending.length > 0) {
			const results = await Promise.allSettled(pending);
			for (const r of results) {
				if (r.status === 'rejected') {
					this._logService.warn(`[SessionDataService] onWillDeleteSessionData waitUntil rejected: ${dir.toString()}`, r.reason);
				}
			}
		}
		try {
			if (await this._fileService.exists(dir)) {
				await this._fileService.del(dir, { recursive: true });
				this._logService.trace(`[SessionDataService] Deleted session data: ${dir.toString()}`);
			}
		} catch (err) {
			this._logService.warn(`[SessionDataService] Failed to delete session data: ${dir.toString()}`, err);
		}
	}

	async cleanupOrphanedData(knownSessionIds: Set<string>): Promise<void> {
		try {
			const exists = await this._fileService.exists(this._basePath);
			if (!exists) {
				return;
			}

			const stat = await this._fileService.resolve(this._basePath);
			if (!stat.children) {
				return;
			}

			const deletions: Promise<void>[] = [];
			for (const child of stat.children) {
				if (!child.isDirectory) {
					continue;
				}
				const name = child.name;
				if (!knownSessionIds.has(name) && !name.startsWith(DEV_CONTAINER_WORKTREE_DATA_ID_PREFIX)) {
					this._logService.trace(`[SessionDataService] Cleaning up orphaned session data: ${name}`);
					deletions.push(
						this._fileService.del(child.resource, { recursive: true }).catch(err => {
							this._logService.warn(`[SessionDataService] Failed to clean up orphaned data: ${name}`, err);
						})
					);
				}
			}

			await Promise.all(deletions);
		} catch (err) {
			this._logService.warn('[SessionDataService] Failed to run orphan cleanup', err);
		}
	}

	async listSessionDataIds(prefix: string): Promise<readonly string[]> {
		if (!await this._fileService.exists(this._basePath)) {
			return [];
		}
		const stat = await this._fileService.resolve(this._basePath);
		return stat.children?.filter(child => child.isDirectory && child.name.startsWith(prefix)).map(child => child.name) ?? [];
	}

	async whenIdle(): Promise<void> {
		while (true) {
			const dbs = [...this._databases.liveDatabases];
			if (dbs.length === 0) {
				return;
			}
			await Promise.all(dbs.map(db => db.whenIdle()));
			const newOnes = [...this._databases.liveDatabases].filter(db => !dbs.includes(db));
			if (newOnes.length === 0) {
				return;
			}
		}
	}
}
