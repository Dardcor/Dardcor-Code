/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { ThinkingData } from '../../../../../../platform/thinking/common/thinking';
import { IBuildPromptContext, IToolCall, IToolCallRound } from '../../../../../prompt/common/intents';
import { ToolName } from '../../../../../tools/common/toolNames';
import { BackgroundTodoAgentSessionHistoryStore } from '../backgroundTodoAgentSessionHistoryStore';

function call(name: string, args: Record<string, unknown> | string = {}, id?: string): IToolCall {
	return {
		name,
		arguments: typeof args === 'string' ? args : JSON.stringify(args),
		id: id ?? `tc-${name}-${Math.random().toString(36).slice(2, 8)}`,
	};
}

function round(id: string, toolCalls: IToolCall[], response = '', thinking?: ThinkingData): IToolCallRound {
	return { id, response, toolInputRetry: 0, toolCalls, thinking };
}

function thinking(text: string | string[]): ThinkingData {
	return { id: `${text}`, text };
}

function ctx(query: string, toolCallRounds: IToolCallRound[]): IBuildPromptContext {
	return { query, toolCallRounds } as unknown as IBuildPromptContext;
}

describe('BackgroundTodoAgentSessionHistoryStore', () => {

	test('tracks rounds with a global index, filters excluded tools, and dedupes by round id', () => {
		const store = new BackgroundTodoAgentSessionHistoryStore();
		const r1 = round('r1', [call(ToolName.ReadFile, { filePath: 'a.ts' })], 'read a');
		const r2 = round('r2', [call(ToolName.ReplaceString, { filePath: 'a.ts' })], 'edited a');
		store.trackPromptContext('turn-1', ctx('do it', [r1, r2]));

		const r3 = round('r3', [call(ToolName.CreateFile, { filePath: 'b.ts' }), call(ToolName.ReadFile, { filePath: 'b.ts' })], 'made b');
		store.trackPromptContext('turn-1', ctx('do it', [r1, r2, r3]));

		const history = store.getTurnHistory('turn-1');
		expect({
			old: history?.old.map(r => r.id),
			new: history?.new.map(r => ({ id: r.id, index: r.index, toolCalls: r.toolCalls, response: r.response })),
			unprocessedSubstantiveRoundCount: history?.unprocessedSubstantiveRoundCount,
		}).toEqual({
			old: [],
			new: [
				{ id: 'r1', index: 0, toolCalls: [], response: 'read a' },
				{ id: 'r2', index: 1, toolCalls: [{ name: ToolName.ReplaceString, arguments: '{"filePath":"a.ts"}' }], response: 'edited a' },
				{ id: 'r3', index: 2, toolCalls: [{ name: ToolName.CreateFile, arguments: '{"filePath":"b.ts"}' }], response: 'made b' },
			],
			unprocessedSubstantiveRoundCount: 2,
		});
	});

	test('a round with several substantive tool calls counts as a single substantive round', () => {
		const store = new BackgroundTodoAgentSessionHistoryStore();
		const r1 = round('r1', [
			call(ToolName.ReplaceString, { filePath: 'a.ts' }),
			call(ToolName.CreateFile, { filePath: 'b.ts' }),
			call(ToolName.ReadFile, { filePath: 'c.ts' }),
		], 'multi');
		store.trackPromptContext('turn-1', ctx('go', [r1]));

		const history = store.getTurnHistory('turn-1')!;
		expect({
			unprocessedSubstantiveRoundCount: history.unprocessedSubstantiveRoundCount,
			storedToolNames: history.new[0].toolCalls.map(t => t.name),
		}).toEqual({
			unprocessedSubstantiveRoundCount: 1,
			storedToolNames: [ToolName.ReplaceString, ToolName.CreateFile],
		});
	});

	test('marking rounds processed moves them to old and decrements only for substantive rounds', () => {
		const store = new BackgroundTodoAgentSessionHistoryStore();
		const r1 = round('r1', [call(ToolName.ReplaceString, { filePath: 'a.ts' })], 'a');
		const r2 = round('r2', [call(ToolName.ReadFile, { filePath: 'b.ts' })], 'b');
		const r3 = round('r3', [call(ToolName.CreateFile, { filePath: 'c.ts' })], 'c');
		store.trackPromptContext('turn-1', ctx('go', [r1, r2, r3]));

		const before = store.getTurnHistory('turn-1')!;
		store.markToolCallsAsProcessed('turn-1', before.new.filter(r => r.id === 'r1' || r.id === 'r2'));

		const after = store.getTurnHistory('turn-1')!;
		expect({
			old: after.old.map(r => r.id),
			new: after.new.map(r => r.id),
			unprocessedSubstantiveRoundCount: after.unprocessedSubstantiveRoundCount,
		}).toEqual({
			old: ['r1', 'r2'],
			new: ['r3'],
			unprocessedSubstantiveRoundCount: 1,
		});
	});

	test('normalizes thinking text and truncates tool-call arguments', () => {
		const store = new BackgroundTodoAgentSessionHistoryStore();
		const longArgs = 'x'.repeat(500);
		const r1 = round('r1', [call(ToolName.ReplaceString, `  ${longArgs}  `)], 'resp', thinking('  string thought  '));
		const longThought = Array.from({ length: 50 }, (_, i) => `thought-line-${i}`);
		const r2 = round('r2', [call(ToolName.EditFile, { filePath: 'a.ts' })], 'resp2', thinking(longThought));
		store.trackPromptContext('turn-1', ctx('go', [r1, r2]));

		const history = store.getTurnHistory('turn-1')!;
		expect(history.new.map(r => ({ id: r.id, thinking: r.thinking, args: r.toolCalls[0].arguments }))).toEqual([
			{ id: 'r1', thinking: 'string thought', args: 'x'.repeat(200) },
			{ id: 'r2', thinking: longThought.join('\n').slice(0, 400), args: '{"filePath":"a.ts"}' },
		]);
	});

	test('returns undefined for an unknown turn and isolates history per turn', () => {
		const store = new BackgroundTodoAgentSessionHistoryStore();
		store.trackPromptContext('turn-1', ctx('a', [round('r1', [call(ToolName.ReplaceString)])]));
		store.trackPromptContext('turn-2', ctx('b', [round('r2', [call(ToolName.CreateFile)])]));
		expect({
			unknown: store.getTurnHistory('nope'),
			turn1: store.getTurnHistory('turn-1')?.new.map(r => r.id),
			turn2: store.getTurnHistory('turn-2')?.new.map(r => r.id),
		}).toEqual({
			unknown: undefined,
			turn1: ['r1'],
			turn2: ['r2'],
		});
	});
});
