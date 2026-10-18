/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../../../base/browser/window.js';
import { Event } from '../../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { workbenchInstantiationService } from '../../../../../../test/browser/workbenchTestServices.js';
import { BlockAnimation, ANIMATION_DURATION_MS } from '../../../../browser/widget/chatContentParts/chatIncrementalRendering/animations/blockAnimations.js';
import { lastBlockBoundary } from '../../../../browser/widget/chatContentParts/chatIncrementalRendering/buffers/paragraphBuffer.js';
import { WordBuffer } from '../../../../browser/widget/chatContentParts/chatIncrementalRendering/buffers/wordBuffer.js';
import { IncrementalDOMMorpher } from '../../../../browser/widget/chatContentParts/chatIncrementalRendering/chatIncrementalRendering.js';
import { ChatConfiguration } from '../../../../common/constants.js';

suite('lastBlockBoundary', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns -1 for empty string', () => {
		assert.strictEqual(lastBlockBoundary(''), -1);
	});

	test('returns -1 for text without any block boundary', () => {
		assert.strictEqual(lastBlockBoundary('hello world'), -1);
	});

	test('returns -1 for single newline', () => {
		assert.strictEqual(lastBlockBoundary('hello\nworld'), -1);
	});

	test('finds a single block boundary', () => {
		const text = 'hello\n\nworld';
		assert.strictEqual(lastBlockBoundary(text), 5);
	});

	test('finds the last block boundary among multiple', () => {
		const text = 'a\n\nb\n\nc';
		assert.strictEqual(lastBlockBoundary(text), 4);
	});

	test('ignores block boundaries inside a fenced code block', () => {
		const text = '```\ncode\n\nmore code\n```';
		assert.strictEqual(lastBlockBoundary(text), -1);
	});

	test('finds boundary after closing a code fence', () => {
		const text = '```\ncode\n```\n\nafter fence';
		assert.strictEqual(lastBlockBoundary(text), 12);
	});

	test('ignores boundary inside fence but finds one outside', () => {
		const text = 'before\n\n```\ninside\n\nfence\n```\n\nafter';
		const result = lastBlockBoundary(text);
		assert.ok(result > 6, `Expected boundary after fence close, got ${result}`);
	});

	test('handles code fence at the very start of the string', () => {
		const text = '```\ncode\n```\n\ntext';
		assert.strictEqual(lastBlockBoundary(text), 12);
	});

	test('handles unclosed code fence (all subsequent boundaries ignored)', () => {
		const text = '```\ncode\n\nmore\n\nstill inside';
		assert.strictEqual(lastBlockBoundary(text), -1);
	});

	test('handles multiple code fences', () => {
		const text = '```\nfirst\n```\n\nbetween\n\n```\nsecond\n```\n\nend';
		const result = lastBlockBoundary(text);
		assert.ok(result > 20, `Expected last boundary near end, got ${result}`);
	});

	test('handles triple backticks mid-line (not a fence)', () => {
		const text = 'text ``` not a fence\n\nafter';
		assert.strictEqual(lastBlockBoundary(text), 20);
	});

	test('ignores block boundaries inside a tilde-fenced code block', () => {
		const text = '~~~\ncode\n\nmore code\n~~~';
		assert.strictEqual(lastBlockBoundary(text), -1);
	});

	test('finds boundary after closing a tilde fence', () => {
		const text = '~~~\ncode\n~~~\n\nafter fence';
		assert.strictEqual(lastBlockBoundary(text), 12);
	});

	test('handles unclosed tilde fence', () => {
		const text = '~~~\ncode\n\nmore\n\nstill inside';
		assert.strictEqual(lastBlockBoundary(text), -1);
	});

	test('handles mixed backtick and tilde fences', () => {
		const text = '~~~\ntilde code\n\ninside tilde\n~~~\n\n```\nbacktick code\n\ninside backtick\n```\n\nafter both';
		const result = lastBlockBoundary(text);
		assert.ok(result > 40, `Expected boundary after both fences, got ${result}`);
	});
});

suite('IncrementalDOMMorpher', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let disposables: DisposableStore;
	let instantiationService: ReturnType<typeof workbenchInstantiationService>;
	let configService: TestConfigurationService;

	setup(() => {
		disposables = store.add(new DisposableStore());
		instantiationService = workbenchInstantiationService(undefined, disposables);

		configService = new TestConfigurationService();
		configService.setUserConfiguration(ChatConfiguration.IncrementalRenderingStyle, 'fade');
		instantiationService.stub(IConfigurationService, configService);
	});

	teardown(() => {
		disposables.dispose();
	});

	function createMorpher(domNode?: HTMLElement): IncrementalDOMMorpher {
		const node = domNode ?? mainWindow.document.createElement('div');
		return store.add(instantiationService.createInstance(IncrementalDOMMorpher, node));
	}

	suite('tryMorph', () => {

		test('returns false for non-append edit', () => {
			const morpher = createMorpher();
			morpher.seed('hello');
			assert.strictEqual(morpher.tryMorph('goodbye'), false);
		});

		test('returns true when content is identical (no-op)', () => {
			const morpher = createMorpher();
			morpher.seed('hello');
			assert.strictEqual(morpher.tryMorph('hello'), true);
		});

		test('returns true for appended content', () => {
			const morpher = createMorpher();
			morpher.seed('hello');
			assert.strictEqual(morpher.tryMorph('hello world'), true);
		});

		test('returns false when prefix changes', () => {
			const morpher = createMorpher();
			morpher.seed('hello world');
			assert.strictEqual(morpher.tryMorph('Hello world!'), false);
		});

		test('successive appends all succeed', () => {
			const morpher = createMorpher();
			morpher.seed('a');
			assert.strictEqual(morpher.tryMorph('ab'), true);
			assert.strictEqual(morpher.tryMorph('abc'), true);
			assert.strictEqual(morpher.tryMorph('abcd'), true);
		});

		test('fails after a non-append edit even if previous appends succeeded', () => {
			const morpher = createMorpher();
			morpher.seed('hello');
			assert.strictEqual(morpher.tryMorph('hello world'), true);
			assert.strictEqual(morpher.tryMorph('hi world'), false);
		});

		test('invokes render callback on rAF with block-boundary content', () => {
			const rendered: string[] = [];
			const morpher = createMorpher();
			morpher.setRenderCallback(md => rendered.push(md));
			morpher.seed('');

			morpher.tryMorph('paragraph one\n\nparagraph two');
			assert.strictEqual(rendered.length, 0, 'Should not render synchronously');
		});

		test('returns true for content without block boundary (buffered)', () => {
			const morpher = createMorpher();
			morpher.seed('');
			assert.strictEqual(morpher.tryMorph('partial paragraph'), true);
		});

		test('schedules render for content without any paragraph breaks', async () => {
			configService.setUserConfiguration(ChatConfiguration.IncrementalRenderingBuffering, 'paragraph');
			const morpher = createMorpher();
			const rendered: string[] = [];
			morpher.setRenderCallback(md => rendered.push(md));
			morpher.seed('');

			morpher.tryMorph('single block no paragraph breaks');

			await new Promise(r => mainWindow.requestAnimationFrame(r));
			assert.strictEqual(rendered.length, 1);
			assert.strictEqual(rendered[0], 'single block no paragraph breaks');

			morpher.tryMorph('single block no paragraph breaks — more words');
			await new Promise(r => mainWindow.requestAnimationFrame(r));
			assert.strictEqual(rendered.length, 2);
			assert.strictEqual(rendered[1], 'single block no paragraph breaks — more words');
		});
	});

	suite('seed', () => {

		test('sets baseline markdown', () => {
			const morpher = createMorpher();
			morpher.seed('initial content');
			assert.strictEqual(morpher.tryMorph('initial content'), true);
			assert.strictEqual(morpher.tryMorph('initial content more'), true);
		});

		test('with animateInitial=false uses existing child count as watermark', () => {
			const domNode = mainWindow.document.createElement('div');
			domNode.appendChild(mainWindow.document.createElement('p'));
			domNode.appendChild(mainWindow.document.createElement('p'));
			const morpher = createMorpher(domNode);

			morpher.seed('some content', false);
			for (const child of Array.from(domNode.children)) {
				assert.strictEqual(
					(child as HTMLElement).classList.contains('chat-smooth-animate-fade'),
					false,
					'Existing children should not be animated when animateInitial is false'
				);
			}
		});

		test('with animateInitial=true animates existing children', () => {
			const domNode = mainWindow.document.createElement('div');
			domNode.appendChild(mainWindow.document.createElement('p'));
			domNode.appendChild(mainWindow.document.createElement('p'));
			const morpher = createMorpher(domNode);

			morpher.seed('some content', true);
			for (const child of Array.from(domNode.children)) {
				assert.strictEqual(
					(child as HTMLElement).classList.contains('chat-smooth-animate-fade'),
					true,
					'Existing children should be animated when animateInitial is true'
				);
			}
		});
	});

	suite('animation style', () => {

		test('defaults to fade for invalid config value', () => {
			configService.setUserConfiguration(ChatConfiguration.IncrementalRenderingStyle, 'invalid-style');
			const domNode = mainWindow.document.createElement('div');
			domNode.appendChild(mainWindow.document.createElement('p'));
			const morpher = createMorpher(domNode);
			morpher.seed('content', true);

			const child = domNode.children[0] as HTMLElement;
			assert.strictEqual(child.classList.contains('chat-smooth-animate-fade'), true, 'Should fall back to fade');
		});

		test('uses configured animation style', () => {
			configService.setUserConfiguration(ChatConfiguration.IncrementalRenderingStyle, 'rise');
			const domNode = mainWindow.document.createElement('div');
			domNode.appendChild(mainWindow.document.createElement('p'));
			const morpher = createMorpher(domNode);
			morpher.seed('content', true);

			const child = domNode.children[0] as HTMLElement;
			assert.strictEqual(child.classList.contains('chat-smooth-animate-rise'), true, 'Should use rise style');
		});

		for (const style of ['fade', 'rise', 'blur', 'scale', 'slide'] as const) {
			test(`applies ${style} animation class`, () => {
				configService.setUserConfiguration(ChatConfiguration.IncrementalRenderingStyle, style);
				const domNode = mainWindow.document.createElement('div');
				domNode.appendChild(mainWindow.document.createElement('p'));
				const morpher = createMorpher(domNode);
				morpher.seed('content', true);

				const child = domNode.children[0] as HTMLElement;
				assert.strictEqual(
					child.classList.contains(`chat-smooth-animate-${style}`),
					true,
					`Should have chat-smooth-animate-${style} class`
				);
			});
		}
	});

	suite('dispose', () => {

		test('clears pending state on dispose', () => {
			const morpher = createMorpher();
			morpher.seed('');
			morpher.setRenderCallback(() => { });
			morpher.tryMorph('hello\n\nworld');
			morpher.dispose();
		});
	});

	suite('updateStreamRate', () => {

		test('flushes remaining buffered content on completion for paragraph buffer', async () => {
			configService.setUserConfiguration(ChatConfiguration.IncrementalRenderingBuffering, 'paragraph');
			const morpher = createMorpher();
			const rendered: string[] = [];
			morpher.setRenderCallback(md => rendered.push(md));
			morpher.seed('');

			const fullContent = 'paragraph one\n\nparagraph two trailing';
			morpher.tryMorph(fullContent);

			await new Promise(r => mainWindow.requestAnimationFrame(r));
			assert.strictEqual(rendered.length, 1);
			assert.strictEqual(rendered[0], 'paragraph one\n\n');

			morpher.updateStreamRate(100, true);
			await new Promise(r => mainWindow.requestAnimationFrame(r));

			assert.strictEqual(rendered.length, 2);
			assert.strictEqual(rendered[1], fullContent);
		});

		test('signals when word-buffered content has drained to the DOM', async () => {
			configService.setUserConfiguration(ChatConfiguration.IncrementalRenderingBuffering, 'word');
			const morpher = createMorpher();
			morpher.setRenderCallback(() => { });
			let drainCount = 0;
			disposables.add(morpher.onDidDrain(() => drainCount++));
			const didDrain = Event.toPromise(morpher.onDidDrain);

			morpher.seed('one two three');
			morpher.updateStreamRate(2000, true);
			assert.strictEqual(morpher.isDrained, false);

			await didDrain;

			assert.deepStrictEqual({
				isDrained: morpher.isDrained,
				drainCount,
			}, {
				isDrained: true,
				drainCount: 1,
			});
		});
	});
});

suite('BlockAnimation', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('applies animation class and custom properties to new children', () => {
		const anim = new BlockAnimation('fade');
		const container = mainWindow.document.createElement('div');
		const child = container.appendChild(mainWindow.document.createElement('p'));

		anim.animate(container.children, 0, 1, 0);

		assert.strictEqual(child.classList.contains('chat-smooth-animate-fade'), true);
		assert.strictEqual(child.style.getPropertyValue('--chat-smooth-duration'), `${ANIMATION_DURATION_MS}ms`);
		assert.ok(child.style.getPropertyValue('--chat-smooth-delay') !== '');
	});

	test('does not strip animation class on bubbled animationend from nested element', () => {
		const anim = new BlockAnimation('rise');
		const container = mainWindow.document.createElement('div');
		const parent = container.appendChild(mainWindow.document.createElement('div'));
		const nested = parent.appendChild(mainWindow.document.createElement('span'));

		anim.animate(container.children, 0, 1, 0);
		assert.strictEqual(parent.classList.contains('chat-smooth-animate-rise'), true);

		const bubbledEvent = new AnimationEvent('animationend', { bubbles: true });
		nested.dispatchEvent(bubbledEvent);

		assert.strictEqual(
			parent.classList.contains('chat-smooth-animate-rise'),
			true,
			'Animation class should not be removed by bubbled event'
		);
		assert.strictEqual(
			parent.style.getPropertyValue('--chat-smooth-duration'),
			`${ANIMATION_DURATION_MS}ms`,
			'Custom properties should not be removed by bubbled event'
		);
	});

	test('strips animation class on direct animationend from the animated element', () => {
		const anim = new BlockAnimation('blur');
		const container = mainWindow.document.createElement('div');
		const child = container.appendChild(mainWindow.document.createElement('p'));

		anim.animate(container.children, 0, 1, 0);
		assert.strictEqual(child.classList.contains('chat-smooth-animate-blur'), true);

		const directEvent = new AnimationEvent('animationend', { bubbles: true });
		child.dispatchEvent(directEvent);

		assert.strictEqual(
			child.classList.contains('chat-smooth-animate-blur'),
			false,
			'Animation class should be removed after direct animationend'
		);
		assert.strictEqual(
			child.style.getPropertyValue('--chat-smooth-duration'),
			'',
			'Custom property should be removed after direct animationend'
		);
	});

	test('staggers delay across multiple new children', () => {
		const anim = new BlockAnimation('fade');
		const container = mainWindow.document.createElement('div');
		container.appendChild(mainWindow.document.createElement('p'));
		container.appendChild(mainWindow.document.createElement('p'));
		container.appendChild(mainWindow.document.createElement('p'));

		anim.animate(container.children, 0, 3, 0);

		const delays = Array.from(container.children).map(
			c => parseInt((c as HTMLElement).style.getPropertyValue('--chat-smooth-delay'))
		);
		assert.ok(delays[1] > delays[0], `Second delay ${delays[1]} should be greater than first ${delays[0]}`);
		assert.ok(delays[2] > delays[1], `Third delay ${delays[2]} should be greater than second ${delays[1]}`);
	});
});

suite('WordBuffer', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('setRate with isComplete uses at least MIN_RATE_AFTER_COMPLETE', () => {
		const buffer = new WordBuffer();

		buffer.setRate(10, true);
		const md = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10';
		const result1 = buffer.filterFlush(md);
		assert.ok(result1 !== undefined, 'First flush should reveal content');
	});

	test('setRate with undefined rate and isComplete defaults to MIN_RATE_AFTER_COMPLETE', () => {
		const buffer = new WordBuffer();
		buffer.setRate(undefined, true);

		const md = 'word1 word2 word3';
		const result = buffer.filterFlush(md);
		assert.ok(result !== undefined, 'Should reveal content with default complete rate');
	});

	test('setRate during streaming clamps between MIN_RATE and MAX_RATE', () => {
		const buffer = new WordBuffer();

		buffer.setRate(1, false);
		const md = 'word1 word2 word3';
		const result = buffer.filterFlush(md);
		assert.ok(result !== undefined, 'Should reveal content even with low rate (clamped to MIN_RATE)');
	});

	test('setRate with undefined rate during streaming defaults to DEFAULT_RATE', () => {
		const buffer = new WordBuffer();
		buffer.setRate(undefined, false);

		const md = 'word1 word2';
		const result = buffer.filterFlush(md);
		assert.ok(result !== undefined, 'Should reveal content with default streaming rate');
	});

	test('needsNextFrame is true when words remain unrevealed', () => {
		const buffer = new WordBuffer();
		buffer.setRate(1, false);

		buffer.filterFlush('word1 word2 word3 word4 word5');
		assert.strictEqual(buffer.needsNextFrame, true, 'Should need another frame when words remain');
	});

	test('needsNextFrame is false when all words are revealed', () => {
		const buffer = new WordBuffer();
		buffer.setRate(2000, false);

		buffer.filterFlush('hello');
		assert.strictEqual(buffer.needsNextFrame, false, 'Should not need another frame when all words shown');
	});
});
