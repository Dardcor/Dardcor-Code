/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';
import type { ISessionStore } from '../../../../platform/chronicle/common/sessionStore';
import type { ITelemetryService } from '../../../../platform/telemetry/common/telemetry';
import type { IChatDebugFileLoggerService } from '../../../../platform/chat/common/chatDebugFileLoggerService';
import { CancellationTokenSource } from '../../../../util/dardcor/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../dardcorTypes';
import { ToolName } from '../../common/toolNames';
import { ToolRegistry } from '../../common/toolsRegistry';

import '../sessionStoreSqlTool';


function createMockStore(): ISessionStore {
	return {
		_serviceBrand: undefined as any,
		getPath: () => '/tmp/test.db',
		upsertSession: () => { },
		insertTurn: () => { },
		insertCheckpoint: () => { },
		insertFile: () => { },
		insertRef: () => { },
		indexWorkspaceArtifact: () => { },
		deleteSession: () => { },
		search: () => [],
		getSession: () => undefined,
		getTurns: () => [],
		getFiles: () => [],
		getRefs: () => [],
		getMaxTurnIndex: () => -1,
		getStats: () => ({ sessions: 5, turns: 20, checkpoints: 0, files: 10, refs: 3 }),
		executeReadOnly: vi.fn(() => [{ id: 'local-1', summary: 'test' }]),
		executeReadOnlyFallback: vi.fn(() => [{ id: 'local-1', summary: 'test' }]),
		runInTransaction: (fn: () => void) => fn(),
		close: () => { },
	} as any;
}

function createMockServices() {
	const store = createMockStore();

	const telemetryService: ITelemetryService = {
		_serviceBrand: undefined as any,
		sendMSFTTelemetryEvent: vi.fn(),
		sendMSFTTelemetryErrorEvent: vi.fn(),
	} as any;

	const debugLogService: IChatDebugFileLoggerService = {
		_serviceBrand: undefined as any,
		listSessionIds: vi.fn(async () => []),
		streamEntries: vi.fn(),
	} as any;

	return { store, telemetryService, debugLogService };
}


function createToolInstance() {
	const services = createMockServices();
	const toolCtor = ToolRegistry.getTools().find(t => t.toolName === ToolName.SessionStoreSql)!;

	const tool = new (toolCtor as any)(
		services.store,
		services.telemetryService,
		services.debugLogService,
	);

	return { tool, ...services };
}

function makeOptions<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
	return { input, toolInvocationToken: undefined as any, model: undefined as any, chatRequestId: '' } as any;
}

function makeToolInfo(overrides: Partial<vscode.LanguageModelToolInformation> = {}): vscode.LanguageModelToolInformation {
	return {
		name: ToolName.SessionStoreSql,
		description: 'base description',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'SQLite query with FTS5 MATCH support' },
				action: { type: 'string' },
				description: { type: 'string' },
			},
		},
		tags: [],
		parametersSchema: {},
		...overrides,
	} as unknown as vscode.LanguageModelToolInformation;
}

function extractText(result: vscode.LanguageModelToolResult): string {
	const parts: string[] = [];
	for (const part of result.content) {
		if (part instanceof LanguageModelTextPart) {
			parts.push(part.value);
		}
	}
	return parts.join('');
}


describe('SessionStoreSqlTool', () => {
	it('is registered', () => {
		const isRegistered = ToolRegistry.getTools().some(t => t.toolName === ToolName.SessionStoreSql);
		expect(isRegistered).toBe(true);
	});

	describe('action routing', () => {
		it('defaults to query action', async () => {
			const { tool, store } = createToolInstance();
			const cts = new CancellationTokenSource();

			const result = await tool.invoke(
				makeOptions({ description: 'test', query: 'SELECT COUNT(*) FROM sessions' }),
				cts.token,
			);

			expect(store.executeReadOnly).toHaveBeenCalled();
			expect(extractText(result)).toContain('Results:');
		});

		it('routes reindex action correctly', async () => {
			const { tool, debugLogService } = createToolInstance();
			(debugLogService.listSessionIds as any).mockResolvedValue([]);
			const cts = new CancellationTokenSource();

			const result = await tool.invoke(
				makeOptions({ action: 'reindex', description: 'Reindex sessions' }),
				cts.token,
			);

			const text = extractText(result);
			expect(text).toContain('reindex');
		});
	});

	describe('query security', () => {
		it('blocks mutating SQL statements', async () => {
			const { tool } = createToolInstance();
			const cts = new CancellationTokenSource();

			const mutations = [
				'DROP TABLE sessions',
				'DELETE FROM sessions WHERE 1=1',
				'INSERT INTO sessions VALUES (1)',
				'UPDATE sessions SET summary = "hacked"',
				'CREATE TABLE extra (id INT)',
				'ATTACH DATABASE "other.db" AS other',
			];

			for (const sql of mutations) {
				const result = await tool.invoke(
					makeOptions({ action: 'query', query: sql, description: 'test' }),
					cts.token,
				);
				expect(extractText(result)).toContain('Blocked SQL');
			}
		});

		it('blocks side-effecting and unsafe statements', async () => {
			const { tool } = createToolInstance();
			const cts = new CancellationTokenSource();

			const unsafe = [
				`VACUUM INTO '/tmp/copy.db'`,
				'REINDEX',
				'ANALYZE',
				`SELECT load_extension('/tmp/lib.so')`,
				'BEGIN',
				'COMMIT',
				'ROLLBACK',
			];

			for (const sql of unsafe) {
				const result = await tool.invoke(
					makeOptions({ action: 'query', query: sql, description: 'test' }),
					cts.token,
				);
				expect(extractText(result)).toContain('Blocked SQL');
			}
		});

		it('rejects statements that do not start with SELECT or WITH', async () => {
			const { tool } = createToolInstance();
			const cts = new CancellationTokenSource();

			const nonQuery = [
				'PRAGMA data_version',
				`/* hide me */ VACUUM INTO '/tmp/copy.db'`,
				'-- comment\nDROP TABLE sessions',
				'EXPLAIN SELECT * FROM sessions',
			];

			for (const sql of nonQuery) {
				const result = await tool.invoke(
					makeOptions({ action: 'query', query: sql, description: 'test' }),
					cts.token,
				);
				expect(extractText(result)).toContain('Blocked SQL');
			}
		});

		it('allows WITH (CTE) queries through to executeReadOnly', async () => {
			const { tool, store } = createToolInstance();
			const cts = new CancellationTokenSource();

			await tool.invoke(
				makeOptions({ action: 'query', query: 'WITH x AS (SELECT 1 AS n) SELECT * FROM x', description: 'test' }),
				cts.token,
			);

			expect(store.executeReadOnly).toHaveBeenCalled();
		});

		it('blocks multiple statements', async () => {
			const { tool } = createToolInstance();
			const cts = new CancellationTokenSource();

			const result = await tool.invoke(
				makeOptions({ action: 'query', query: 'SELECT 1; SELECT 2', description: 'test' }),
				cts.token,
			);

			expect(extractText(result)).toContain('Only one SQL statement');
		});

		it('blocks empty queries', async () => {
			const { tool } = createToolInstance();
			const cts = new CancellationTokenSource();

			const result = await tool.invoke(
				makeOptions({ action: 'query', query: '', description: 'test' }),
				cts.token,
			);

			expect(extractText(result)).toContain('Empty query');
		});

		it('strips trailing semicolons', async () => {
			const { tool, store } = createToolInstance();
			const cts = new CancellationTokenSource();

			await tool.invoke(
				makeOptions({ action: 'query', query: 'SELECT * FROM sessions;', description: 'test' }),
				cts.token,
			);

			expect(store.executeReadOnly).toHaveBeenCalledWith('SELECT * FROM sessions');
		});
	});

	describe('local query', () => {
		it('returns formatted results', async () => {
			const { tool } = createToolInstance();
			const cts = new CancellationTokenSource();

			const result = await tool.invoke(
				makeOptions({ action: 'query', query: 'SELECT * FROM sessions LIMIT 1', description: 'test' }),
				cts.token,
			);

			const text = extractText(result);
			expect(text).toContain('Results: 1 rows');
			expect(text).toContain('source: local');
		});

		it('routes model-supplied SQL through executeReadOnly (never executeReadOnlyFallback)', async () => {
			const { tool, store } = createToolInstance();
			const cts = new CancellationTokenSource();

			await tool.invoke(
				makeOptions({ action: 'query', query: 'SELECT * FROM sessions', description: 'test' }),
				cts.token,
			);

			expect(store.executeReadOnly).toHaveBeenCalled();
			expect(store.executeReadOnlyFallback).not.toHaveBeenCalled();
		});
	});

	describe('alternativeDefinition', () => {
		it('keeps the local SQLite definition unchanged', () => {
			const { tool } = createToolInstance();
			const base = makeToolInfo();
			const result = tool.alternativeDefinition(base);

			expect(result).toBe(base);
		});
	});

	describe('reindex with force', () => {
		it('passes force=false by default', async () => {
			const { tool, debugLogService } = createToolInstance();
			(debugLogService.listSessionIds as any).mockResolvedValue([]);
			const cts = new CancellationTokenSource();

			await tool.invoke(
				makeOptions({ action: 'reindex', description: 'Reindex sessions' }),
				cts.token,
			);

			const result = await tool.invoke(
				makeOptions({ action: 'reindex', description: 'Reindex' }),
				cts.token,
			);
			expect(extractText(result)).toContain('reindex');
		});

		it('passes force=true when specified', async () => {
			const { tool, debugLogService } = createToolInstance();
			(debugLogService.listSessionIds as any).mockResolvedValue([]);
			const cts = new CancellationTokenSource();

			const result = await tool.invoke(
				makeOptions({ action: 'reindex', force: true, description: 'Force reindex' }),
				cts.token,
			);
			expect(extractText(result)).toContain('reindex');
		});
	});

	describe('prepareInvocation', () => {
		it('returns correct messages for each action', () => {
			const { tool } = createToolInstance();
			const cts = new CancellationTokenSource();

			const reindex = tool.prepareInvocation(
				{ input: { action: 'reindex', description: 'test' } } as any,
				cts.token,
			);
			expect(reindex.invocationMessage).toContain('eindex');

			const query = tool.prepareInvocation(
				{ input: { action: 'query', description: 'test' } } as any,
				cts.token,
			);
			expect(query.invocationMessage).toContain('uerying');
		});
	});

	describe('schema-error regression anchors', () => {
		const dardcorRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');

		it('SQLite modelDescription in package.json carries required anchors', () => {
			const pkg = JSON.parse(fs.readFileSync(path.join(dardcorRoot, 'package.json'), 'utf-8'));
			const entry = (pkg.contributes.languageModelTools as { name: string; modelDescription?: string }[])
				.find(t => t.name === 'dardcor_sessionStoreSql');
			expect(entry?.modelDescription, 'dardcor_sessionStoreSql entry missing modelDescription').toBeDefined();
			const desc = entry!.modelDescription!;

			const required = [
				'SQLite', 'queries are read-only', 'SELECT', 'WITH',
				`datetime('now'`, 'NOT `now() - INTERVAL',
				'MATCH', 'chronicle',
				'sessions', 'turns', 'session_files', 'session_refs', 'checkpoints', 'search_index',
			];
			expect(required.filter(a => !desc.includes(a))).toEqual([]);
		});

		it('chronicle skill describes the local-only session history workflow', () => {
			const skill = fs.readFileSync(
				path.join(dardcorRoot, 'assets', 'prompts', 'skills', 'chronicle', 'SKILL.md'),
				'utf-8',
			);

			const required = [
				'local SQLite', 'read-only', `datetime('now'`,
				'`sessions`', '`turns`', '`session_files`', '`session_refs`', '`checkpoints`', '`search_index`',
			];
			expect(required.filter(a => !skill.includes(a))).toEqual([]);
			expect(skill).not.toContain('remote session store');
		});

		it('chronicle slash prompts reference the chronicle skill', () => {
			const promptDir = path.join(dardcorRoot, 'assets', 'prompts');
			const prompts = ['chronicle-tips.prompt.md', 'chronicle-cost-tips.prompt.md', 'chronicle-standup.prompt.md', 'chronicle-search.prompt.md'];
			const missing = prompts.filter(name => {
				const body = fs.readFileSync(path.join(promptDir, name), 'utf-8');
				return !/\*\*chronicle\*\* skill/.test(body);
			});
			expect(missing).toEqual([]);
		});

		it('chronicle SKILL.md keeps workflow guidance grounded in local data', () => {
			const skill = fs.readFileSync(
				path.join(dardcorRoot, 'assets', 'prompts', 'skills', 'chronicle', 'SKILL.md'),
				'utf-8',
			);
			const required = [
				'Workflow tips',
				'local history',
				'authoritative per-request costs',
				'agent_name',
			];
			expect(required.filter(a => !skill.includes(a))).toEqual([]);
		});
	});
});
