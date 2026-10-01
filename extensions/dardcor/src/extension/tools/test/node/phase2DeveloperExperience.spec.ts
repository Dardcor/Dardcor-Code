/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { describe, it } from 'node:test';
import { ContextCompactor, IConversationMessage } from '../../../context/compaction';
import { estimateTokenCount, estimateMessageTokens } from '../../../context/tokenCounter';
import { ProjectRulesLoader } from '../../../rules/rulesLoader';

describe('Phase 2: Developer Experience Engines', () => {
	describe('Context Compaction Engine', () => {
		it('should accurately estimate token counts', () => {
			const text = 'function calculateTotal(price: number, tax: number): number { return price * (1 + tax); }';
			const tokens = estimateTokenCount(text);
			assert.ok(tokens > 15 && tokens < 40);
		});

		it('Tier 1: basicCompact should prune large older tool results', () => {
			const longOutput = new Array(50).fill('line of compiler output log data here').join('\n');
			const messages: IConversationMessage[] = [
				{ role: 'user', content: 'check build' },
				{ role: 'assistant', content: 'running build' },
				{ role: 'tool', content: longOutput, toolName: 'run_terminal' },
				{ role: 'user', content: 'fix error' },
				{ role: 'assistant', content: 'fixing error' },
				{ role: 'tool', content: 'short log', toolName: 'edit_file' },
				{ role: 'user', content: 'run tests' },
				{ role: 'assistant', content: 'all passing' },
			];

			// Lower threshold to trigger compaction
			const config = {
				maxContextTokens: 500,
				pruneThresholdTokens: 200,
				preserveRecentTurns: 1,
			};

			const { compacted, prunedCount } = ContextCompactor.basicCompact(messages, config);
			assert.strictEqual(prunedCount, 1);
			assert.ok(compacted[2].content.includes('pruned by ContextCompactor'));
		});

		it('Tier 2: buildAgenticSummary should synthesize older turns into CONVERSATION_SUMMARY', () => {
			const messages: IConversationMessage[] = [
				{ role: 'user', content: 'initial task description' },
				{ role: 'assistant', content: 'initial assistant plan' },
				{ role: 'tool', content: 'ok', toolName: 'scan' },
				{ role: 'user', content: 'latest prompt' },
				{ role: 'assistant', content: 'latest reply' },
			];

			const config = {
				maxContextTokens: 1000,
				pruneThresholdTokens: 500,
				preserveRecentTurns: 1,
			};

			const summarized = ContextCompactor.buildAgenticSummary(messages, config);
			assert.ok(summarized[0].content.includes('<CONVERSATION_SUMMARY>'));
			assert.ok(summarized[0].content.includes('initial task description'));
			assert.strictEqual(summarized[summarized.length - 1].content, 'latest reply');
		});
	});

	describe('Project Rules Loader', () => {
		it('should compile project rules into a structured system prompt block', () => {
			const loader = ProjectRulesLoader.getInstance();
			const compiled = loader.compileToSystemPrompt({
				global: ['Always use TypeScript strict mode.'],
				contextual: [{ name: 'testing.md', content: 'Always write tests using node:test.' }],
				hierarchical: [{ dir: 'src/components', content: 'No inline styles allowed.' }],
			});

			assert.ok(compiled.includes('<PROJECT_RULES>'));
			assert.ok(compiled.includes('Always use TypeScript strict mode.'));
			assert.ok(compiled.includes('testing.md'));
			assert.ok(compiled.includes('src/components'));
			assert.ok(compiled.includes('</PROJECT_RULES>'));
		});
	});
});
