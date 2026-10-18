/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { Sequencer, SequencerByKey } from '../../../base/common/async.js';
import type { Database, RunResult } from '@vscode/sqlite3';
import type { IFileEditContent, IFileEditRecord, ILocalTurnRecord, IReviewedFileRecord, ISessionDatabase } from '../common/sessionDataService.js';
import { dirname } from '../../../base/common/path.js';
import { URI } from '../../../base/common/uri.js';
import { AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY, type Message } from '../common/state/sessionState.js';

export interface ISessionDatabaseMigration {
	readonly version: number;
	readonly sql: string;
}

export const sessionDatabaseMigrations: readonly ISessionDatabaseMigration[] = [
	{
		version: 1,
		sql: [
			`CREATE TABLE IF NOT EXISTS turns (
				id TEXT PRIMARY KEY NOT NULL
			)`,
			`CREATE TABLE IF NOT EXISTS file_edits (
				turn_id        TEXT    NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
				tool_call_id   TEXT    NOT NULL,
				file_path      TEXT    NOT NULL,
				before_content BLOB   NOT NULL,
				after_content  BLOB   NOT NULL,
				added_lines    INTEGER,
				removed_lines  INTEGER,
				PRIMARY KEY (tool_call_id, file_path)
			)`,
		].join(';\n'),
	},
	{
		version: 2,
		sql: `CREATE TABLE IF NOT EXISTS session_metadata (
			key   TEXT PRIMARY KEY NOT NULL,
			value TEXT NOT NULL
		)`,
	},
	{
		version: 3,
		sql: [
			`CREATE TABLE file_edits_v3 (
				turn_id        TEXT    NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
				tool_call_id   TEXT    NOT NULL,
				file_path      TEXT    NOT NULL,
				edit_type      TEXT    NOT NULL DEFAULT 'edit',
				original_path  TEXT,
				before_content BLOB,
				after_content  BLOB,
				added_lines    INTEGER,
				removed_lines  INTEGER,
				PRIMARY KEY (tool_call_id, file_path)
			)`,
			`INSERT INTO file_edits_v3 (turn_id, tool_call_id, file_path, edit_type, before_content, after_content, added_lines, removed_lines)
				SELECT turn_id, tool_call_id, file_path, 'edit', before_content, after_content, added_lines, removed_lines FROM file_edits`,
			`DROP TABLE file_edits`,
			`ALTER TABLE file_edits_v3 RENAME TO file_edits`,
		].join(';\n'),
	},
	{
		version: 4,
		sql: [
			`ALTER TABLE turns ADD COLUMN event_id TEXT`,
			`CREATE INDEX IF NOT EXISTS idx_turns_event_id ON turns(event_id)`,
		].join(';\n'),
	},
	{
		version: 5,
		sql: `ALTER TABLE turns ADD COLUMN checkpoint_ref TEXT`,
	},
	{
		version: 6,
		sql: `CREATE TABLE IF NOT EXISTS chat_drafts (
			chat_uri TEXT PRIMARY KEY NOT NULL,
			draft    TEXT NOT NULL
		)`,
	},
	{
		version: 7,
		sql: `CREATE TABLE IF NOT EXISTS reviewed_files (
			uri   TEXT NOT NULL,
			nonce TEXT NOT NULL,
			PRIMARY KEY (uri, nonce)
		)`,
	},
	{
		version: 8,
		sql: `CREATE TABLE IF NOT EXISTS local_turns (
			turn_id        TEXT PRIMARY KEY NOT NULL,
			chat_uri       TEXT NOT NULL,
			anchor_turn_id TEXT,
			seq            INTEGER NOT NULL,
			payload        TEXT NOT NULL
		)`,
	},
	{
		version: 9,
		sql: `CREATE TABLE IF NOT EXISTS turn_usage (
			turn_id TEXT PRIMARY KEY NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			usage   TEXT NOT NULL
		)`,
	},
	{
		version: 10,
		sql: `CREATE TABLE IF NOT EXISTS turn_delegation (
			turn_id    TEXT PRIMARY KEY NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			delegation TEXT NOT NULL
		)`,
	},
	{
		version: 11,
		sql: `CREATE TABLE IF NOT EXISTS turn_workspace_transition (
			turn_id    TEXT PRIMARY KEY NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
			transition TEXT NOT NULL
		)`,
	},
	{
		version: 12,
		sql: `INSERT OR REPLACE INTO session_metadata (key, value)
			SELECT '${AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY}', 'true'
			WHERE EXISTS (SELECT 1 FROM turn_workspace_transition)`,
	},
];


function dbExec(db: Database, sql: string): Promise<void> {
	return new Promise((resolve, reject) => {
		db.exec(sql, err => err ? reject(err) : resolve());
	});
}

function dbRun(db: Database, sql: string, params: unknown[]): Promise<{ changes: number; lastID: number }> {
	return new Promise((resolve, reject) => {
		db.run(sql, params, function (this: RunResult, err: Error | null) {
			if (err) {
				return reject(err);
			}
			resolve({ changes: this.changes, lastID: this.lastID });
		});
	});
}

function dbGet(db: Database, sql: string, params: unknown[]): Promise<Record<string, unknown> | undefined> {
	return new Promise((resolve, reject) => {
		db.get(sql, params, (err: Error | null, row: Record<string, unknown> | undefined) => {
			if (err) {
				return reject(err);
			}
			resolve(row);
		});
	});
}

function dbAll(db: Database, sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
	return new Promise((resolve, reject) => {
		db.all(sql, params, (err: Error | null, rows: Record<string, unknown>[]) => {
			if (err) {
				return reject(err);
			}
			resolve(rows);
		});
	});
}

function dbClose(db: Database): Promise<void> {
	return new Promise((resolve, reject) => {
		db.close(err => err ? reject(err) : resolve());
	});
}

function dbOpen(path: string): Promise<Database> {
	return new Promise((resolve, reject) => {
		import('@vscode/sqlite3').then(sqlite3 => {
			const db = new sqlite3.default.Database(path, (err: Error | null) => {
				if (err) {
					return reject(err);
				}
				resolve(db);
			});
		}, reject);
	});
}

export async function runMigrations(db: Database, migrations: readonly ISessionDatabaseMigration[]): Promise<void> {
	await dbExec(db, 'PRAGMA foreign_keys = ON');

	const row = await dbGet(db, 'PRAGMA user_version', []);
	const currentVersion = (row?.user_version as number | undefined) ?? 0;

	const pending = migrations
		.filter(m => m.version > currentVersion)
		.sort((a, b) => a.version - b.version);

	if (pending.length === 0) {
		return;
	}

	await dbExec(db, 'BEGIN TRANSACTION');
	try {
		for (const migration of pending) {
			await dbExec(db, migration.sql);
			await dbExec(db, `PRAGMA user_version = ${migration.version}`);
		}
		await dbExec(db, 'COMMIT');
	} catch (err) {
		await dbExec(db, 'ROLLBACK');
		throw err;
	}
}

export class SessionDatabase implements ISessionDatabase {

	protected _dbPromise: Promise<Database> | undefined;
	protected _closed: Promise<void> | true | undefined;
	private readonly _fileEditSequencer = new SequencerByKey<string>();

	private readonly _metadataSequencer = new Sequencer();
	private readonly _mutationSequencer = new Sequencer();

	private readonly _turnUsageSequencer = new Sequencer();

	private _queueOperation<T>(operation: (db: Database) => Promise<T>): Promise<T> {
		return this._mutationSequencer.queue(async () => operation(await this._ensureDb()));
	}

	protected _queueMutation<T>(operation: (db: Database) => Promise<T>): Promise<T> {
		return this._queueOperation(operation);
	}

	private _mutate<T>(operation: (db: Database) => Promise<T>): Promise<T> {
		return this._track(() => this._queueMutation(operation));
	}

	private _queueTransaction<T>(operation: (db: Database) => Promise<T>): Promise<T> {
		return this._queueMutation(async db => {
			await dbExec(db, 'BEGIN TRANSACTION');
			try {
				const result = await operation(db);
				await dbExec(db, 'COMMIT');
				return result;
			} catch (err) {
				await dbExec(db, 'ROLLBACK');
				throw err;
			}
		});
	}

	private _mutateTurnUsage(operation: (db: Database) => Promise<void>): Promise<void> {
		return this._track(() => this._turnUsageSequencer.queue(() => this._queueMutation(operation)));
	}

	protected _mutateMetadataAndTurnUsage(operation: (db: Database) => Promise<void>): Promise<void> {
		return this._track(() => this._metadataSequencer.queue(() =>
			this._turnUsageSequencer.queue(() =>
				this._queueTransaction(operation)
			)
		));
	}

	private async _deleteWorkspaceTransitionMarkerIfEmpty(db: Database): Promise<void> {
		await dbRun(
			db,
			`DELETE FROM session_metadata
				WHERE key = ?
				AND NOT EXISTS (SELECT 1 FROM turn_workspace_transition)`,
			[AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY],
		);
	}

	private readonly _pendingWrites = new Set<Promise<unknown>>();

	constructor(
		private readonly _path: string,
		private readonly _migrations: readonly ISessionDatabaseMigration[] = sessionDatabaseMigrations,
	) { }

	static async open(path: string, migrations: readonly ISessionDatabaseMigration[] = sessionDatabaseMigrations): Promise<SessionDatabase> {
		const inst = new SessionDatabase(path, migrations);
		await inst._ensureDb();
		return inst;
	}

	protected _ensureDb(): Promise<Database> {
		if (this._closed) {
			return Promise.reject(new Error('SessionDatabase has been disposed'));
		}
		if (!this._dbPromise) {
			this._dbPromise = (async () => {
				await fs.promises.mkdir(dirname(this._path), { recursive: true });
				const db = await dbOpen(this._path);
				try {
					await runMigrations(db, this._migrations);
				} catch (err) {
					await dbClose(db);
					this._dbPromise = undefined;
					throw err;
				}
				if (this._closed) {
					await dbClose(db);
					throw new Error('SessionDatabase has been disposed');
				}
				return db;
			})().catch(err => {
				this._dbPromise = undefined;
				throw err;
			});
		}
		return this._dbPromise;
	}

	async getAllTables(): Promise<string[]> {
		const db = await this._ensureDb();
		const rows = await dbAll(db, `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`, []);
		return rows.map(r => r.name as string);
	}


	createTurn(turnId: string): Promise<void> {
		return this._mutate(async db => {
			await dbRun(db, 'INSERT OR IGNORE INTO turns (id) VALUES (?)', [turnId]);
		});
	}

	deleteTurn(turnId: string): Promise<void> {
		return this._mutateMetadataAndTurnUsage(async db => {
			await dbRun(db, 'DELETE FROM turns WHERE id = ?', [turnId]);
			await this._deleteWorkspaceTransitionMarkerIfEmpty(db);
		});
	}

	setTurnEventId(turnId: string, eventId: string): Promise<void> {
		return this._mutate(async db => {
			await dbRun(db, 'INSERT OR IGNORE INTO turns (id) VALUES (?)', [turnId]);
			await dbRun(db, 'UPDATE turns SET event_id = ? WHERE id = ? AND event_id IS NULL', [eventId, turnId]);
		});
	}

	getTurnEventId(turnId: string): Promise<string | undefined> {
		return this._queueOperation(async db => {
			const row = await dbGet(db, 'SELECT event_id FROM turns WHERE id = ?1 OR event_id = ?1 LIMIT 1', [turnId]);
			return row?.event_id as string | undefined ?? undefined;
		});
	}

	getNextTurnEventId(turnId: string): Promise<string | undefined> {
		return this._queueOperation(async db => {
			const row = await dbGet(
				db,
				`SELECT event_id FROM turns
					WHERE rowid > (
						SELECT rowid FROM turns WHERE id = ?1 OR event_id = ?1 LIMIT 1
					)
					ORDER BY rowid LIMIT 1`,
				[turnId],
			);
			return row?.event_id as string | undefined ?? undefined;
		});
	}

	getFirstTurnEventId(): Promise<string | undefined> {
		return this._queueOperation(async db => {
			const row = await dbGet(db, 'SELECT event_id FROM turns ORDER BY rowid LIMIT 1', []);
			return row?.event_id as string | undefined ?? undefined;
		});
	}

	setTurnUsage(turnId: string, usage: string): Promise<void> {
		return this._mutateTurnUsage(async db => {
			await dbRun(db, 'INSERT OR IGNORE INTO turns (id) VALUES (?)', [turnId]);
			await dbRun(db, 'INSERT OR REPLACE INTO turn_usage (turn_id, usage) VALUES (?, ?)', [turnId, usage]);
		});
	}

	async getTurnUsages(): Promise<Map<string, string>> {
		return this._turnUsageSequencer.queue(async () => {
			const db = await this._ensureDb();
			const rows = await dbAll(
				db,
				`SELECT u.turn_id AS turn_id, t.event_id AS event_id, u.usage AS usage
				FROM turn_usage u LEFT JOIN turns t ON t.id = u.turn_id`,
				[],
			);
			const result = new Map<string, string>();
			for (const row of rows) {
				const usage = row.usage as string;
				result.set(row.turn_id as string, usage);
				const eventId = row.event_id as string | null;
				if (eventId) {
					result.set(eventId, usage);
				}
			}
			return result;
		});
	}

	setTurnDelegation(turnId: string, delegation: string): Promise<void> {
		return this._mutate(async db => {
			await dbRun(db, 'INSERT OR IGNORE INTO turns (id) VALUES (?)', [turnId]);
			await dbRun(db, 'INSERT OR REPLACE INTO turn_delegation (turn_id, delegation) VALUES (?, ?)', [turnId, delegation]);
		});
	}

	async getTurnDelegations(): Promise<Map<string, string>> {
		await this.whenIdle();
		const db = await this._ensureDb();
		const rows = await dbAll(
			db,
			`SELECT d.turn_id AS turn_id, t.event_id AS event_id, d.delegation AS delegation
			FROM turn_delegation d LEFT JOIN turns t ON t.id = d.turn_id`,
			[],
		);
		const result = new Map<string, string>();
		for (const row of rows) {
			const delegation = row.delegation as string;
			result.set(row.turn_id as string, delegation);
			const eventId = row.event_id as string | null;
			if (eventId) {
				result.set(eventId, delegation);
			}
		}
		return result;
	}

	setTurnWorkspaceTransition(turnId: string, transition: string): Promise<void> {
		return this.setWorkspaceConversion(turnId, transition, {});
	}

	setWorkspaceConversion(turnId: string, transition: string, metadata: Readonly<Record<string, string>>): Promise<void> {
		return this._mutateMetadataAndTurnUsage(async db => {
			await dbRun(db, 'INSERT OR IGNORE INTO turns (id) VALUES (?)', [turnId]);
			await dbRun(db, 'INSERT OR REPLACE INTO turn_workspace_transition (turn_id, transition) VALUES (?, ?)', [turnId, transition]);
			for (const [key, value] of Object.entries({ ...metadata, [AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY]: 'true' })) {
				await dbRun(db, 'INSERT OR REPLACE INTO session_metadata (key, value) VALUES (?, ?)', [key, value]);
			}
		});
	}

	deleteTurnWorkspaceTransition(turnId: string): Promise<void> {
		return this._mutateMetadataAndTurnUsage(async db => {
			await dbRun(db, 'DELETE FROM turn_workspace_transition WHERE turn_id = ?', [turnId]);
			await this._deleteWorkspaceTransitionMarkerIfEmpty(db);
		});
	}

	async getTurnWorkspaceTransitions(): Promise<Map<string, string>> {
		return this._turnUsageSequencer.queue(() => this._queueMutation(async db => {
			const rows = await dbAll(
				db,
				`SELECT w.turn_id AS turn_id, t.event_id AS event_id, w.transition AS transition
				FROM turn_workspace_transition w LEFT JOIN turns t ON t.id = w.turn_id`,
				[],
			);
			const result = new Map<string, string>();
			for (const row of rows) {
				const transition = row.transition as string;
				result.set(row.turn_id as string, transition);
				const eventId = row.event_id as string | null;
				if (eventId) {
					result.set(eventId, transition);
				}
			}
			return result;
		}));
	}

	setTurnCheckpointRef(turnId: string, ref: string): Promise<void> {
		return this._mutate(async db => {
			await dbRun(db, 'INSERT OR IGNORE INTO turns (id) VALUES (?)', [turnId]);
			await dbRun(db, 'UPDATE turns SET checkpoint_ref = ? WHERE id = ?', [ref, turnId]);
		});
	}

	async getTurnCheckpointRef(turnId: string): Promise<string | undefined> {
		const db = await this._ensureDb();
		const row = await dbGet(db, 'SELECT checkpoint_ref FROM turns WHERE id = ?1 OR event_id = ?1 LIMIT 1', [turnId]);
		return row?.checkpoint_ref as string | undefined ?? undefined;
	}

	async getPreviousCheckpointRef(turnId: string): Promise<string | undefined> {
		const db = await this._ensureDb();
		const row = await dbGet(
			db,
			`SELECT checkpoint_ref FROM turns
				WHERE rowid < (SELECT rowid FROM turns WHERE id = ?1 OR event_id = ?1 LIMIT 1)
					AND checkpoint_ref IS NOT NULL
				ORDER BY rowid DESC LIMIT 1`,
			[turnId],
		);
		return row?.checkpoint_ref as string | undefined ?? undefined;
	}

	async getAllCheckpointRefs(): Promise<string[]> {
		const db = await this._ensureDb();
		const rows = await dbAll(db, 'SELECT checkpoint_ref FROM turns WHERE checkpoint_ref IS NOT NULL ORDER BY rowid', []);
		return rows.map(r => r.checkpoint_ref as string);
	}

	truncateFromTurn(turnId: string): Promise<void> {
		return this._mutateMetadataAndTurnUsage(async db => {
			await dbRun(db,
				`DELETE FROM turns WHERE rowid >= (SELECT rowid FROM turns WHERE id = ?)`,
				[turnId],
			);
			await this._deleteWorkspaceTransitionMarkerIfEmpty(db);
		});
	}

	deleteTurnsAfter(turnId: string): Promise<void> {
		return this._mutateMetadataAndTurnUsage(async db => {
			await dbRun(db,
				`DELETE FROM turns WHERE rowid > (SELECT rowid FROM turns WHERE id = ?)`,
				[turnId],
			);
			await this._deleteWorkspaceTransitionMarkerIfEmpty(db);
		});
	}

	deleteAllTurns(): Promise<void> {
		return this._mutateMetadataAndTurnUsage(async db => {
			await dbExec(db, 'DELETE FROM turns');
			await this._deleteWorkspaceTransitionMarkerIfEmpty(db);
		});
	}


	insertLocalTurn(record: ILocalTurnRecord): Promise<void> {
		return this._mutate(async db => {
			await dbRun(db,
				'INSERT OR REPLACE INTO local_turns (turn_id, chat_uri, anchor_turn_id, seq, payload) VALUES (?, ?, ?, ?, ?)',
				[record.turnId, record.chatUri, record.anchorTurnId ?? null, record.seq, record.payload],
			);
		});
	}

	async getLocalTurns(): Promise<ILocalTurnRecord[]> {
		const db = await this._ensureDb();
		const rows = await dbAll(db, 'SELECT turn_id, chat_uri, anchor_turn_id, seq, payload FROM local_turns ORDER BY seq', []);
		return rows.map(r => ({
			turnId: r.turn_id as string,
			chatUri: r.chat_uri as string,
			anchorTurnId: (r.anchor_turn_id as string | null) ?? undefined,
			seq: r.seq as number,
			payload: r.payload as string,
		}));
	}

	deleteLocalTurns(turnIds: readonly string[]): Promise<void> {
		return this._track(() => {
			if (turnIds.length === 0) {
				return Promise.resolve();
			}
			return this._queueMutation(async db => {
				const placeholders = turnIds.map(() => '?').join(',');
				await dbRun(db, `DELETE FROM local_turns WHERE turn_id IN (${placeholders})`, [...turnIds]);
			});
		});
	}


	storeFileEdit(edit: IFileEditRecord & IFileEditContent): Promise<void> {
		return this._track(() => this._fileEditSequencer.queue(edit.filePath, () => this._queueMutation(async db => {
			await dbRun(db, 'INSERT OR IGNORE INTO turns (id) VALUES (?)', [edit.turnId]);
			await dbRun(
				db,
				`INSERT OR REPLACE INTO file_edits
					(turn_id, tool_call_id, file_path, edit_type, original_path, before_content, after_content, added_lines, removed_lines)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					edit.turnId,
					edit.toolCallId,
					edit.filePath,
					edit.kind,
					edit.originalPath ?? null,
					edit.beforeContent ? Buffer.from(edit.beforeContent) : null,
					edit.afterContent ? Buffer.from(edit.afterContent) : null,
					edit.addedLines ?? null,
					edit.removedLines ?? null,
				],
			);
		})));
	}

	async getFileEdits(toolCallIds: string[]): Promise<IFileEditRecord[]> {
		if (toolCallIds.length === 0) {
			return [];
		}
		const db = await this._ensureDb();
		const placeholders = toolCallIds.map(() => '?').join(',');
		const rows = await dbAll(
			db,
			`SELECT turn_id, tool_call_id, file_path, edit_type, original_path, added_lines, removed_lines
				FROM file_edits
				WHERE tool_call_id IN (${placeholders})
				ORDER BY rowid`,
			toolCallIds,
		);
		return rows.map(row => ({
			turnId: row.turn_id as string,
			toolCallId: row.tool_call_id as string,
			filePath: row.file_path as string,
			kind: (row.edit_type as IFileEditRecord['kind']) ?? 'edit',
			originalPath: row.original_path as string | undefined ?? undefined,
			addedLines: row.added_lines as number | undefined ?? undefined,
			removedLines: row.removed_lines as number | undefined ?? undefined,
		}));
	}

	async getAllFileEdits(): Promise<IFileEditRecord[]> {
		const db = await this._ensureDb();
		const rows = await dbAll(
			db,
			`SELECT turn_id, tool_call_id, file_path, edit_type, original_path, added_lines, removed_lines
				FROM file_edits
				ORDER BY rowid`,
			[],
		);
		return rows.map(row => ({
			turnId: row.turn_id as string,
			toolCallId: row.tool_call_id as string,
			filePath: row.file_path as string,
			kind: (row.edit_type as IFileEditRecord['kind']) ?? 'edit',
			originalPath: row.original_path as string | undefined ?? undefined,
			addedLines: row.added_lines as number | undefined ?? undefined,
			removedLines: row.removed_lines as number | undefined ?? undefined,
		}));
	}

	async getFileEditsByTurn(turnId: string): Promise<IFileEditRecord[]> {
		const db = await this._ensureDb();
		const rows = await dbAll(
			db,
			`SELECT turn_id, tool_call_id, file_path, edit_type, original_path, added_lines, removed_lines
				FROM file_edits
				WHERE turn_id = ?
				ORDER BY rowid`,
			[turnId],
		);
		return rows.map(row => ({
			turnId: row.turn_id as string,
			toolCallId: row.tool_call_id as string,
			filePath: row.file_path as string,
			kind: (row.edit_type as IFileEditRecord['kind']) ?? 'edit',
			originalPath: row.original_path as string | undefined ?? undefined,
			addedLines: row.added_lines as number | undefined ?? undefined,
			removedLines: row.removed_lines as number | undefined ?? undefined,
		}));
	}

	async readFileEditContent(toolCallId: string, filePath: string): Promise<IFileEditContent | undefined> {
		return this._fileEditSequencer.queue(filePath, async () => {
			const db = await this._ensureDb();
			const row = await dbGet(
				db,
				`SELECT before_content, after_content
					FROM file_edits
					WHERE tool_call_id = ? AND file_path = ?`,
				[toolCallId, filePath],
			);
			if (!row) {
				return undefined;
			}
			return {
				beforeContent: row.before_content ? toUint8Array(row.before_content) : undefined,
				afterContent: row.after_content ? toUint8Array(row.after_content) : undefined,
			};
		});
	}


	async getMetadata(key: string): Promise<string | undefined> {
		const db = await this._ensureDb();
		const row = await dbGet(db, 'SELECT value FROM session_metadata WHERE key = ?', [key]);
		return row?.value as string | undefined;
	}

	async getMetadataObject<T extends Record<string, unknown>>(obj: T): Promise<{ [K in keyof T]: string | undefined }> {
		const keys = Object.keys(obj) as (keyof T & string)[];
		// eslint-disable-next-line local/code-no-dangerous-type-assertions
		const result = {} as { [K in keyof T]: string | undefined };
		if (keys.length === 0) {
			return result;
		}
		const db = await this._ensureDb();
		const placeholders = keys.map(() => '?').join(',');
		const rows = await dbAll(db, `SELECT key, value FROM session_metadata WHERE key IN (${placeholders})`, keys);
		for (const key of keys) {
			result[key] = undefined;
		}
		for (const row of rows) {
			result[row.key as keyof T] = row.value as string;
		}
		return result;
	}

	setMetadata(key: string, value: string): Promise<void> {
		return this._track(() => this._metadataSequencer.queue(() => this._queueMutation(async db => {
			await dbRun(db, 'INSERT OR REPLACE INTO session_metadata (key, value) VALUES (?, ?)', [key, value]);
		})));
	}

	setMetadataValues(values: Readonly<Record<string, string>>): Promise<void> {
		return this._track(() => this._metadataSequencer.queue(() =>
			this._queueTransaction(async db => {
				for (const [key, value] of Object.entries(values)) {
					await dbRun(db, 'INSERT OR REPLACE INTO session_metadata (key, value) VALUES (?, ?)', [key, value]);
				}
			})
		));
	}

	deleteMetadata(keys: readonly string[]): Promise<void> {
		return this._track(() => this._metadataSequencer.queue(() => {
			if (keys.length === 0) {
				return Promise.resolve();
			}
			return this._queueMutation(async db => {
				const placeholders = keys.map(() => '?').join(',');
				await dbRun(db, `DELETE FROM session_metadata WHERE key IN (${placeholders})`, [...keys]);
			});
		}));
	}

	setMetadataValuesIfAbsent(key: string, values: Readonly<Record<string, string>>, copies: Readonly<Record<string, string>> = {}): Promise<boolean> {
		return this._track(() => this._metadataSequencer.queue(() =>
			this._queueTransaction(async db => {
				const existing = await dbGet(db, 'SELECT 1 FROM session_metadata WHERE key = ?', [key]);
				if (existing) {
					return false;
				}
				for (const [targetKey, value] of Object.entries(values)) {
					await dbRun(db, 'INSERT OR REPLACE INTO session_metadata (key, value) VALUES (?, ?)', [targetKey, value]);
				}
				for (const [targetKey, sourceKey] of Object.entries(copies)) {
					await dbRun(db, 'INSERT OR REPLACE INTO session_metadata (key, value) SELECT ?, value FROM session_metadata WHERE key = ?', [targetKey, sourceKey]);
				}
				return true;
			})
		));
	}

	setChatDraft(chat: URI, draft: Message | undefined): Promise<void> {
		const chatUri = chat.toString();
		return this._mutate(async db => {
			if (!draft) {
				await dbRun(db, 'DELETE FROM chat_drafts WHERE chat_uri = ?', [chatUri]);
				return;
			}
			await dbRun(db, 'INSERT OR REPLACE INTO chat_drafts (chat_uri, draft) VALUES (?, ?)', [chatUri, JSON.stringify(draft)]);
		});
	}

	async getChatDraft(chat: URI): Promise<Message | undefined> {
		const db = await this._ensureDb();
		const row = await dbGet(db, 'SELECT draft FROM chat_drafts WHERE chat_uri = ?', [chat.toString()]);
		if (typeof row?.draft !== 'string') {
			return undefined;
		}
		try {
			return JSON.parse(row.draft) as Message;
		} catch {
			return undefined;
		}
	}


	markFileReviewed(uri: URI, nonce: string): Promise<void> {
		return this._mutate(async db => {
			await dbRun(db, 'INSERT OR IGNORE INTO reviewed_files (uri, nonce) VALUES (?, ?)', [uri.toString(), nonce]);
		});
	}

	unmarkFileReviewed(uri: URI, nonce: string): Promise<void> {
		return this._mutate(async db => {
			await dbRun(db, 'DELETE FROM reviewed_files WHERE uri = ? AND nonce = ?', [uri.toString(), nonce]);
		});
	}

	async getReviewedFiles(): Promise<IReviewedFileRecord[]> {
		const db = await this._ensureDb();
		const rows = await dbAll(db, 'SELECT uri, nonce FROM reviewed_files ORDER BY rowid', []);
		return rows.map(toReviewedFileRecord);
	}

	async getReviewedFilesForUri(uri: URI): Promise<IReviewedFileRecord[]> {
		const db = await this._ensureDb();
		const rows = await dbAll(db, 'SELECT uri, nonce FROM reviewed_files WHERE uri = ? ORDER BY rowid', [uri.toString()]);
		return rows.map(toReviewedFileRecord);
	}

	async isFileReviewed(uri: URI, nonce: string): Promise<boolean> {
		const db = await this._ensureDb();
		const row = await dbGet(db, 'SELECT 1 FROM reviewed_files WHERE uri = ? AND nonce = ? LIMIT 1', [uri.toString(), nonce]);
		return !!row;
	}

	remapTurnIds(mapping: ReadonlyMap<string, string>, eventIds?: ReadonlyMap<string, string>): Promise<void> {
		return this._mutateMetadataAndTurnUsage(async db => {
			await dbExec(db, 'PRAGMA defer_foreign_keys = ON');
			const oldIds = [...mapping.keys()];
			if (oldIds.length > 0) {
				const placeholders = oldIds.map(() => '?').join(',');
				await dbRun(db,
					`DELETE FROM turns WHERE id NOT IN (${placeholders})`,
					oldIds,
				);
			}

			for (const [oldId, newId] of mapping) {
				await dbRun(db, 'UPDATE turns SET id = ? WHERE id = ?', [newId, oldId]);
				await dbRun(db, 'UPDATE file_edits SET turn_id = ? WHERE turn_id = ?', [newId, oldId]);
			}
			for (const [turnId, eventId] of eventIds ?? []) {
				await dbRun(db, 'UPDATE turns SET event_id = ? WHERE id = ?', [eventId, turnId]);
			}

			if (oldIds.length > 0) {
				const placeholders = oldIds.map(() => '?').join(',');
				await dbRun(db,
					`DELETE FROM local_turns WHERE turn_id NOT IN (${placeholders})`,
					oldIds,
				);
			}
			for (const [oldId, newId] of mapping) {
				await dbRun(db, 'UPDATE local_turns SET turn_id = ? WHERE turn_id = ?', [newId, oldId]);
				await dbRun(db, 'UPDATE local_turns SET anchor_turn_id = ? WHERE anchor_turn_id = ?', [newId, oldId]);
			}

			for (const [oldId, newId] of mapping) {
				await dbRun(db, 'UPDATE turn_usage SET turn_id = ? WHERE turn_id = ?', [newId, oldId]);
				await dbRun(db, 'UPDATE turn_delegation SET turn_id = ? WHERE turn_id = ?', [newId, oldId]);
				await dbRun(db, 'UPDATE turn_workspace_transition SET turn_id = ? WHERE turn_id = ?', [newId, oldId]);
			}
			await this._deleteWorkspaceTransitionMarkerIfEmpty(db);
		});
	}

	async whenIdle(): Promise<void> {
		while (this._pendingWrites.size > 0) {
			await Promise.allSettled([...this._pendingWrites]);
		}
	}

	vacuumInto(targetPath: string): Promise<void> {
		return this._mutate(async db => {
			await dbRun(db, 'VACUUM INTO ?', [targetPath]);
		});
	}

	private _track<T>(fn: () => Promise<T>): Promise<T> {
		const p = fn();
		this._pendingWrites.add(p);
		const untrack = () => { this._pendingWrites.delete(p); };
		p.then(untrack, untrack);
		return p;
	}

	async close() {
		await (this._closed ??= this._dbPromise?.then(db => dbClose(db)).catch(() => { }) || true);
	}

	dispose(): void {
		this.close();
	}
}

function toReviewedFileRecord(row: Record<string, unknown>): IReviewedFileRecord {
	return {
		uri: URI.parse(row.uri as string),
		nonce: row.nonce as string,
	};
}

function toUint8Array(value: unknown): Uint8Array {
	if (value instanceof Buffer) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	if (value instanceof Uint8Array) {
		return value;
	}
	if (typeof value === 'string') {
		return new TextEncoder().encode(value);
	}
	return new Uint8Array(0);
}
