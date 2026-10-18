/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	compute4GramTextSimilarity,
	computeChunkedEditSurvival,
	computeChunkedFourGramSurvival,
	computeFractionPresentIn,
	computeWholeFileEditSurvival,
} from '../../../node/shared/editSurvivalTracker.js';

suite('agentHost editSurvivalTracker', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('compute4GramTextSimilarity', () => {
		test('identical strings → 1', () => {
			assert.strictEqual(compute4GramTextSimilarity('hello world', 'hello world'), 1);
		});

		test('completely different strings → low score', () => {
			const score = compute4GramTextSimilarity('aaaaaaaa', 'bbbbbbbb');
			assert.ok(score < 0.1, `expected < 0.1, got ${score}`);
		});

		test('short inputs (<4 chars) fall back to equality', () => {
			assert.strictEqual(compute4GramTextSimilarity('ab', 'ab'), 1);
			assert.strictEqual(compute4GramTextSimilarity('ab', 'cd'), 0);
		});

		test('mostly-shared text scores high', () => {
			const a = 'function greet() { return "hello"; }';
			const b = 'function greet() { return "hello!"; }';
			const score = compute4GramTextSimilarity(a, b);
			assert.ok(score > 0.85, `expected > 0.85, got ${score}`);
		});
	});

	suite('computeWholeFileEditSurvival', () => {
		test('user kept AI output verbatim → 1/1', () => {
			const before = 'old line\n';
			const after = 'new line\n';
			const scores = computeWholeFileEditSurvival(before, after, after);
			assert.strictEqual(scores.fourGram, 1);
			assert.strictEqual(scores.noRevert, 1);
		});

		test('user fully reverted to original → low fourGram, low noRevert', () => {
			const before = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n';
			const after = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n';
			const scores = computeWholeFileEditSurvival(before, after, before);
			assert.ok(scores.fourGram < 0.2, `fourGram expected < 0.2, got ${scores.fourGram}`);
			assert.strictEqual(scores.noRevert, 0);
		});

		test('user refined AI output → fourGram lower, noRevert stays at 1', () => {
			const before = 'function add(a, b) { return a + b; }\n';
			const after = 'function add(a: number, b: number): number { return a + b; }\n';
			const current = 'function add(a: number, b: number): number {\n\treturn a + b;\n}\n';
			const scores = computeWholeFileEditSurvival(before, after, current);
			assert.ok(scores.fourGram > 0.5 && scores.fourGram < 1, `fourGram expected mid-range, got ${scores.fourGram}`);
			assert.strictEqual(scores.noRevert, 1);
		});

		test('AI produced same text as before → noRevert defaults to 1', () => {
			const text = 'unchanged\n';
			const scores = computeWholeFileEditSurvival(text, text, text);
			assert.strictEqual(scores.fourGram, 1);
			assert.strictEqual(scores.noRevert, 1);
		});
	});

	suite('computeFractionPresentIn', () => {
		test('chunk fully present in current → 1', () => {
			const chunk = 'export function greet() { return "hello"; }\n';
			const file = '// header\n' + chunk + '// footer\n';
			assert.strictEqual(computeFractionPresentIn(chunk, file), 1);
		});

		test('chunk fully absent from current → 0', () => {
			const chunk = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxx\n';
			const file = 'completely unrelated content here\n';
			assert.strictEqual(computeFractionPresentIn(chunk, file), 0);
		});

		test('partial overlap → fraction between 0 and 1', () => {
			const chunk = 'function add(a, b) { return a + b; }\n';
			const file = 'function add(a, b) { return a - b; }\n';
			const score = computeFractionPresentIn(chunk, file);
			assert.ok(score > 0.5 && score < 1, `expected fraction in (0.5, 1), got ${score}`);
		});

		test('empty chunk → 1', () => {
			assert.strictEqual(computeFractionPresentIn('', 'anything'), 1);
		});

		test('chunk shorter than 4 chars falls back to substring match', () => {
			assert.strictEqual(computeFractionPresentIn('ab', 'cabd'), 1);
			assert.strictEqual(computeFractionPresentIn('ab', 'cxd'), 0);
		});

		test('immune to file growth: score stays at 1 when content is appended', () => {
			const chunk = 'export function greet() { return "hello"; }\n';
			const small = chunk;
			const big = chunk + 'x'.repeat(10_000);
			assert.strictEqual(computeFractionPresentIn(chunk, small), 1);
			assert.strictEqual(computeFractionPresentIn(chunk, big), 1);
		});
	});

	suite('computeChunkedFourGramSurvival', () => {
		test('empty chunks → 0 (caller should branch and fall back)', () => {
			assert.strictEqual(computeChunkedFourGramSurvival([], 'file'), 0);
		});

		test('multiple chunks weighted by length', () => {
			const longChunk = 'a'.repeat(200);
			const shortChunk = 'xyz9';
			const file = longChunk;
			const score = computeChunkedFourGramSurvival([longChunk, shortChunk], file);
			assert.ok(score > 0.99, `expected near 1, got ${score}`);
		});

		test('all chunks fully present → 1', () => {
			const a = 'export const x = 1;\n';
			const b = 'export const y = 2;\n';
			const file = `// header\n${a}// mid\n${b}// footer\n`;
			assert.strictEqual(computeChunkedFourGramSurvival([a, b], file), 1);
		});

		test('scales linearly with chunks: file n-gram set is built once', () => {
			const file = 'x'.repeat(500_000);
			const chunks = Array.from({ length: 50 }, (_, i) => `chunk${i}-${'x'.repeat(40)}`);
			const start = Date.now();
			const score = computeChunkedFourGramSurvival(chunks, file);
			const elapsedMs = Date.now() - start;
			assert.ok(score >= 0 && score <= 1, `score out of range: ${score}`);
			assert.ok(elapsedMs < 1000, `expected < 1000ms, took ${elapsedMs}ms`);
		});
	});

	suite('computeChunkedEditSurvival', () => {
		test('falls back to whole-file scoring when chunks are empty', () => {
			const before = 'aaaaaaaaaaaaaaaaaaaa\n';
			const after = 'bbbbbbbbbbbbbbbbbbbb\n';
			const expected = computeWholeFileEditSurvival(before, after, after);
			const actual = computeChunkedEditSurvival(before, after, [], after);
			assert.deepStrictEqual(actual, expected);
		});

		test('fourGram from chunks, noRevert still from whole-file', () => {
			const before = '// empty\n';
			const chunk = 'export function greet() { return "hello"; }\n';
			const after = before + chunk;
			const current = after + '\n// later append\n';
			const scores = computeChunkedEditSurvival(before, after, [chunk], current);
			assert.strictEqual(scores.fourGram, 1);
			assert.strictEqual(scores.noRevert, 1);
		});
	});

	suite('multi-tracker scenarios', () => {

		interface IEdit {
			readonly id: string;
			readonly before: string;
			readonly after: string;
			readonly aiChunks?: readonly string[];
		}

		function round(n: number): number {
			return Math.round(n * 100) / 100;
		}

		function simulate(edits: ReadonlyArray<IEdit>): Map<string, ReadonlyArray<string>> {
			const result = new Map<string, string[]>();
			for (let i = 0; i < edits.length; i++) {
				const edit = edits[i];
				const samples: string[] = [];
				const stream = [edit.after, ...edits.slice(i + 1).map(e => e.after)];
				for (const currentText of stream) {
					const { fourGram, noRevert } = edit.aiChunks
						? computeChunkedEditSurvival(edit.before, edit.after, edit.aiChunks, currentText)
						: computeWholeFileEditSurvival(edit.before, edit.after, currentText);
					samples.push(`${round(fourGram)}/${round(noRevert)}`);
				}
				result.set(edit.id, samples);
			}
			return result;
		}

		test('two non-overlapping additions both survive (whole-file scoring)', () => {
			const base = 'alpha\nbravo\ncharlie\n';
			const afterE1 = base + 'delta added by e1\n';
			const afterE2 = 'echo added by e2\n' + afterE1;

			const samples = simulate([
				{ id: 'e1', before: base, after: afterE1 },
				{ id: 'e2', before: afterE1, after: afterE2 },
			]);

			assert.deepStrictEqual(Object.fromEntries(samples), {
				e1: ['1/1', '0.8/1'],
				e2: ['1/1'],
			});
		});

		test('two non-overlapping additions both survive (chunked scoring)', () => {
			const base = 'alpha\nbravo\ncharlie\n';
			const e1Chunk = 'delta added by e1\n';
			const e2Chunk = 'echo added by e2\n';
			const afterE1 = base + e1Chunk;
			const afterE2 = e2Chunk + afterE1;

			const samples = simulate([
				{ id: 'e1', before: base, after: afterE1, aiChunks: [e1Chunk] },
				{ id: 'e2', before: afterE1, after: afterE2, aiChunks: [e2Chunk] },
			]);

			assert.deepStrictEqual(Object.fromEntries(samples), {
				e1: ['1/1', '1/1'],
				e2: ['1/1'],
			});
		});

		test('write then edit that appends — write stays at 1 under chunked scoring', () => {
			const original = 'export function a() { return 1; }\n';
			const appended = 'export function b() { return 2; }\n';
			const afterWrite = original;
			const afterEdit = original + appended;

			const samples = simulate([
				{ id: 'write', before: '', after: afterWrite, aiChunks: [original] },
				{ id: 'edit', before: afterWrite, after: afterEdit, aiChunks: [appended] },
			]);

			assert.deepStrictEqual(Object.fromEntries(samples), {
				write: ['1/1', '1/1'],
				edit: ['1/1'],
			});
		});

		test('MultiEdit with several chunks survives a later unrelated append', () => {
			const base = '// existing module\n';
			const chunkA = 'export function alpha() { return 1; }\n';
			const chunkB = 'export function bravo() { return 2; }\n';
			const chunkC = 'export function charlie() { return 3; }\n';
			const chunkD = 'export function delta() { return 4; }\n';
			const afterMulti = base + chunkA + chunkB + chunkC;
			const afterEdit = afterMulti + chunkD;

			const samples = simulate([
				{ id: 'multi', before: base, after: afterMulti, aiChunks: [chunkA, chunkB, chunkC] },
				{ id: 'edit', before: afterMulti, after: afterEdit, aiChunks: [chunkD] },
			]);

			assert.deepStrictEqual(Object.fromEntries(samples), {
				multi: ['1/1', '1/1'],
				edit: ['1/1'],
			});
		});

		test('add a line, then modify the same line — fourGram drops, noRevert stays high', () => {
			const base = 'alpha\nbravo\ncharlie\n';
			const afterE1 = base + 'delta the original\n';
			const afterE2 = base + 'delta after edit two changed it\n';

			const samples = simulate([
				{ id: 'e1', before: base, after: afterE1 },
				{ id: 'e2', before: afterE1, after: afterE2 },
			]);

			assert.deepStrictEqual(Object.fromEntries(samples), {
				e1: ['1/1', '0.54/1'],
				e2: ['1/1'],
			});
		});

		test('change a line, add a line, delete a line — mixed survival', () => {
			const base = 'first\nsecond\nthird\nfourth\nfifth\n';
			const afterE1 = 'first\nSECOND CHANGED\nthird\nfourth\nfifth\n';
			const afterE2 = afterE1 + 'sixth added\n';
			const afterE3 = 'first\nSECOND CHANGED\nthird\nfifth\nsixth added\n';

			const samples = simulate([
				{ id: 'e1-change', before: base, after: afterE1 },
				{ id: 'e2-add', before: afterE1, after: afterE2 },
				{ id: 'e3-delete', before: afterE2, after: afterE3 },
			]);

			assert.deepStrictEqual(Object.fromEntries(samples), {
				'e1-change': ['1/1', '0.86/1', '0.73/1'],
				'e2-add': ['1/1', '0.9/1'],
				'e3-delete': ['1/1'],
			});
		});

		test('agent supersedes its own work — first reporter falsely reports a revert', () => {
			const original = 'line one\nline two\nline three\nline four\n';
			const shrunken = 'line one\nline two\n';

			const samples = simulate([
				{ id: 'e1-shrink', before: original, after: shrunken },
				{ id: 'e2-restore', before: shrunken, after: original },
			]);

			assert.deepStrictEqual(Object.fromEntries(samples), {
				'e1-shrink': ['1/1', '0.59/0'],
				'e2-restore': ['1/1'],
			});
		});

		test('user refines after AI edit — noRevert holds at 1', () => {
			const base = 'function add(a, b) { return a + b; }\n';
			const afterAI = 'function add(a: number, b: number): number { return a + b; }\n';
			const afterUser = 'function add(a: number, b: number): number {\n\treturn a + b;\n}\n';

			const samples = simulate([
				{ id: 'ai-edit', before: base, after: afterAI },
				{ id: 'user-refine', before: afterAI, after: afterUser },
			]);

			const aiSamples = samples.get('ai-edit')!;
			assert.strictEqual(aiSamples[0], '1/1', 'AI edit perfect at t=0');
			const [fg, nr] = aiSamples[1].split('/').map(Number);
			assert.ok(fg > 0.4 && fg < 1, `expected fourGram in (0.4, 1), got ${fg}`);
			assert.strictEqual(nr, 1, 'noRevert should remain 1 after a refinement');
		});

		test('user fully reverts after AI edit — both scores drop', () => {
			const before = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n';
			const after = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n';

			const samples = simulate([
				{ id: 'ai-edit', before, after },
				{ id: 'user-revert', before: after, after: before },
			]);

			const aiSamples = samples.get('ai-edit')!;
			assert.strictEqual(aiSamples[0], '1/1');
			const [fg, nr] = aiSamples[1].split('/').map(Number);
			assert.ok(fg < 0.2, `expected fourGram < 0.2 after revert, got ${fg}`);
			assert.strictEqual(nr, 0, 'noRevert should be 0 after a full revert');
		});
	});
});
