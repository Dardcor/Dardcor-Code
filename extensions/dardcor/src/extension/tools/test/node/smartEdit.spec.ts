/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { describe, it } from 'node:test';
import { calculateSimilarity, levenshteinDistance } from '../../smartEdit/levenshtein';
import { isDisproportionateMatch } from '../../smartEdit/safetyGuards';
import { smartReplaceOne } from '../../smartEdit/replacerPipeline';

describe('Smart Edit Engine', () => {
	describe('Levenshtein Distance & Similarity', () => {
		it('should compute exact match distance and similarity', () => {
			assert.strictEqual(levenshteinDistance('hello', 'hello'), 0);
			assert.strictEqual(calculateSimilarity('hello', 'hello'), 1.0);
		});

		it('should compute distance with one character change', () => {
			assert.strictEqual(levenshteinDistance('kitten', 'sitting'), 3);
			assert.strictEqual(calculateSimilarity('', 'abc'), 0);
		});
	});

	describe('Safety Guards', () => {
		it('should flag disproportionate matches when matched span is much larger', () => {
			const old = 'const a = 1;';
			const hugeSpan = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n';
			assert.strictEqual(isDisproportionateMatch(hugeSpan, old), true);
		});

		it('should allow normal proportionate matches', () => {
			const old = 'const a = 1;\nconst b = 2;';
			const span = 'const a = 1;\nconst b = 2;';
			assert.strictEqual(isDisproportionateMatch(span, old), false);
		});
	});

	describe('Replacer Pipeline (9 Layers)', () => {
		it('Layer 1: Exact match', () => {
			const content = 'function add(a, b) {\n\treturn a + b;\n}';
			const oldString = 'return a + b;';
			const newString = 'return (a + b);';
			const res = smartReplaceOne(content, oldString, newString);
			assert.strictEqual(res.success, true);
			assert.strictEqual(res.strategy, 'exact');
			assert.strictEqual(res.text, 'function add(a, b) {\n\treturn (a + b);\n}');
		});

		it('Layer 2: Line-trimmed match (trailing spaces difference)', () => {
			const content = 'function add(a, b) {\n    return a + b;   \n}';
			const oldString = '    return a + b;';
			const newString = '    return a + b + 0;';
			const res = smartReplaceOne(content, oldString, newString);
			assert.strictEqual(res.success, true);
			assert.ok(res.strategy === 'exact' || res.strategy === 'line-trimmed');
		});

		it('Layer 3: Block-anchor match with fuzzy inner lines', () => {
			const content = [
				'function processOrder(order) {',
				'    validate(order);',
				'    const tax = computeTax(order.price);',
				'    saveToDatabase(order, tax);',
				'    return true;',
				'}'
			].join('\n');

			// LLM forgot slight naming in inner line
			const oldString = [
				'function processOrder(order) {',
				'    validate(order);',
				'    const tax = computeTax(order.amount);',
				'    saveToDatabase(order, tax);',
				'    return true;',
				'}'
			].join('\n');

			const newString = [
				'function processOrder(order) {',
				'    validate(order);',
				'    const tax = computeTax(order.total);',
				'    saveToDatabase(order, tax);',
				'    return true;',
				'}'
			].join('\n');

			const res = smartReplaceOne(content, oldString, newString);
			assert.strictEqual(res.success, true);
			assert.strictEqual(res.strategy, 'block-anchor');
			assert.ok(res.text.includes('computeTax(order.total)'));
		});

		it('Layer 4: Whitespace-normalized match', () => {
			const content = 'const   sum   =   x  +  y;';
			const oldString = 'const sum = x + y;';
			const newString = 'const sum = x + y + z;';
			const res = smartReplaceOne(content, oldString, newString);
			assert.strictEqual(res.success, true);
			assert.strictEqual(res.strategy, 'whitespace-normalized');
			assert.strictEqual(res.text, 'const sum = x + y + z;');
		});

		it('Layer 5: Indentation-flexible match', () => {
			const content = [
				'class Greeter {',
				'        sayHi() {',
				'            return "hi";',
				'        }',
				'}'
			].join('\n');

			const oldString = [
				'    sayHi() {',
				'        return "hi";',
				'    }'
			].join('\n');

			const newString = [
				'    sayHi() {',
				'        return "hello world";',
				'    }'
			].join('\n');

			const res = smartReplaceOne(content, oldString, newString);
			assert.strictEqual(res.success, true);
			assert.ok(res.text.includes('hello world'));
		});

		it('Layer 6: Escape-normalized match', () => {
			const content = 'const query = "SELECT * FROM \\"users\\" WHERE id = 1";';
			const oldString = 'const query = "SELECT * FROM "users" WHERE id = 1";';
			const newString = 'const query = "SELECT * FROM "customers" WHERE id = 1";';
			const res = smartReplaceOne(content, oldString, newString);
			assert.strictEqual(res.success, true);
			assert.strictEqual(res.strategy, 'escape-normalized');
		});

		it('Rejects ambiguous multiple matches without replaceAll', () => {
			const content = 'console.log("x");\nconsole.log("x");';
			const res = smartReplaceOne(content, 'console.log("x");', 'console.log("y");');
			assert.strictEqual(res.success, false);
			assert.strictEqual(res.multipleMatches, true);
		});

		it('Handles multiple matches when replaceAll is true', () => {
			const content = 'console.log("x");\nconsole.log("x");';
			const res = smartReplaceOne(content, 'console.log("x");', 'console.log("y");', { replaceAll: true });
			assert.strictEqual(res.success, true);
			assert.strictEqual(res.text, 'console.log("y");\nconsole.log("y");');
		});
	});
});
