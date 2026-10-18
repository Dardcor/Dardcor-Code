/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { Range } from '../../../common/core/range.js';
import { IModelDecoration, IModelDecorationOptions, InjectedTextOptions } from '../../../common/model.js';
import { InlineDecoration, InlineDecorationType, InlineModelDecorationsComputer, IInlineModelDecorationsComputerContext, InjectedTextInlineDecorationsComputer, IInjectedTextInlineDecorationsComputerContext } from '../../../common/viewModel/inlineDecorations.js';
import { createTextModel } from '../testTextModel.js';
import { IdentityCoordinatesConverter } from '../../../common/coordinatesConverter.js';

function createModelDecoration(id: string, range: Range, options: IModelDecorationOptions): IModelDecoration {
	return {
		id,
		ownerId: 0,
		range,
		options
	};
}

suite('InlineModelDecorationsComputer', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('no decorations', () => {
		const model = createTextModel('hello world');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => []
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		assert.deepStrictEqual(result, {
			decorations: [],
			inlineDecorations: [[]],
			hasVariableFonts: [false]
		});
		model.dispose();
	});

	test('inline class name decoration on a single line', () => {
		const model = createTextModel('hello world');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [
				createModelDecoration('dec1', new Range(1, 1, 1, 6), {
					description: 'test',
					inlineClassName: 'test-class'
				})
			]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		assert.strictEqual(result.decorations.length, 1);
		assert.deepStrictEqual(result.inlineDecorations, [
			[new InlineDecoration(new Range(1, 1, 1, 6), 'test-class', InlineDecorationType.Regular)]
		]);
		assert.deepStrictEqual(result.hasVariableFonts, [false]);
		model.dispose();
	});

	test('inlineClassName with affectsLetterSpacing', () => {
		const model = createTextModel('hello world');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [
				createModelDecoration('dec1', new Range(1, 1, 1, 6), {
					description: 'test',
					inlineClassName: 'test-class',
					inlineClassNameAffectsLetterSpacing: true
				})
			]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		assert.deepStrictEqual(result.inlineDecorations, [
			[new InlineDecoration(new Range(1, 1, 1, 6), 'test-class', InlineDecorationType.RegularAffectingLetterSpacing)]
		]);
		model.dispose();
	});

	test('beforeContentClassName decoration', () => {
		const model = createTextModel('hello world');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [
				createModelDecoration('dec1', new Range(1, 3, 1, 8), {
					description: 'test',
					beforeContentClassName: 'before-class'
				})
			]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		assert.deepStrictEqual(result.inlineDecorations, [
			[new InlineDecoration(new Range(1, 3, 1, 3), 'before-class', InlineDecorationType.Before)]
		]);
		model.dispose();
	});

	test('afterContentClassName decoration', () => {
		const model = createTextModel('hello world');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [
				createModelDecoration('dec1', new Range(1, 3, 1, 8), {
					description: 'test',
					afterContentClassName: 'after-class'
				})
			]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		assert.deepStrictEqual(result.inlineDecorations, [
			[new InlineDecoration(new Range(1, 8, 1, 8), 'after-class', InlineDecorationType.After)]
		]);
		model.dispose();
	});

	test('all decoration types combined', () => {
		const model = createTextModel('hello world');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [
				createModelDecoration('dec1', new Range(1, 2, 1, 6), {
					description: 'test',
					inlineClassName: 'inline-class',
					beforeContentClassName: 'before-class',
					afterContentClassName: 'after-class'
				})
			]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		assert.deepStrictEqual(result.inlineDecorations, [
			[
				new InlineDecoration(new Range(1, 2, 1, 6), 'inline-class', InlineDecorationType.Regular),
				new InlineDecoration(new Range(1, 2, 1, 2), 'before-class', InlineDecorationType.Before),
				new InlineDecoration(new Range(1, 6, 1, 6), 'after-class', InlineDecorationType.After),
			]
		]);
		model.dispose();
	});

	test('decoration spanning multiple lines', () => {
		const model = createTextModel('line one\nline two\nline three');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [
				createModelDecoration('dec1', new Range(1, 3, 3, 5), {
					description: 'test',
					inlineClassName: 'multi-line'
				})
			]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result = computer.getDecorations(new Range(1, 1, 3, 11), false, false);
		const expectedInlineDecoration = new InlineDecoration(new Range(1, 3, 3, 5), 'multi-line', InlineDecorationType.Regular);
		assert.deepStrictEqual(result.inlineDecorations, [
			[expectedInlineDecoration],
			[expectedInlineDecoration],
			[expectedInlineDecoration],
		]);
		model.dispose();
	});

	test('decoration with affectsFont sets hasVariableFonts', () => {
		const model = createTextModel('hello world');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [
				createModelDecoration('dec1', new Range(1, 1, 1, 6), {
					description: 'test',
					inlineClassName: 'font-class',
					affectsFont: true
				})
			]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		assert.deepStrictEqual(result.hasVariableFonts, [true]);
		model.dispose();
	});

	test('multiple decorations on different lines', () => {
		const model = createTextModel('line one\nline two');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [
				createModelDecoration('dec1', new Range(1, 1, 1, 5), {
					description: 'test',
					inlineClassName: 'class-a'
				}),
				createModelDecoration('dec2', new Range(2, 1, 2, 5), {
					description: 'test',
					inlineClassName: 'class-b'
				}),
			]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result = computer.getDecorations(new Range(1, 1, 2, 9), false, false);
		assert.deepStrictEqual(result.inlineDecorations, [
			[new InlineDecoration(new Range(1, 1, 1, 5), 'class-a', InlineDecorationType.Regular)],
			[new InlineDecoration(new Range(2, 1, 2, 5), 'class-b', InlineDecorationType.Regular)],
		]);
		model.dispose();
	});

	test('decoration cache is used for same decoration id', () => {
		const model = createTextModel('hello world');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const dec = createModelDecoration('dec1', new Range(1, 1, 1, 6), {
			description: 'test',
			inlineClassName: 'test-class'
		});
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [dec]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result1 = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		const result2 = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		assert.strictEqual(result1.decorations[0], result2.decorations[0]);
		model.dispose();
	});

	test('reset clears decoration cache', () => {
		const model = createTextModel('hello world');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const dec = createModelDecoration('dec1', new Range(1, 1, 1, 6), {
			description: 'test',
			inlineClassName: 'test-class'
		});
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [dec]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result1 = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		computer.reset();
		const result2 = computer.getDecorations(new Range(1, 1, 1, 12), false, false);
		assert.notStrictEqual(result1.decorations[0], result2.decorations[0]);
		model.dispose();
	});

	test('getInlineDecorations returns inline decorations for a model line', () => {
		const model = createTextModel('hello world');
		const coordinatesConverter = new IdentityCoordinatesConverter(model);
		const context: IInlineModelDecorationsComputerContext = {
			getModelDecorations: () => [
				createModelDecoration('dec1', new Range(1, 1, 1, 6), {
					description: 'test',
					inlineClassName: 'test-class'
				})
			]
		};
		const computer = new InlineModelDecorationsComputer(context, model, coordinatesConverter);
		const result = computer.getInlineDecorations(1);
		assert.deepStrictEqual(result, [
			[new InlineDecoration(new Range(1, 1, 1, 6), 'test-class', InlineDecorationType.Regular)]
		]);
		model.dispose();
	});
});

suite('InjectedTextInlineDecorationsComputer', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('no injections returns empty', () => {
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => null,
			getInjectionOffsets: () => null,
			getBreakOffsets: () => [10],
			getWrappedTextIndentLength: () => 0,
			getBaseViewLineNumber: () => 1,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(1);
		assert.deepStrictEqual(result, []);
	});

	test('single injection with inlineClassName on a single output line', () => {
		const injectionOptions: InjectedTextOptions[] = [
			{ content: 'injected', inlineClassName: 'injected-class' }
		];
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => injectionOptions,
			getInjectionOffsets: () => [5],
			getBreakOffsets: () => [18],
			getWrappedTextIndentLength: () => 0,
			getBaseViewLineNumber: () => 1,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(1);
		assert.deepStrictEqual(result, [
			[new InlineDecoration(new Range(1, 6, 1, 14), 'injected-class', InlineDecorationType.Regular)]
		]);
	});

	test('injection without inlineClassName produces no inline decorations', () => {
		const injectionOptions: InjectedTextOptions[] = [
			{ content: 'injected' }
		];
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => injectionOptions,
			getInjectionOffsets: () => [5],
			getBreakOffsets: () => [18],
			getWrappedTextIndentLength: () => 0,
			getBaseViewLineNumber: () => 1,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(1);
		assert.deepStrictEqual(result, [
			[]
		]);
	});

	test('injection with inlineClassNameAffectsLetterSpacing', () => {
		const injectionOptions: InjectedTextOptions[] = [
			{ content: 'abc', inlineClassName: 'ls-class', inlineClassNameAffectsLetterSpacing: true }
		];
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => injectionOptions,
			getInjectionOffsets: () => [0],
			getBreakOffsets: () => [13],
			getWrappedTextIndentLength: () => 0,
			getBaseViewLineNumber: () => 1,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(1);
		assert.deepStrictEqual(result, [
			[new InlineDecoration(new Range(1, 1, 1, 4), 'ls-class', InlineDecorationType.RegularAffectingLetterSpacing)]
		]);
	});

	test('multiple injections on a single output line', () => {
		const injectionOptions: InjectedTextOptions[] = [
			{ content: 'AA', inlineClassName: 'class-a' },
			{ content: 'BBB', inlineClassName: 'class-b' }
		];
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => injectionOptions,
			getInjectionOffsets: () => [2, 5],
			getBreakOffsets: () => [15],
			getWrappedTextIndentLength: () => 0,
			getBaseViewLineNumber: () => 1,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(1);
		assert.deepStrictEqual(result, [
			[
				new InlineDecoration(new Range(1, 3, 1, 5), 'class-a', InlineDecorationType.Regular),
				new InlineDecoration(new Range(1, 8, 1, 11), 'class-b', InlineDecorationType.Regular),
			]
		]);
	});

	test('injection spanning across wrapped lines', () => {
		const injectionOptions: InjectedTextOptions[] = [
			{ content: '1234567890', inlineClassName: 'injected' }
		];
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => injectionOptions,
			getInjectionOffsets: () => [8],
			getBreakOffsets: () => [15, 30],
			getWrappedTextIndentLength: () => 0,
			getBaseViewLineNumber: () => 5,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(1);
		assert.deepStrictEqual(result, [
			[new InlineDecoration(new Range(5, 9, 5, 16), 'injected', InlineDecorationType.Regular)],
			[new InlineDecoration(new Range(6, 1, 6, 4), 'injected', InlineDecorationType.Regular)],
		]);
	});

	test('injection with wrappedTextIndentLength on wrapped lines', () => {
		const injectionOptions: InjectedTextOptions[] = [
			{ content: '12345678901234567890', inlineClassName: 'injected' }
		];
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => injectionOptions,
			getInjectionOffsets: () => [0],
			getBreakOffsets: () => [15, 30],
			getWrappedTextIndentLength: () => 4,
			getBaseViewLineNumber: () => 1,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(1);
		assert.deepStrictEqual(result, [
			[new InlineDecoration(new Range(1, 1, 1, 16), 'injected', InlineDecorationType.Regular)],
			[new InlineDecoration(new Range(2, 5, 2, 10), 'injected', InlineDecorationType.Regular)],
		]);
	});

	test('injection starting in later wrapped line', () => {
		const injectionOptions: InjectedTextOptions[] = [
			{ content: 'ab', inlineClassName: 'late-class' }
		];
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => injectionOptions,
			getInjectionOffsets: () => [20],
			getBreakOffsets: () => [15, 32],
			getWrappedTextIndentLength: () => 0,
			getBaseViewLineNumber: () => 1,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(1);
		assert.deepStrictEqual(result, [
			[],
			[new InlineDecoration(new Range(2, 6, 2, 8), 'late-class', InlineDecorationType.Regular)],
		]);
	});

	test('base view line number offsets correctly', () => {
		const injectionOptions: InjectedTextOptions[] = [
			{ content: 'test', inlineClassName: 'test-class' }
		];
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => injectionOptions,
			getInjectionOffsets: () => [0],
			getBreakOffsets: () => [14],
			getWrappedTextIndentLength: () => 0,
			getBaseViewLineNumber: () => 10,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(1);
		assert.deepStrictEqual(result, [
			[new InlineDecoration(new Range(10, 1, 10, 5), 'test-class', InlineDecorationType.Regular)]
		]);
	});

	test('range uses view line number, not model line number', () => {
		const modelLineNumber = 3;
		const baseViewLineNumber = 7;
		const injectionOptions: InjectedTextOptions[] = [
			{ content: 'ghost', inlineClassName: 'ghost-class' }
		];
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => injectionOptions,
			getInjectionOffsets: () => [0],
			getBreakOffsets: () => [15],
			getWrappedTextIndentLength: () => 0,
			getBaseViewLineNumber: () => baseViewLineNumber,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(modelLineNumber);
		assert.deepStrictEqual(result, [
			[new InlineDecoration(new Range(7, 1, 7, 6), 'ghost-class', InlineDecorationType.Regular)]
		]);
	});

	test('range uses view line number on wrapped lines, not model line number', () => {
		const modelLineNumber = 2;
		const baseViewLineNumber = 5;
		const injectionOptions: InjectedTextOptions[] = [
			{ content: '1234567890', inlineClassName: 'wrap-class' }
		];
		const context: IInjectedTextInlineDecorationsComputerContext = {
			getInjectionOptions: () => injectionOptions,
			getInjectionOffsets: () => [0],
			getBreakOffsets: () => [8, 20],
			getWrappedTextIndentLength: () => 0,
			getBaseViewLineNumber: () => baseViewLineNumber,
		};
		const computer = new InjectedTextInlineDecorationsComputer(context);
		const result = computer.getInlineDecorations(modelLineNumber);
		assert.deepStrictEqual(result, [
			[new InlineDecoration(new Range(5, 1, 5, 9), 'wrap-class', InlineDecorationType.Regular)],
			[new InlineDecoration(new Range(6, 1, 6, 3), 'wrap-class', InlineDecorationType.Regular)],
		]);
	});
});
