/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';


export const ISessionStore = createServiceIdentifier<ISessionStore>('ISessionStore');

export interface SessionStoreOptions {
	readonly remote?: boolean;
}


export interface SessionRow {
	id: string;
	cwd?: string;
	repository?: string;
	host_type?: string;
	branch?: string;
	summary?: string;
	agent_name?: string;
	agent_description?: string;
	created_at?: string;
	updated_at?: string;
}

export interface TurnRow {
	session_id: string;
	turn_index: number;
	user_message?: string;
	assistant_response?: string;
	timestamp?: string;
}

export interface CheckpointRow {
	session_id: string;
	checkpoint_number: number;
	title?: string;
	overview?: string;
	history?: string;
	work_done?: string;
	technical_details?: string;
	important_files?: string;
	next_steps?: string;
	created_at?: string;
}

export interface FileRow {
	session_id: string;
	file_path: string;
	tool_name?: string;
	turn_index?: number;
	first_seen_at?: string;
}

export interface RefRow {
	session_id: string;
	ref_type: 'commit' | 'pr' | 'issue';
	ref_value: string;
	turn_index?: number;
	created_at?: string;
}

export interface SearchResult {
	session_id: string;
	source_type: string;
	content: string;
	rank: number;
}


export interface ISessionStore {
	readonly _serviceBrand: undefined;

	getPath(): string;


	upsertSession(session: SessionRow): void;

	insertTurn(turn: TurnRow): void;

	insertCheckpoint(checkpoint: CheckpointRow): void;

	insertFile(file: FileRow): void;

	insertRef(ref: RefRow): void;

	indexWorkspaceArtifact(sessionId: string, filePath: string, content: string): void;

	deleteSession(sessionId: string): void;


	search(query: string, limit?: number): SearchResult[];

	getSession(sessionId: string): SessionRow | undefined;

	getTurns(sessionId: string): TurnRow[];

	getFiles(sessionId: string): FileRow[];

	getRefs(sessionId: string): RefRow[];

	getMaxTurnIndex(sessionId: string): number;

	getStats(): { sessions: number; turns: number; checkpoints: number; files: number; refs: number };

	executeReadOnly(sql: string): Record<string, unknown>[];

	executeReadOnlyFallback(sql: string): Record<string, unknown>[];

	runInTransaction(fn: () => void): void;

	close(): void;
}
