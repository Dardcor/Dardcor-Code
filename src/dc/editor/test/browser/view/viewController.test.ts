/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { TestThemeService } from '../../../../platform/theme/test/common/testThemeService.js';
import { NavigationCommandRevealType } from '../../../browser/coreCommands.js';
import { ViewController } from '../../../browser/view/viewController.js';
import { ViewUserInputEvents } from '../../../browser/view/viewUserInputEvents.js';
import { Position } from '../../../common/core/position.js';
import { MetadataConsts, StandardTokenType } from '../../../common/encodedTokenAttributes.js';
import { EncodedTokenizationResult, ITokenizationSupport, TokenizationRegistry } from '../../../common/languages.js';
import { ILanguageService } from '../../../common/languages/language.js';
import { ILanguageConfigurationService } from '../../../common/languages/languageConfigurationRegistry.js';
import { NullState } from '../../../common/languages/nullTokenize.js';
import { MonospaceLineBreaksComputerFactory } from '../../../common/viewModel/monospaceLineBreaksComputer.js';
import { ViewModel } from '../../../common/viewModel/viewModelImpl.js';
import { instantiateTextModel } from '../../../test/common/testTextModel.js';
import { TestLanguageConfigurationService } from '../../common/modes/testLanguageConfigurationService.js';
import { TestConfiguration } from '../config/testConfiguration.js';
import { createCodeEditorServices } from '../testCodeEditor.js';

suite('ViewController - Bracket content selection', () => {
	let disposables: DisposableStore;
	let instantiationService: TestInstantiationService;
	let languageConfigurationService: ILanguageConfigurationService;
	let languageService: ILanguageService;
	let viewModel: ViewModel | undefined;

	setup(() => {
		disposables = new DisposableStore();
		instantiationService = createCodeEditorServices(disposables);
		languageConfigurationService = instantiationService.get(ILanguageConfigurationService);
		languageService = instantiationService.get(ILanguageService);
		viewModel = undefined;
	});

	teardown(() => {
		viewModel?.dispose();
		viewModel = undefined;
		disposables.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	function createViewControllerWithText(text: string): ViewController {
		const languageId = 'testMode';
		disposables.add(languageService.registerLanguage({ id: languageId }));
		disposables.add(languageConfigurationService.register(languageId, {
			brackets: [
				['{', '}'],
				['[', ']'],
				['(', ')'],
			]
		}));

		const configuration = disposables.add(new TestConfiguration({}));
		const monospaceLineBreaksComputerFactory = MonospaceLineBreaksComputerFactory.create(configuration.options);

		viewModel = new ViewModel(
			1,
			configuration,
			disposables.add(instantiateTextModel(instantiationService, text, languageId)),
			monospaceLineBreaksComputerFactory,
			monospaceLineBreaksComputerFactory,
			null!,
			disposables.add(new TestLanguageConfigurationService()),
			new TestThemeService(),
			{ setVisibleLines() { } },
			{ batchChanges: (cb: any) => cb() }
		);

		return new ViewController(
			configuration,
			viewModel,
			new ViewUserInputEvents(viewModel.coordinatesConverter),
			{
				paste: () => { },
				type: () => { },
				compositionType: () => { },
				startComposition: () => { },
				endComposition: () => { },
				cut: () => { }
			}
		);
	}

	function testBracketSelection(text: string, position: Position, expectedText: string | undefined) {
		const controller = createViewControllerWithText(text);
		controller.dispatchMouse({
			position,
			mouseColumn: position.column,
			startedOnLineNumbers: false,
			revealType: NavigationCommandRevealType.Minimal,
			mouseDownCount: 2,
			inSelectionMode: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			leftButton: true,
			middleButton: false,
			onInjectedText: false
		});

		const selections = viewModel!.getSelections();
		const selectedText = viewModel!.model.getValueInRange(selections[0]);
		if (expectedText === undefined) {
			assert.notStrictEqual(selectedText, expectedText);
		} else {
			assert.strictEqual(selectedText, expectedText);
		}
	}

	test('Select content after opening curly brace', () => {
		testBracketSelection('var x = { hello };', new Position(1, 10), ' hello ');
	});

	test('Select content before closing curly brace', () => {
		testBracketSelection('var x = { hello };', new Position(1, 17), ' hello ');
	});

	test('Select content after opening parenthesis', () => {
		testBracketSelection('function foo(arg1, arg2) {}', new Position(1, 14), 'arg1, arg2');
	});

	test('Select content before closing parenthesis', () => {
		testBracketSelection('function foo(arg1, arg2) {}', new Position(1, 24), 'arg1, arg2');
	});

	test('Select content after opening square bracket', () => {
		testBracketSelection('const arr = [ 1, 2, 3 ];', new Position(1, 14), ' 1, 2, 3 ');
	});

	test('Select content before closing square bracket', () => {
		testBracketSelection('const arr = [ 1, 2, 3 ];', new Position(1, 23), ' 1, 2, 3 ');
	});

	test('Select innermost bracket content with nested brackets', () => {
		testBracketSelection('var x = { a: { b: 123 }};', new Position(1, 15), ' b: 123 ');
	});

	test('Empty brackets create empty selection', () => {
		testBracketSelection('var x = {};', new Position(1, 10), '');
	});
});

interface TokenSpan {
	startIndex: number;
	type: StandardTokenType;
}

suite('ViewController - String content selection', () => {
	let disposables: DisposableStore;
	let instantiationService: TestInstantiationService;
	let languageConfigurationService: ILanguageConfigurationService;
	let languageService: ILanguageService;
	let viewModel: ViewModel | undefined;

	setup(() => {
		disposables = new DisposableStore();
		instantiationService = createCodeEditorServices(disposables);
		languageConfigurationService = instantiationService.get(ILanguageConfigurationService);
		languageService = instantiationService.get(ILanguageService);
		viewModel = undefined;
	});

	teardown(() => {
		viewModel?.dispose();
		viewModel = undefined;
		disposables.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	function createViewControllerWithTokens(text: string, lineTokens: TokenSpan[]): ViewController {
		const languageId = 'stringTestMode';
		disposables.add(languageService.registerLanguage({ id: languageId }));
		disposables.add(languageConfigurationService.register(languageId, {
			brackets: [
				['{', '}'],
				['[', ']'],
				['(', ')'],
			]
		}));

		const encodedLanguageId = languageService.languageIdCodec.encodeLanguageId(languageId);
		const makeMetadata = (type: StandardTokenType) => (
			(encodedLanguageId << MetadataConsts.LANGUAGEID_OFFSET)
			| (type << MetadataConsts.TOKEN_TYPE_OFFSET)
		) >>> 0;

		const tokenizationSupport: ITokenizationSupport = {
			getInitialState: () => NullState,
			tokenize: undefined!,
			tokenizeEncoded: (_line, _hasEOL, state) => {
				const arr = new Uint32Array(lineTokens.length * 2);
				for (let i = 0; i < lineTokens.length; i++) {
					arr[i * 2] = lineTokens[i].startIndex;
					arr[i * 2 + 1] = makeMetadata(lineTokens[i].type);
				}
				return new EncodedTokenizationResult(arr, [], state);
			}
		};

		disposables.add(TokenizationRegistry.register(languageId, tokenizationSupport));

		const configuration = disposables.add(new TestConfiguration({}));
		const monospaceLineBreaksComputerFactory = MonospaceLineBreaksComputerFactory.create(configuration.options);
		const model = disposables.add(instantiateTextModel(instantiationService, text, languageId));

		model.tokenization.forceTokenization(1);

		viewModel = new ViewModel(
			1,
			configuration,
			model,
			monospaceLineBreaksComputerFactory,
			monospaceLineBreaksComputerFactory,
			null!,
			disposables.add(new TestLanguageConfigurationService()),
			new TestThemeService(),
			{ setVisibleLines() { } },
			{ batchChanges: (cb: any) => cb() }
		);

		return new ViewController(
			configuration,
			viewModel,
			new ViewUserInputEvents(viewModel.coordinatesConverter),
			{
				paste: () => { },
				type: () => { },
				compositionType: () => { },
				startComposition: () => { },
				endComposition: () => { },
				cut: () => { }
			}
		);
	}

	function doubleClickAt(controller: ViewController, position: Position): string {
		controller.dispatchMouse({
			position,
			mouseColumn: position.column,
			startedOnLineNumbers: false,
			revealType: NavigationCommandRevealType.Minimal,
			mouseDownCount: 2,
			inSelectionMode: false,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			leftButton: true,
			middleButton: false,
			onInjectedText: false
		});
		const selections = viewModel!.getSelections();
		return viewModel!.model.getValueInRange(selections[0]);
	}


	test('Select string content clicking right after opening double quote', () => {
		const text = 'var x = "hello";';
		const controller = createViewControllerWithTokens(text, [
			{ startIndex: 0, type: StandardTokenType.Other },
			{ startIndex: 8, type: StandardTokenType.String },
			{ startIndex: 15, type: StandardTokenType.Other },
		]);
		assert.strictEqual(doubleClickAt(controller, new Position(1, 10)), 'hello');
	});

	test('Select string content clicking at closing double quote', () => {
		const text = 'var x = "hello";';
		const controller = createViewControllerWithTokens(text, [
			{ startIndex: 0, type: StandardTokenType.Other },
			{ startIndex: 8, type: StandardTokenType.String },
			{ startIndex: 15, type: StandardTokenType.Other },
		]);
		assert.strictEqual(doubleClickAt(controller, new Position(1, 15)), 'hello');
	});

	test('Select string content with single quotes', () => {
		const text = `var x = 'hello';`;
		const controller = createViewControllerWithTokens(text, [
			{ startIndex: 0, type: StandardTokenType.Other },
			{ startIndex: 8, type: StandardTokenType.String },
			{ startIndex: 15, type: StandardTokenType.Other },
		]);
		assert.strictEqual(doubleClickAt(controller, new Position(1, 10)), 'hello');
	});

	test('Select string content with backtick quotes', () => {
		const text = 'var x = `hello`;';
		const controller = createViewControllerWithTokens(text, [
			{ startIndex: 0, type: StandardTokenType.Other },
			{ startIndex: 8, type: StandardTokenType.String },
			{ startIndex: 15, type: StandardTokenType.Other },
		]);
		assert.strictEqual(doubleClickAt(controller, new Position(1, 10)), 'hello');
	});

	test('Select string content containing escape characters', () => {
		const text = 'var x = "hello\\"world";';
		const controller = createViewControllerWithTokens(text, [
			{ startIndex: 0, type: StandardTokenType.Other },
			{ startIndex: 8, type: StandardTokenType.String },
			{ startIndex: 9, type: StandardTokenType.String },
			{ startIndex: 14, type: StandardTokenType.String },
			{ startIndex: 16, type: StandardTokenType.String },
			{ startIndex: 21, type: StandardTokenType.String },
			{ startIndex: 22, type: StandardTokenType.Other },
		]);
		assert.strictEqual(doubleClickAt(controller, new Position(1, 10)), 'hello\\"world');
	});


	test('Click in middle of string does not select whole string', () => {
		const text = 'var x = "hello world";';
		const controller = createViewControllerWithTokens(text, [
			{ startIndex: 0, type: StandardTokenType.Other },
			{ startIndex: 8, type: StandardTokenType.String },
			{ startIndex: 21, type: StandardTokenType.Other },
		]);
		assert.strictEqual(doubleClickAt(controller, new Position(1, 16)), 'world');
	});


	test('Separate quote tokens fall back to word select', () => {
		const text = 'var x = "hello world";';
		const controller = createViewControllerWithTokens(text, [
			{ startIndex: 0, type: StandardTokenType.Other },
			{ startIndex: 8, type: StandardTokenType.Other },
			{ startIndex: 9, type: StandardTokenType.String },
			{ startIndex: 20, type: StandardTokenType.Other },
			{ startIndex: 21, type: StandardTokenType.Other },
		]);
		assert.strictEqual(doubleClickAt(controller, new Position(1, 10)), 'hello');
	});


	test('RTL content in string falls back to word select', () => {
		const text = 'var x = "שלום עולם";';
		const controller = createViewControllerWithTokens(text, [
			{ startIndex: 0, type: StandardTokenType.Other },
			{ startIndex: 8, type: StandardTokenType.String },
			{ startIndex: 19, type: StandardTokenType.Other },
		]);
		assert.strictEqual(doubleClickAt(controller, new Position(1, 10)), 'שלום');
	});


	test('String token without matching closing quote falls back to word select', () => {
		const text = 'var x = "a {} b";';
		const controller = createViewControllerWithTokens(text, [
			{ startIndex: 0, type: StandardTokenType.Other },
			{ startIndex: 8, type: StandardTokenType.String },
			{ startIndex: 11, type: StandardTokenType.Other },
			{ startIndex: 13, type: StandardTokenType.String },
			{ startIndex: 16, type: StandardTokenType.Other },
		]);
		assert.strictEqual(doubleClickAt(controller, new Position(1, 10)), 'a');
	});
});
