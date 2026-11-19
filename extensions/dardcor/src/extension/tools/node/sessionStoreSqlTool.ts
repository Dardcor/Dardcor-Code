/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IChatDebugFileLoggerService } from '../../../platform/chat/common/chatDebugFileLoggerService';
import { ISessionStore } from '../../../platform/chronicle/common/sessionStore';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../dardcorTypes';
import { reindexSessions } from '../../chronicle/node/sessionReindexer';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { ToolName } from '../common/toolNames';
import { IAgentTool, ToolRegistry } from '../common/toolsRegistry';

const MAX_ROWS = 100;

const BLOCKED_PATTERNS = [
	/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE)\b/i,
	/\bATTACH\b/i,
	/\bDETACH\b/i,
	/\bPRAGMA\b(?!\s+data_version)/i,
	/\bVACUUM\b/i,
	/\bREINDEX\b/i,
	/\bANALYZE\b/i,
	/\bLOAD_EXTENSION\b/i,
	/\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i,
];

function stripLeadingCommentsAndWhitespace(sql: string): string {
	let s = sql;
	let prev: string;
	do {
		prev = s;
		s = s.replace(/^\s+/, '');
		s = s.replace(/^--[^\n]*\n?/, '');
		s = s.replace(/^\/\*[\s\S]*?\*\//, '');
	} while (s !== prev);
	return s;
}

export interface SessionStoreSqlParams {
	readonly action?: 'query' | 'reindex';
	readonly query?: string;
	readonly force?: boolean;
	readonly description: string;
	readonly subcommand?: 'standup' | 'tips' | 'cost-tips' | 'search' | 'improve' | 'reindex';
}

class SessionStoreSqlTool implements IAgentTool<SessionStoreSqlParams> {
	public static readonly toolName = ToolName.SessionStoreSql;
	public static readonly nonDeferred = true;

	constructor(
		@ISessionStore private readonly _sessionStore: ISessionStore,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IChatDebugFileLoggerService private readonly _debugLogService: IChatDebugFileLoggerService,
	) { }

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<SessionStoreSqlParams>,
		token: CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const action = options.input.action ?? 'query';
		const subcommand = options.input.subcommand;

		switch (action) {
			case 'reindex':
				return this._invokeReindex(options.input.force ?? false, subcommand ?? 'reindex', token);
			default:
				return this._invokeQuery(options.input.query ?? '', subcommand, token);
		}
	}
	private async _invokeQuery(rawQuery: string, subcommand: SessionStoreSqlParams['subcommand'], _token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const sql = rawQuery.trim().replace(/;+\s*$/, '');

		if (!sql) {
			return new LanguageModelToolResult([new LanguageModelTextPart('Error: Empty query provided.')]);
		}

		for (const pattern of BLOCKED_PATTERNS) {
			if (pattern.test(sql)) {
				this._sendTelemetry({ command: 'query', subcommand, target: 'local', blocked: true, rowCount: 0, durationMs: 0, success: false, error: 'blocked_mutating_sql' });
				return new LanguageModelToolResult([
					new LanguageModelTextPart('Error: Blocked SQL statement. Only SELECT or WITH queries are allowed.'),
				]);
			}
		}

		const firstKeywordSrc = stripLeadingCommentsAndWhitespace(sql);
		if (!/^(SELECT|WITH)\b/i.test(firstKeywordSrc)) {
			this._sendTelemetry({ command: 'query', subcommand, target: 'local', blocked: true, rowCount: 0, durationMs: 0, success: false, error: 'blocked_not_select_or_with' });
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: Blocked SQL statement. Only SELECT or WITH queries are allowed.'),
			]);
		}

		if (sql.includes(';')) {
			this._sendTelemetry({ command: 'query', subcommand, target: 'local', blocked: true, rowCount: 0, durationMs: 0, success: false, error: 'multiple_statements' });
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: Only one SQL statement per call. Remove semicolons and split into separate calls.'),
			]);
		}

		const startTime = Date.now();
		const source = 'local';
		const target = 'local' as const;

		try {
			let truncated = false;
			let rows = this._executeLocal(sql);

			if (rows.length > MAX_ROWS) {
				rows = rows.slice(0, MAX_ROWS);
				truncated = true;
			}

			this._sendTelemetry({ command: 'query', subcommand, target, rowCount: rows.length, durationMs: Date.now() - startTime, success: true });

			const result = formatSqlResult(rows, truncated, source);
			return new LanguageModelToolResult([new LanguageModelTextPart(result)]);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._sendTelemetry({ command: 'query', subcommand, target, rowCount: 0, durationMs: Date.now() - startTime, success: false, error: message.substring(0, 100) });
			return new LanguageModelToolResult([new LanguageModelTextPart(`Error: ${message}`)]);
		}
	}

	private _executeLocal(sql: string): Record<string, unknown>[] {
		return this._sessionStore.executeReadOnly(sql);
	}

	private async _invokeReindex(force: boolean, subcommand: NonNullable<SessionStoreSqlParams['subcommand']>, token: CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const startTime = Date.now();
		const target = 'local' as const;

		try {
			const statsBefore = this._sessionStore.getStats();

			const result = await reindexSessions(
				this._sessionStore,
				this._debugLogService,
				() => { },
				token,
				force,
			);

			const statsAfter = this._sessionStore.getStats();

			const lines: string[] = [];
			if (result.cancelled) {
				lines.push('Reindex cancelled.');
			} else {
				lines.push('Local reindex complete.');
			}

			lines.push('');
			lines.push('| | Before | After | Delta |');
			lines.push('|---|---|---|---|');
			lines.push(`| Sessions | ${statsBefore.sessions} | ${statsAfter.sessions} | +${statsAfter.sessions - statsBefore.sessions} |`);
			lines.push(`| Turns | ${statsBefore.turns} | ${statsAfter.turns} | +${statsAfter.turns - statsBefore.turns} |`);
			lines.push(`| Files | ${statsBefore.files} | ${statsAfter.files} | +${statsAfter.files - statsBefore.files} |`);
			lines.push(`| Refs | ${statsBefore.refs} | ${statsAfter.refs} | +${statsAfter.refs - statsBefore.refs} |`);
			lines.push('');
			lines.push(`${result.processed} session(s) processed, ${result.skipped} skipped.`);

			this._sendTelemetry({ command: 'reindex', subcommand, target, rowCount: result.processed, durationMs: Date.now() - startTime, success: true });
			return new LanguageModelToolResult([new LanguageModelTextPart(lines.join('\n'))]);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._sendTelemetry({ command: 'reindex', subcommand, target, rowCount: 0, durationMs: Date.now() - startTime, success: false, error: message.substring(0, 100) });
			return new LanguageModelToolResult([new LanguageModelTextPart(`Error during reindex: ${message}`)]);
		}
	}

	private _sendTelemetry(args: {
		command: 'query' | 'reindex';
		subcommand?: SessionStoreSqlParams['subcommand'];
		target: 'local';
		blocked?: boolean;
		rowCount: number;
		durationMs: number;
		success: boolean;
		error?: string;
	}): void {
		const { command, subcommand, target, blocked, rowCount, durationMs, success, error } = args;
		const source = blocked ? 'blocked' : command === 'query' ? target : command;
		const properties = {
			command,
			subcommand: subcommand ?? 'unknown',
			target,
			source,
			success: success ? 'true' : 'false',
		};
		const measurements = { rowCount, durationMs };
		if (success) {
			this._telemetryService.sendMSFTTelemetryEvent('chronicle.sqlQuery', properties, measurements);
		} else {

			this._telemetryService.sendMSFTTelemetryErrorEvent('chronicle.sqlQuery', {
				...properties,
				error: error ?? 'unknown',
			}, measurements);
		}
	}

	prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<SessionStoreSqlParams>,
		_token: CancellationToken,
	) {
		const action = options.input.action ?? 'query';
		switch (action) {
			case 'reindex':
				return {
					invocationMessage: l10n.t('Reindexing session store'),
					pastTenseMessage: l10n.t('Reindexed session store'),
				};
			default:
				return {
					invocationMessage: l10n.t('Querying session store'),
					pastTenseMessage: l10n.t('Queried session store'),
				};
		}
	}

	alternativeDefinition(tool: vscode.LanguageModelToolInformation): vscode.LanguageModelToolInformation {
		return tool;
	}
}

const TOTAL_FORMAT_BUDGET = 30_000;

function formatSqlResult(rows: Record<string, unknown>[], truncated: boolean, source: string): string {
	if (rows.length === 0) {
		return `No results found (source: ${source}).`;
	}

	const columns = Object.keys(rows[0]);

	const cellCount = rows.length * columns.length;
	const perCellLimit = Math.floor(TOTAL_FORMAT_BUDGET / cellCount);

	const lines: string[] = [];
	lines.push(`Results: ${rows.length} rows (source: ${source})${truncated ? ' [TRUNCATED]' : ''}`);
	lines.push('');
	lines.push(`| ${columns.join(' | ')} |`);
	lines.push(`| ${columns.map(() => '---').join(' | ')} |`);
	for (const row of rows) {
		const values = columns.map(c => {
			const v = row[c];
			if (v === null || v === undefined) {
				return '';
			}
			const s = String(v);
			return s.length > perCellLimit ? s.slice(0, perCellLimit) + '...' : s;
		});
		lines.push(`| ${values.join(' | ')} |`);
	}

	if (truncated) {
		lines.push('');
		lines.push('⚠️ Results were truncated. Add a LIMIT clause or narrow your query.');
	}

	let result = lines.join('\n');

	if (result.length > TOTAL_FORMAT_BUDGET) {
		result = result.slice(0, TOTAL_FORMAT_BUDGET) + '\n\n⚠️ Output truncated to stay within context budget.';
	}

	return result;
}

ToolRegistry.registerTool(SessionStoreSqlTool);
