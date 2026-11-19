/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdirSync, rmSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'path';
import type { CheckpointRow, FileRow, ISessionStore, RefRow, SearchResult, SessionRow, SessionStoreOptions, TurnRow } from '../common/sessionStore';

const SQLITE_OK = 0;
const SQLITE_DENY = 1;
const SQLITE_READ = 20;
const SQLITE_SELECT = 21;
const SQLITE_FUNCTION = 31;
const SQLITE_PRAGMA = 19;
const SQLITE_RECURSIVE = 33;

const READ_ONLY_ACTION_CODES = new Set([
	SQLITE_READ,
	SQLITE_SELECT,
	SQLITE_FUNCTION,
	SQLITE_RECURSIVE,
]);

const DENIED_FUNCTIONS = new Set(['load_extension']);

const SCHEMA_VERSION = 3;

const CORRUPTION_ERROR_MARKERS = [
	'malformed',
	'file is not a database',
	'not a database',
	'disk image',
	'disk i/o error',
];

function errorMessageIncludes(err: unknown, markers: readonly string[]): boolean {
	const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
	return markers.some(marker => message.includes(marker));
}

export class SessionStore implements ISessionStore {
	declare readonly _serviceBrand: undefined;
	private db: DatabaseSync | null = null;
	private readonly dbPath: string;
	private readonly remote: boolean;

	constructor(dbPath: string, options?: SessionStoreOptions) {
		this.dbPath = dbPath;
		this.remote = options?.remote ?? false;
	}

	getPath(): string {
		return this.dbPath;
	}

	private ensureDb(): DatabaseSync {
		if (this.db) {
			return this.db;
		}

		try {
			return this.openDb();
		} catch (err) {
			if (this.dbPath !== ':memory:' && errorMessageIncludes(err, CORRUPTION_ERROR_MARKERS)) {
				this.deleteDbFiles();
				return this.openDb();
			}
			throw err;
		}
	}

	private openDb(): DatabaseSync {
		if (this.dbPath !== ':memory:') {
			mkdirSync(dirname(this.dbPath), { recursive: true });
		}

		const db = new DatabaseSync(this.dbPath);
		try {
			if (this.remote) {
				db.exec('PRAGMA journal_mode = DELETE');
				db.exec('PRAGMA busy_timeout = 10000');
				db.exec('PRAGMA synchronous = NORMAL');
			} else {
				db.exec('PRAGMA journal_mode = WAL');
				db.exec('PRAGMA busy_timeout = 3000');
			}
			db.exec('PRAGMA foreign_keys = ON');
			this.db = db;
			this.ensureSchema();
		} catch (err) {
			db.close();
			this.db = null;
			throw err;
		}
		return this.db;
	}

	private deleteDbFiles(): void {
		for (const suffix of ['', '-wal', '-shm', '-journal']) {
			rmSync(this.dbPath + suffix, { force: true });
		}
	}

	private ensureSchema(): void {
		const db = this.db!;

		const versionRow = (() => {
			try {
				const stmt = db.prepare('SELECT version FROM schema_version LIMIT 1');
				return stmt.get() as unknown as { version: number } | undefined;
			} catch {
				return undefined;
			}
		})();

		const currentVersion = versionRow?.version ?? 0;

		if (currentVersion >= SCHEMA_VERSION) {
			return;
		}

		db.exec(`
			CREATE TABLE IF NOT EXISTS schema_version (
				version INTEGER NOT NULL
			);

			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				cwd TEXT,
				repository TEXT,
				host_type TEXT,
				branch TEXT,
				summary TEXT,
				agent_name TEXT,
				agent_description TEXT,
				created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
				updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
			);

			CREATE TABLE IF NOT EXISTS turns (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id TEXT NOT NULL REFERENCES sessions(id),
				turn_index INTEGER NOT NULL,
				user_message TEXT,
				assistant_response TEXT,
				timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
				UNIQUE(session_id, turn_index)
			);

			CREATE TABLE IF NOT EXISTS checkpoints (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id TEXT NOT NULL REFERENCES sessions(id),
				checkpoint_number INTEGER NOT NULL,
				title TEXT,
				overview TEXT,
				history TEXT,
				work_done TEXT,
				technical_details TEXT,
				important_files TEXT,
				next_steps TEXT,
				created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
				UNIQUE(session_id, checkpoint_number)
			);

			CREATE TABLE IF NOT EXISTS session_files (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id TEXT NOT NULL REFERENCES sessions(id),
				file_path TEXT NOT NULL,
				tool_name TEXT,
				turn_index INTEGER,
				first_seen_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
				UNIQUE(session_id, file_path)
			);

			CREATE TABLE IF NOT EXISTS session_refs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id TEXT NOT NULL REFERENCES sessions(id),
				ref_type TEXT NOT NULL,
				ref_value TEXT NOT NULL,
				turn_index INTEGER,
				created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
				UNIQUE(session_id, ref_type, ref_value)
			);

			CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repository);
			CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);
			CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(file_path);
			CREATE INDEX IF NOT EXISTS idx_session_refs_type_value ON session_refs(ref_type, ref_value);
			CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
			CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
		`);

		const ftsExists = db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'search_index\'').get();
		if (!ftsExists) {
			db.exec(`
				CREATE VIRTUAL TABLE search_index USING fts5(
					content,
					session_id UNINDEXED,
					source_type UNINDEXED,
					source_id UNINDEXED
				);
			`);
		}

		if (currentVersion >= 1 && currentVersion < 2) {
			db.exec('ALTER TABLE sessions ADD COLUMN host_type TEXT');
		}
		if (currentVersion >= 1 && currentVersion < 3) {
			db.exec('ALTER TABLE sessions ADD COLUMN agent_name TEXT');
			db.exec('ALTER TABLE sessions ADD COLUMN agent_description TEXT');
		}

		if (currentVersion === 0) {
			db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
		} else {
			db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
		}
	}


	upsertSession(session: SessionRow): void {
		const db = this.ensureDb();
		db.prepare(
			`INSERT INTO sessions (id, cwd, repository, host_type, branch, summary, agent_name, agent_description, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
				cwd = COALESCE(excluded.cwd, cwd),
				repository = COALESCE(excluded.repository, repository),
				host_type = COALESCE(excluded.host_type, host_type),
				branch = COALESCE(excluded.branch, branch),
				summary = COALESCE(excluded.summary, summary),
				agent_name = COALESCE(excluded.agent_name, agent_name),
				agent_description = COALESCE(excluded.agent_description, agent_description),
				created_at = MIN(created_at, excluded.created_at),
				updated_at = MAX(updated_at, excluded.updated_at)`,
		).run(
			session.id,
			session.cwd ?? null,
			session.repository ?? null,
			session.host_type ?? null,
			session.branch ?? null,
			session.summary ?? null,
			session.agent_name ?? null,
			session.agent_description ?? null,
			session.created_at ?? new Date().toISOString(),
			session.updated_at ?? new Date().toISOString(),
		);
	}

	insertTurn(turn: TurnRow): void {
		const db = this.ensureDb();

		db.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run(turn.session_id);

		db.prepare(
			`INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(session_id, turn_index) DO UPDATE SET
				user_message = COALESCE(excluded.user_message, user_message),
				assistant_response = COALESCE(excluded.assistant_response, assistant_response)`,
		).run(
			turn.session_id,
			turn.turn_index,
			turn.user_message ?? null,
			turn.assistant_response ?? null,
			turn.timestamp ?? new Date().toISOString(),
		);

		const content = [turn.user_message, turn.assistant_response].filter(Boolean).join('\n');
		if (content) {
			const turnId = `${turn.session_id}:turn:${turn.turn_index}`;
			db.prepare('DELETE FROM search_index WHERE source_id = ?').run(turnId);
			db.prepare(
				'INSERT INTO search_index (content, session_id, source_type, source_id) VALUES (?, ?, ?, ?)',
			).run(content, turn.session_id, 'turn', turnId);
		}
	}

	insertCheckpoint(checkpoint: CheckpointRow): void {
		const db = this.ensureDb();

		db.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run(checkpoint.session_id);

		db.prepare(
			`INSERT INTO checkpoints (session_id, checkpoint_number, title, overview, history, work_done, technical_details, important_files, next_steps, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(session_id, checkpoint_number) DO UPDATE SET
				title = COALESCE(excluded.title, title),
				overview = COALESCE(excluded.overview, overview),
				history = COALESCE(excluded.history, history),
				work_done = COALESCE(excluded.work_done, work_done),
				technical_details = COALESCE(excluded.technical_details, technical_details),
				important_files = COALESCE(excluded.important_files, important_files),
				next_steps = COALESCE(excluded.next_steps, next_steps)`,
		).run(
			checkpoint.session_id,
			checkpoint.checkpoint_number,
			checkpoint.title ?? null,
			checkpoint.overview ?? null,
			checkpoint.history ?? null,
			checkpoint.work_done ?? null,
			checkpoint.technical_details ?? null,
			checkpoint.important_files ?? null,
			checkpoint.next_steps ?? null,
			checkpoint.created_at ?? new Date().toISOString(),
		);

		const sections: [string, string | undefined][] = [
			['checkpoint_overview', checkpoint.overview],
			['checkpoint_history', checkpoint.history],
			['checkpoint_work_done', checkpoint.work_done],
			['checkpoint_technical', checkpoint.technical_details],
			['checkpoint_files', checkpoint.important_files],
			['checkpoint_next_steps', checkpoint.next_steps],
		];

		for (const [sourceType, content] of sections) {
			if (!content) { continue; }
			const sourceId = `${checkpoint.session_id}:ckpt:${checkpoint.checkpoint_number}:${sourceType}`;
			db.prepare('DELETE FROM search_index WHERE source_id = ?').run(sourceId);
			db.prepare(
				'INSERT INTO search_index (content, session_id, source_type, source_id) VALUES (?, ?, ?, ?)',
			).run(content, checkpoint.session_id, sourceType, sourceId);
		}
	}

	insertFile(file: FileRow): void {
		const db = this.ensureDb();
		db.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run(file.session_id);
		db.prepare(
			`INSERT OR IGNORE INTO session_files (session_id, file_path, tool_name, turn_index, first_seen_at)
			 VALUES (?, ?, ?, ?, ?)`,
		).run(
			file.session_id,
			file.file_path,
			file.tool_name ?? null,
			file.turn_index ?? null,
			file.first_seen_at ?? new Date().toISOString(),
		);
	}

	insertRef(ref: RefRow): void {
		const db = this.ensureDb();
		db.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').run(ref.session_id);
		db.prepare(
			`INSERT OR IGNORE INTO session_refs (session_id, ref_type, ref_value, turn_index, created_at)
			 VALUES (?, ?, ?, ?, ?)`,
		).run(
			ref.session_id,
			ref.ref_type,
			ref.ref_value,
			ref.turn_index ?? null,
			ref.created_at ?? new Date().toISOString(),
		);
	}


	indexWorkspaceArtifact(sessionId: string, filePath: string, content: string): void {
		if (!content.trim()) { return; }
		const db = this.ensureDb();
		const sourceId = `${sessionId}:workspace:${filePath}`;
		db.prepare('DELETE FROM search_index WHERE source_id = ?').run(sourceId);
		db.prepare('INSERT INTO search_index (content, session_id, source_type, source_id) VALUES (?, ?, ?, ?)').run(
			content,
			sessionId,
			'workspace_artifact',
			sourceId,
		);
	}

	deleteSession(sessionId: string): void {
		const db = this.ensureDb();
		this.runInTransaction(() => {
			db.prepare('DELETE FROM search_index WHERE session_id = ?').run(sessionId);
			db.prepare('DELETE FROM session_refs WHERE session_id = ?').run(sessionId);
			db.prepare('DELETE FROM session_files WHERE session_id = ?').run(sessionId);
			db.prepare('DELETE FROM checkpoints WHERE session_id = ?').run(sessionId);
			db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId);
			db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
		});
	}

	search(query: string, limit: number = 20): SearchResult[] {
		const db = this.ensureDb();
		const stmt = db.prepare(`
			SELECT content, session_id, source_type, bm25(search_index) AS rank
			FROM search_index
			WHERE search_index MATCH ?
			ORDER BY rank
			LIMIT ?
		`);
		return stmt.all(query, limit) as unknown as SearchResult[];
	}

	getSession(sessionId: string): SessionRow | undefined {
		const db = this.ensureDb();
		return db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as unknown as SessionRow | undefined;
	}

	getTurns(sessionId: string): TurnRow[] {
		const db = this.ensureDb();
		return db
			.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY turn_index')
			.all(sessionId) as unknown as TurnRow[];
	}

	getFiles(sessionId: string): FileRow[] {
		const db = this.ensureDb();
		return db.prepare('SELECT * FROM session_files WHERE session_id = ?').all(sessionId) as unknown as FileRow[];
	}

	getRefs(sessionId: string): RefRow[] {
		const db = this.ensureDb();
		return db.prepare('SELECT * FROM session_refs WHERE session_id = ?').all(sessionId) as unknown as RefRow[];
	}

	executeReadOnly(sql: string): Record<string, unknown>[] {
		const db = this.ensureDb();

		const hasAuthorizer = typeof (db as DatabaseSync & { setAuthorizer?: unknown }).setAuthorizer === 'function';

		if (hasAuthorizer) {
			(db as DatabaseSync & { setAuthorizer: (cb: ((actionCode: number, p1: string | null) => number) | null) => void }).setAuthorizer((actionCode: number, p1: string | null) => {
				if (actionCode === SQLITE_FUNCTION && p1 && DENIED_FUNCTIONS.has(p1.toLowerCase())) {
					return SQLITE_DENY;
				}
				if (READ_ONLY_ACTION_CODES.has(actionCode)) {
					return SQLITE_OK;
				}
				if (actionCode === SQLITE_PRAGMA && p1 === 'data_version') {
					return SQLITE_OK;
				}
				return SQLITE_DENY;
			});
		}

		try {
			return db.prepare(sql).all() as Record<string, unknown>[];
		} finally {
			if (hasAuthorizer) {
				(db as DatabaseSync & { setAuthorizer: (cb: null) => void }).setAuthorizer(null);
			}
		}
	}

	executeReadOnlyFallback(sql: string): Record<string, unknown>[] {
		const db = this.ensureDb();
		return db.prepare(sql).all() as Record<string, unknown>[];
	}

	getMaxTurnIndex(sessionId: string): number {
		const db = this.ensureDb();
		const row = db
			.prepare('SELECT MAX(turn_index) as max_idx FROM turns WHERE session_id = ?')
			.get(sessionId) as unknown as { max_idx: number | null } | undefined;
		return row?.max_idx ?? -1;
	}

	getStats(): { sessions: number; turns: number; checkpoints: number; files: number; refs: number } {
		const db = this.ensureDb();
		const count = (table: string) =>
			(db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as unknown as { c: number }).c;
		return {
			sessions: count('sessions'),
			turns: count('turns'),
			checkpoints: count('checkpoints'),
			files: count('session_files'),
			refs: count('session_refs'),
		};
	}

	runInTransaction(fn: () => void): void {
		const db = this.ensureDb();
		db.exec('BEGIN');
		try {
			fn();
			db.exec('COMMIT');
		} catch (err) {
			this.rollbackQuietly(db);
			throw err;
		}
	}

	private rollbackQuietly(db: DatabaseSync): void {
		try {
			db.exec('ROLLBACK');
		} catch {
		}
	}

	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}
