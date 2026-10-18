/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { afterEach, beforeEach, describe, expect, it, suite, test, vi } from 'vitest';
import { IChatMLFetcher } from '../../../../platform/chat/common/chatMLFetcher';
import { ChatFetchResponseType, RESPONSE_CONTAINED_NO_CHOICES } from '../../../../platform/chat/common/commonTypes';
import { StreamingMockChatMLFetcher } from '../../../../platform/chat/test/common/streamingMockChatMLFetcher';
import { ConfigKey, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { DocumentId } from '../../../../platform/inlineEdits/common/dataTypes/documentId';
import { Edits } from '../../../../platform/inlineEdits/common/dataTypes/edit';
import { ImportChanges } from '../../../../platform/inlineEdits/common/dataTypes/importFilteringOptions';
import { LanguageId } from '../../../../platform/inlineEdits/common/dataTypes/languageId';
import { AggressivenessLevel, DEFAULT_OPTIONS, EarlyDivergenceCancellationMode, LanguageContextLanguages, LintOptionShowCode, LintOptionWarning, ModelConfiguration, PatchModelPrediction, PromptingStrategy, ResponseFormat } from '../../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { InlineEditRequestLogContext } from '../../../../platform/inlineEdits/common/inlineEditLogContext';
import { IInlineEditsModelService } from '../../../../platform/inlineEdits/common/inlineEditsModelService';
import { NoNextEditReason, StatelessNextEditDocument, StatelessNextEditRequest, StreamedEdit, WithStatelessProviderTelemetry } from '../../../../platform/inlineEdits/common/statelessNextEditProvider';
import { ILogger } from '../../../../platform/log/common/logService';
import { FilterReason } from '../../../../platform/networking/common/openai';
import { ISimulationTestContext } from '../../../../platform/simulationTestContext/common/simulationTestContext';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { AsyncIterUtils } from '../../../../util/common/asyncIterableUtils';
import { Result } from '../../../../util/common/result';
import { createTextDocumentData } from '../../../../util/common/test/shims/textDocument';
import { DeferredPromise } from '../../../../util/dardcor/base/common/async';
import { CancellationToken, CancellationTokenSource } from '../../../../util/dardcor/base/common/cancellation';
import { Emitter, Event } from '../../../../util/dardcor/base/common/event';
import { DisposableStore } from '../../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { LineEdit, LineReplacement } from '../../../../util/dardcor/editor/common/core/edits/lineEdit';
import { StringEdit, StringReplacement } from '../../../../util/dardcor/editor/common/core/edits/stringEdit';
import { Position } from '../../../../util/dardcor/editor/common/core/position';
import { LineRange } from '../../../../util/dardcor/editor/common/core/ranges/lineRange';
import { OffsetRange } from '../../../../util/dardcor/editor/common/core/ranges/offsetRange';
import { StringText } from '../../../../util/dardcor/editor/common/core/text/abstractText';
import { IInstantiationService } from '../../../../util/dardcor/platform/instantiation/common/instantiation';
import { DelaySession } from '../../../inlineEdits/common/delay';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { N_LINES_AS_CONTEXT } from '../../common/promptCrafting';
import { nes41Miniv3SystemPrompt, simplifiedPrompt, systemPromptTemplate, unifiedModelSystemPrompt, xtab275SystemPrompt } from '../../common/systemMessages';
import { PromptTags } from '../../common/tags';
import { CurrentDocument } from '../../common/xtabCurrentDocument';
import {
	computeAreaAroundEditWindowLinesRange,
	determineLanguageContextOptions,
	filterOutEditsWithSubstrings,
	getPredictionContents,
	mapChatFetcherErrorToNoNextEditReason,
	ModelConfig,
	overrideModelConfig,
	pickSystemPrompt,
	XtabProvider,
} from '../../node/xtabProvider';


function createMockLogger(): ILogger {
	return new TestLogService();
}

function makeCurrentDocument(lines: string[], cursorLineOneBased: number, cursorColumn = 1): CurrentDocument {
	const text = new StringText(lines.join('\n'));
	return new CurrentDocument(text, new Position(cursorLineOneBased, cursorColumn));
}

function makeActiveDocument(lines: string[], opts?: { workspaceRoot?: URI; languageId?: string }): StatelessNextEditDocument {
	const text = new StringText(lines.join('\n'));
	return new StatelessNextEditDocument(
		DocumentId.create('file:///test/file.ts'),
		opts?.workspaceRoot,
		LanguageId.create(opts?.languageId ?? 'typescript'),
		lines,
		LineEdit.empty,
		text,
		new Edits(StringEdit, []),
	);
}

function makeBaseModelConfig(): ModelConfig {
	return {
		modelName: undefined,
		...DEFAULT_OPTIONS,
	};
}

const baseRequestFields = {
	reason: 'test',
	requestId: 'req-1',
	serverRequestId: undefined,
} as const;


class MockInlineEditsModelService implements IInlineEditsModelService {
	declare readonly _serviceBrand: undefined;
	readonly modelInfo = undefined;
	readonly onModelListUpdated: Event<void> = new Emitter<void>().event;

	private _selectedConfig: ModelConfiguration = {
		modelName: 'test-model',
		promptingStrategy: undefined,
		includeTagsInCurrentFile: false,
		lintOptions: undefined,
	};

	private _defaultConfig: ModelConfiguration = {
		modelName: 'default-model',
		promptingStrategy: undefined,
		includeTagsInCurrentFile: false,
		lintOptions: undefined,
	};

	async setCurrentModelId(_modelId: string): Promise<void> { }

	selectedModelConfiguration(): ModelConfiguration {
		return this._selectedConfig;
	}

	defaultModelConfiguration(): ModelConfiguration {
		return this._defaultConfig;
	}

	setSelectedConfig(config: Partial<ModelConfiguration>): void {
		this._selectedConfig = { ...this._selectedConfig, ...config };
	}

	setDefaultConfig(config: Partial<ModelConfiguration>): void {
		this._defaultConfig = { ...this._defaultConfig, ...config };
	}
}


describe('pickSystemPrompt', () => {
	it('returns systemPromptTemplate for DardcorNesXtab', () => {
		expect(pickSystemPrompt(PromptingStrategy.DardcorNesXtab)).toBe(systemPromptTemplate);
	});

	it('returns systemPromptTemplate for undefined', () => {
		expect(pickSystemPrompt(undefined)).toBe(systemPromptTemplate);
	});

	it('returns unifiedModelSystemPrompt for UnifiedModel', () => {
		expect(pickSystemPrompt(PromptingStrategy.UnifiedModel)).toBe(unifiedModelSystemPrompt);
	});

	it('returns simplifiedPrompt for Codexv21NesUnified', () => {
		expect(pickSystemPrompt(PromptingStrategy.Codexv21NesUnified)).toBe(simplifiedPrompt);
	});

	it('returns simplifiedPrompt for SimplifiedSystemPrompt', () => {
		expect(pickSystemPrompt(PromptingStrategy.SimplifiedSystemPrompt)).toBe(simplifiedPrompt);
	});

	it.each([
		PromptingStrategy.PatchBased,
		PromptingStrategy.PatchBased01,
		PromptingStrategy.PatchBased02,
		PromptingStrategy.PatchBased02WithRecentLineNumbers,
		PromptingStrategy.PatchBased02WithoutRecentLineNumbers,
		PromptingStrategy.Xtab275,
		PromptingStrategy.XtabAggressiveness,
		PromptingStrategy.Xtab275Aggressiveness,
		PromptingStrategy.Xtab275AggressivenessHighLow,
		PromptingStrategy.Xtab275EditIntent,
		PromptingStrategy.Xtab275EditIntentShort,
	])('returns xtab275SystemPrompt for %s', (strategy) => {
		expect(pickSystemPrompt(strategy)).toBe(xtab275SystemPrompt);
	});

	it('returns nes41Miniv3SystemPrompt for Nes41Miniv3', () => {
		expect(pickSystemPrompt(PromptingStrategy.Nes41Miniv3)).toBe(nes41Miniv3SystemPrompt);
	});

	it('each strategy produces a non-empty string', () => {
		const allStrategies: (PromptingStrategy | undefined)[] = [
			undefined,
			...Object.values(PromptingStrategy),
		];
		for (const s of allStrategies) {
			expect(pickSystemPrompt(s).length).toBeGreaterThan(0);
		}
	});
});


describe('mapChatFetcherErrorToNoNextEditReason', () => {
	it('maps Canceled to GotCancelled', () => {
		const result = mapChatFetcherErrorToNoNextEditReason({
			type: ChatFetchResponseType.Canceled,
			...baseRequestFields,
		});
		expect(result).toBeInstanceOf(NoNextEditReason.GotCancelled);
	});

	it.each([
		{ type: ChatFetchResponseType.OffTopic, ...baseRequestFields },
		{ type: ChatFetchResponseType.Filtered, ...baseRequestFields, category: FilterReason.Hate },
		{ type: ChatFetchResponseType.PromptFiltered, ...baseRequestFields, category: FilterReason.Hate },
		{ type: ChatFetchResponseType.Length, ...baseRequestFields, truncatedValue: '' },
		{ type: ChatFetchResponseType.RateLimited, ...baseRequestFields, retryAfter: undefined, rateLimitKey: 'k', isAuto: false },
		{ type: ChatFetchResponseType.QuotaExceeded, ...baseRequestFields, retryAfter: new Date() },
		{ type: ChatFetchResponseType.ExtensionBlocked, ...baseRequestFields, retryAfter: 0, learnMoreLink: '' },
		{ type: ChatFetchResponseType.AgentUnauthorized, ...baseRequestFields, authorizationUrl: '' },
		{ type: ChatFetchResponseType.AgentFailedDependency, ...baseRequestFields },
		{ type: ChatFetchResponseType.InvalidStatefulMarker, ...baseRequestFields },
	] satisfies ReadonlyArray<Parameters<typeof mapChatFetcherErrorToNoNextEditReason>[0]>)('maps $type to Uncategorized', (error) => {
		const result = mapChatFetcherErrorToNoNextEditReason(error);
		expect(result).toBeInstanceOf(NoNextEditReason.Uncategorized);
	});

	it.each([
		{ type: ChatFetchResponseType.BadRequest, ...baseRequestFields },
		{ type: ChatFetchResponseType.NotFound, ...baseRequestFields },
		{ type: ChatFetchResponseType.Failed, ...baseRequestFields },
		{ type: ChatFetchResponseType.NetworkError, ...baseRequestFields },
		{ type: ChatFetchResponseType.Unknown, ...baseRequestFields },
	] satisfies ReadonlyArray<Parameters<typeof mapChatFetcherErrorToNoNextEditReason>[0]>)('maps $type to FetchFailure', (error) => {
		const result = mapChatFetcherErrorToNoNextEditReason(error);
		expect(result).toBeInstanceOf(NoNextEditReason.FetchFailure);
	});
});


describe('overrideModelConfig', () => {
	it('overrides modelName from overridingConfig', () => {
		const base = makeBaseModelConfig();
		const override: ModelConfiguration = {
			modelName: 'custom-model',
			promptingStrategy: PromptingStrategy.Xtab275,
			includeTagsInCurrentFile: true,
			lintOptions: undefined,
		};

		const result = overrideModelConfig(base, override);

		expect(result.modelName).toBe('custom-model');
		expect(result.promptingStrategy).toBe(PromptingStrategy.Xtab275);
		expect(result.currentFile.includeTags).toBe(true);
	});

	it('preserves base config fields that are not overridden', () => {
		const base = makeBaseModelConfig();
		const override: ModelConfiguration = {
			modelName: 'new-model',
			promptingStrategy: undefined,
			includeTagsInCurrentFile: false,
			lintOptions: undefined,
		};

		const result = overrideModelConfig(base, override);

		expect(result.includePostScript).toBe(base.includePostScript);
		expect(result.pagedClipping).toEqual(base.pagedClipping);
		expect(result.recentlyViewedDocuments).toEqual(base.recentlyViewedDocuments);
		expect(result.diffHistory).toEqual(base.diffHistory);
	});

	it('merges lintOptions when overridingConfig has lintOptions', () => {
		const testLintOptions = { tagName: 'lint', warnings: LintOptionWarning.YES, showCode: LintOptionShowCode.YES, maxLints: 5, maxLineDistance: 10, nRecentFiles: 0 };
		const base: ModelConfig = {
			...makeBaseModelConfig(),
			lintOptions: testLintOptions,
		};
		const overrideLintOptions = { tagName: 'diag', warnings: LintOptionWarning.NO, showCode: LintOptionShowCode.NO, maxLints: 3, maxLineDistance: 5, nRecentFiles: 0 };
		const override: ModelConfiguration = {
			modelName: 'test',
			promptingStrategy: undefined,
			includeTagsInCurrentFile: false,
			lintOptions: overrideLintOptions,
		};

		const result = overrideModelConfig(base, override);

		expect(result.lintOptions).toEqual(overrideLintOptions);
	});

	it('keeps base lintOptions when override has no lintOptions', () => {
		const testLintOptions = { tagName: 'lint', warnings: LintOptionWarning.YES, showCode: LintOptionShowCode.YES, maxLints: 5, maxLineDistance: 10, nRecentFiles: 0 };
		const base: ModelConfig = {
			...makeBaseModelConfig(),
			lintOptions: testLintOptions,
		};
		const override: ModelConfiguration = {
			modelName: 'test',
			promptingStrategy: undefined,
			includeTagsInCurrentFile: false,
			lintOptions: undefined,
		};

		const result = overrideModelConfig(base, override);

		expect(result.lintOptions).toEqual(testLintOptions);
	});

	it('overrides currentFile.includeTags without affecting other currentFile fields', () => {
		const base = makeBaseModelConfig();
		const originalMaxTokens = base.currentFile.maxTokens;
		const override: ModelConfiguration = {
			modelName: 'test',
			promptingStrategy: undefined,
			includeTagsInCurrentFile: true,
			lintOptions: undefined,
		};

		const result = overrideModelConfig(base, override);

		expect(result.currentFile.includeTags).toBe(true);
		expect(result.currentFile.maxTokens).toBe(originalMaxTokens);
	});

	it('merges currentFile partial overrides with base currentFile', () => {
		const base = makeBaseModelConfig();
		const override: ModelConfiguration = {
			modelName: 'test',
			promptingStrategy: undefined,
			includeTagsInCurrentFile: false,
			currentFile: { maxTokens: 500 },
			lintOptions: undefined,
		};

		const result = overrideModelConfig(base, override);

		expect(result.currentFile.maxTokens).toBe(500);
		expect(result.currentFile.includeTags).toBe(false);
		expect(result.currentFile.includeLineNumbers).toBe(base.currentFile.includeLineNumbers);
		expect(result.currentFile.includeCursorTag).toBe(base.currentFile.includeCursorTag);
	});

	it('merges recentlyViewedDocuments partial overrides with base', () => {
		const base = makeBaseModelConfig();
		const override: ModelConfiguration = {
			modelName: 'test',
			promptingStrategy: undefined,
			includeTagsInCurrentFile: false,
			recentlyViewedDocuments: { maxTokens: 3000 },
			lintOptions: undefined,
		};

		const result = overrideModelConfig(base, override);

		expect(result.recentlyViewedDocuments.maxTokens).toBe(3000);
		expect(result.recentlyViewedDocuments.nDocuments).toBe(base.recentlyViewedDocuments.nDocuments);
		expect(result.recentlyViewedDocuments.includeViewedFiles).toBe(base.recentlyViewedDocuments.includeViewedFiles);
	});
});


describe('determineLanguageContextOptions', () => {
	const baseOpts = {
		enabled: false,
		enabledLanguages: {} as LanguageContextLanguages,
		maxTokens: 500,
		enableAllContextProviders: false,
		traitPosition: 'before' as const,
	};

	it('uses explicit language entry when language is in enabledLanguages', () => {
		const result = determineLanguageContextOptions(
			LanguageId.create('python'),
			{ ...baseOpts, enabledLanguages: { python: true } as LanguageContextLanguages },
		);
		expect(result).toMatchInlineSnapshot(`
			{
			  "enabled": true,
			  "maxTokens": 500,
			  "traitPosition": "before",
			}
		`);
	});

	it('uses false from enabledLanguages when explicitly disabled for language', () => {
		const result = determineLanguageContextOptions(
			LanguageId.create('python'),
			{ ...baseOpts, enabledLanguages: { python: false } as LanguageContextLanguages },
		);
		expect(result.enabled).toBe(false);
	});

	it('falls back to enableAllContextProviders when language not in enabledLanguages', () => {
		const result = determineLanguageContextOptions(
			LanguageId.create('rust'),
			{ ...baseOpts, enableAllContextProviders: true },
		);
		expect(result.enabled).toBe(true);
	});

	it('falls back to the enabled param as last resort', () => {
		const result = determineLanguageContextOptions(
			LanguageId.create('rust'),
			{ ...baseOpts, enabled: true },
		);
		expect(result.enabled).toBe(true);
	});

	it('returns false when all sources are false', () => {
		const result = determineLanguageContextOptions(
			LanguageId.create('rust'),
			baseOpts,
		);
		expect(result.enabled).toBe(false);
	});

	it('passes through maxTokens and traitPosition', () => {
		const result = determineLanguageContextOptions(
			LanguageId.create('typescript'),
			{ ...baseOpts, enabled: true, maxTokens: 1000, traitPosition: 'after' },
		);
		expect(result).toMatchInlineSnapshot(`
			{
			  "enabled": true,
			  "maxTokens": 1000,
			  "traitPosition": "after",
			}
		`);
	});

	it('enabledLanguages takes priority over enableAllContextProviders', () => {
		const result = determineLanguageContextOptions(
			LanguageId.create('python'),
			{
				...baseOpts,
				enabledLanguages: { python: false } as LanguageContextLanguages,
				enableAllContextProviders: true,
			},
		);
		expect(result.enabled).toBe(false);
	});
});


describe('getPredictionContents', () => {
	const editWindowLines = ['const x = 1;', 'const y = 2;'];
	const doc = makeActiveDocument(['line0', ...editWindowLines, 'line3']);

	const call = (
		lines: readonly string[],
		format: ResponseFormat,
		opts?: { cursorLineOffset?: number; cursorLineInEditWindowOffset?: number; patchModelPredictionKind?: PatchModelPrediction; doc?: StatelessNextEditDocument },
	) => getPredictionContents(
		opts?.doc ?? doc,
		opts?.cursorLineOffset ?? 0,
		lines,
		opts?.cursorLineInEditWindowOffset ?? 0,
		format,
		opts?.patchModelPredictionKind ?? PatchModelPrediction.FilePath,
	);

	it('returns correct content for UnifiedWithXml', () => {
		expect(call(editWindowLines, ResponseFormat.UnifiedWithXml)).toMatchInlineSnapshot(`
			"<EDIT>
			const x = 1;
			const y = 2;
			</EDIT>"
		`);
	});

	it('returns correct content for EditWindowOnly', () => {
		expect(call(editWindowLines, ResponseFormat.EditWindowOnly)).toMatchInlineSnapshot(`
			"const x = 1;
			const y = 2;"
		`);
	});

	it('returns correct content for EditWindowWithEditIntent', () => {
		expect(call(editWindowLines, ResponseFormat.EditWindowWithEditIntent)).toMatchInlineSnapshot(`
			"<|edit_intent|>high<|/edit_intent|>
			const x = 1;
			const y = 2;"
		`);
	});

	it('returns correct content for EditWindowWithEditIntentShort', () => {
		expect(call(editWindowLines, ResponseFormat.EditWindowWithEditIntentShort)).toMatchInlineSnapshot(`
			"H
			const x = 1;
			const y = 2;"
		`);
	});

	it('returns correct content for CodeBlock', () => {
		expect(call(editWindowLines, ResponseFormat.CodeBlock)).toMatchInlineSnapshot(`
			"\`\`\`
			const x = 1;
			const y = 2;
			\`\`\`"
		`);
	});

	it('returns correct content for CustomDiffPatch with workspace root', () => {
		const docWithRoot = makeActiveDocument(
			['line0', 'line1'],
			{ workspaceRoot: URI.file('/workspace/project') },
		);
		const result = call(['line0'], ResponseFormat.CustomDiffPatch, { doc: docWithRoot });
		expect(result.endsWith(':')).toBe(true);
	});

	it('returns correct content for CustomDiffPatch without workspace root', () => {
		const result = call(editWindowLines, ResponseFormat.CustomDiffPatch);
		expect(result.endsWith(':')).toBe(true);
	});

	it('CustomDiffPatch / CurrentLine emits path:line and a `-` deletion', () => {
		expect(call(editWindowLines, ResponseFormat.CustomDiffPatch, {
			cursorLineOffset: 7,
			cursorLineInEditWindowOffset: 1,
			patchModelPredictionKind: PatchModelPrediction.CurrentLine,
		})).toMatchInlineSnapshot(`
			"/test/file.ts:7
			-const y = 2;"
		`);
	});

	it('CustomDiffPatch / CurrentLineReplaced emits a deletion plus an empty `+`', () => {
		expect(call(editWindowLines, ResponseFormat.CustomDiffPatch, {
			cursorLineOffset: 7,
			cursorLineInEditWindowOffset: 1,
			patchModelPredictionKind: PatchModelPrediction.CurrentLineReplaced,
		})).toMatchInlineSnapshot(`
			"/test/file.ts:7
			-const y = 2;
			+"
		`);
	});

	it('CustomDiffPatch / CurrentLineCompleted echoes the line as a `+`', () => {
		expect(call(editWindowLines, ResponseFormat.CustomDiffPatch, {
			cursorLineOffset: 7,
			cursorLineInEditWindowOffset: 1,
			patchModelPredictionKind: PatchModelPrediction.CurrentLineCompleted,
		})).toMatchInlineSnapshot(`
			"/test/file.ts:7
			-const y = 2;
			+const y = 2;"
		`);
	});

	it('CustomDiffPatch falls back to path-only when the cursor is past the edit window', () => {
		const result = call(editWindowLines, ResponseFormat.CustomDiffPatch, {
			cursorLineOffset: 99,
			cursorLineInEditWindowOffset: 99,
			patchModelPredictionKind: PatchModelPrediction.CurrentLine,
		});
		expect(result.endsWith(':')).toBe(true);
		expect(result.includes('undefined')).toBe(false);
	});

	it('handles empty editWindowLines', () => {
		expect(call([], ResponseFormat.EditWindowOnly)).toBe('');
	});

	it('handles single-line editWindowLines', () => {
		expect(call(['only line'], ResponseFormat.EditWindowOnly)).toBe('only line');
	});
});


describe('computeAreaAroundEditWindowLinesRange', () => {
	it('returns correct range with cursor in middle of large document', () => {
		const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
		const doc = makeCurrentDocument(lines, 26);

		const result = computeAreaAroundEditWindowLinesRange(doc);

		expect(result.start).toBe(25 - N_LINES_AS_CONTEXT);
		expect(result.endExclusive).toBe(25 + N_LINES_AS_CONTEXT + 1);
	});

	it('clamps start to 0 when cursor is near beginning', () => {
		const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
		const doc = makeCurrentDocument(lines, 3);

		const result = computeAreaAroundEditWindowLinesRange(doc);

		expect(result.start).toBe(0);
		expect(result.endExclusive).toBe(2 + N_LINES_AS_CONTEXT + 1);
	});

	it('clamps end to document length when cursor is near end', () => {
		const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
		const doc = makeCurrentDocument(lines, 19);

		const result = computeAreaAroundEditWindowLinesRange(doc);

		expect(result.start).toBe(Math.max(0, 18 - N_LINES_AS_CONTEXT));
		expect(result.endExclusive).toBe(20);
	});

	it('handles single-line document', () => {
		const doc = makeCurrentDocument(['only line'], 1);

		const result = computeAreaAroundEditWindowLinesRange(doc);

		expect(result.start).toBe(0);
		expect(result.endExclusive).toBe(1);
	});

	it('handles document with fewer lines than N_LINES_AS_CONTEXT', () => {
		const lines = ['a', 'b', 'c'];
		const doc = makeCurrentDocument(lines, 2);

		const result = computeAreaAroundEditWindowLinesRange(doc);

		expect(result.start).toBe(0);
		expect(result.endExclusive).toBe(3);
	});

	it('cursor at first line', () => {
		const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
		const doc = makeCurrentDocument(lines, 1);

		const result = computeAreaAroundEditWindowLinesRange(doc);

		expect(result.start).toBe(0);
		expect(result.endExclusive).toBe(N_LINES_AS_CONTEXT + 1);
	});

	it('cursor at last line', () => {
		const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
		const doc = makeCurrentDocument(lines, 50);

		const result = computeAreaAroundEditWindowLinesRange(doc);

		expect(result.start).toBe(49 - N_LINES_AS_CONTEXT);
		expect(result.endExclusive).toBe(50);
	});
});


describe('XtabProvider integration', () => {
	const disposables = new DisposableStore();
	let instaService: IInstantiationService;
	let mockModelService: MockInlineEditsModelService;
	let streamingFetcher: StreamingMockChatMLFetcher;
	let configService: InMemoryConfigurationService;

	beforeEach(() => {
		const testingServiceCollection = createExtensionUnitTestingServices(disposables);

		mockModelService = new MockInlineEditsModelService();
		testingServiceCollection.set(IInlineEditsModelService, mockModelService);

		streamingFetcher = new StreamingMockChatMLFetcher();
		testingServiceCollection.set(IChatMLFetcher, streamingFetcher);

		const accessor = disposables.add(testingServiceCollection.createTestingAccessor());
		instaService = accessor.get(IInstantiationService);
		configService = accessor.get(IConfigurationService) as InMemoryConfigurationService;
	});

	afterEach(() => {
		disposables.clear();
	});

	function createProvider(): XtabProvider {
		return instaService.createInstance(XtabProvider);
	}

	function makeDocumentWithEdit(lines: string[], opts?: {
		insertionOffset?: number;
		insertedText?: string;
		languageId?: string;
		workspaceRoot?: URI;
	}): StatelessNextEditDocument {
		const afterText = lines.join('\n');
		const insertionOffset = opts?.insertionOffset ?? 0;
		const insertedText = opts?.insertedText ?? afterText[insertionOffset] ?? 'x';

		const beforeText = afterText.slice(0, insertionOffset) + afterText.slice(insertionOffset + insertedText.length);
		const beforeStringText = new StringText(beforeText);
		const beforeLines = beforeText.split('\n');

		const recentStringEdit = StringEdit.single(
			new StringReplacement(OffsetRange.emptyAt(insertionOffset), insertedText)
		);
		const recentEdits = new Edits(StringEdit, [recentStringEdit]);

		return new StatelessNextEditDocument(
			DocumentId.create('file:///test/file.ts'),
			opts?.workspaceRoot,
			LanguageId.create(opts?.languageId ?? 'typescript'),
			beforeLines,
			LineEdit.empty,
			beforeStringText,
			recentEdits,
		);
	}

	function createRequestWithEdit(lines: string[], opts?: {
		insertionOffset?: number;
		insertedText?: string;
		languageId?: string;
		expandedEditWindowNLines?: number;
		isSpeculative?: boolean;
	}): StatelessNextEditRequest {
		const doc = makeDocumentWithEdit(lines, opts);
		const beforeText = new StringText(doc.documentBeforeEdits.value);
		const docId = doc.id;

		return new StatelessNextEditRequest(
			'req-1',
			'opp-1',
			beforeText,
			[doc],
			0,
			[{ docId, kind: 'visibleRanges', visibleRanges: [new OffsetRange(0, 100)], documentContent: doc.documentAfterEdits }],
			new DeferredPromise<Result<unknown, NoNextEditReason>>(),
			opts?.expandedEditWindowNLines,
			opts?.isSpeculative ?? false,
			new InlineEditRequestLogContext('file:///test/file.ts', 1, undefined),
			undefined,
			undefined,
			Date.now(),
		);
	}

	function getMessageText(message: Raw.ChatMessage): string {
		return message.content
			.filter(part => part.type === Raw.ChatCompletionContentPartKind.Text)
			.map(part => (part as { text: string }).text)
			.join('');
	}

	async function collectEdits(gen: AsyncGenerator<WithStatelessProviderTelemetry<StreamedEdit>, WithStatelessProviderTelemetry<NoNextEditReason>>): Promise<{
		edits: WithStatelessProviderTelemetry<StreamedEdit>[];
		finalReason: WithStatelessProviderTelemetry<NoNextEditReason>;
	}> {
		const edits: WithStatelessProviderTelemetry<StreamedEdit>[] = [];
		let result = await gen.next();
		while (!result.done) {
			edits.push(result.value);
			result = await gen.next();
		}
		return { edits, finalReason: result.value };
	}

	function createLogContext(): InlineEditRequestLogContext {
		return new InlineEditRequestLogContext('file:///test/file.ts', 1, undefined);
	}

	describe('static properties', () => {
		it('has correct ID', () => {
			const provider = createProvider();
			expect(provider.ID).toBe(XtabProvider.ID);
		});
	});

	describe('handleAcceptance / handleRejection / handleIgnored', () => {
		it('does not throw when called', () => {
			const provider = createProvider();

			expect(() => provider.handleAcceptance()).not.toThrow();
			expect(() => provider.handleRejection()).not.toThrow();
			expect(() => provider.handleIgnored()).not.toThrow();
		});
	});


	describe('provideNextEdit early exits', () => {
		it('returns ActiveDocumentHasNoEdits when xtabEditHistory is empty', async () => {
			const provider = createProvider();
			const lines = ['function foo() {', '  return 1;', '}'];
			const text = new StringText(lines.join('\n'));
			const doc = new StatelessNextEditDocument(
				DocumentId.create('file:///test/file.ts'),
				undefined,
				LanguageId.create('typescript'),
				lines,
				LineEdit.empty,
				text,
				new Edits(StringEdit, []),
			);

			const request = new StatelessNextEditRequest(
				'req-1', 'opp-1', text, [doc], 0,
				[],
				new DeferredPromise<Result<unknown, NoNextEditReason>>(), undefined,
				false,
				createLogContext(), undefined, undefined, Date.now(),
			);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.ActiveDocumentHasNoEdits);
		});

		it('returns Uncategorized(NoSelection) when selection cannot be deduced', async () => {
			const provider = createProvider();
			const lines = ['function foo() {', '  return 1;', '}'];
			const text = new StringText(lines.join('\n'));
			const doc = new StatelessNextEditDocument(
				DocumentId.create('file:///test/file.ts'),
				undefined,
				LanguageId.create('typescript'),
				lines,
				LineEdit.empty,
				text,
				new Edits(StringEdit, []),
			);

			const request = new StatelessNextEditRequest(
				'req-1', 'opp-1', text, [doc], 0,
				[{ docId: doc.id, kind: 'visibleRanges', visibleRanges: [new OffsetRange(0, 50)], documentContent: text }],
				new DeferredPromise<Result<unknown, NoNextEditReason>>(), undefined,
				false,
				createLogContext(), undefined, undefined, Date.now(),
			);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.Uncategorized);
			expect((finalValue.v as NoNextEditReason.Uncategorized).error.message).toContain('NoSelection');
		});

		it('returns PromptTooLarge(editWindow) when edit window exceeds token limit', async () => {
			const provider = createProvider();
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabEditWindowMaxTokens, 1);

			const lines = ['function foo() {', '  return someVeryLongVariableName + anotherLongVariableName;', '}'];
			const request = createRequestWithEdit(lines, { insertionOffset: 5, insertedText: 'c' });

			streamingFetcher.setStreamingLines(['should not reach here']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.PromptTooLarge);
			expect((finalValue.v as NoNextEditReason.PromptTooLarge).message).toBe('editWindow');
		});

		it('wraps unexpected errors in NoNextEditReason.Unexpected', async () => {
			const provider = createProvider();

			const lines = ['function foo() {', '  return 1;', '}'];
			const request = createRequestWithEdit(lines, { insertionOffset: 5, insertedText: 'c' });

			vi.spyOn(mockModelService, 'selectedModelConfiguration').mockImplementation(() => {
				throw new Error('test-unexpected-error');
			});

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.Unexpected);
			expect((finalValue.v as NoNextEditReason.Unexpected).error.message).toContain('test-unexpected-error');
		});

		it('returns GotCancelled when token is already cancelled', async () => {
			const provider = createProvider();

			const lines = ['function foo() {', '  return 1;', '}'];
			const request = createRequestWithEdit(lines, { insertionOffset: 5, insertedText: 'c' });

			streamingFetcher.setStreamingLines(['modified line']);

			const cts = new CancellationTokenSource();
			cts.cancel();

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), cts.token);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
		});

		it('every yield is wrapped in WithStatelessProviderTelemetry', async () => {
			const provider = createProvider();

			const lines = Array.from({ length: 30 }, (_, i) => `line ${i} content`);
			const request = createRequestWithEdit(lines, {
				insertionOffset: 10,
				insertedText: 'x',
			});

			const editWindowLines = [...lines];
			editWindowLines[0] = 'MODIFIED line 0 content';
			streamingFetcher.setStreamingLines(editWindowLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			for (const edit of edits) {
				expect(edit).toBeInstanceOf(WithStatelessProviderTelemetry);
				expect(edit.telemetryBuilder).toBeDefined();
			}
			expect(finalReason).toBeInstanceOf(WithStatelessProviderTelemetry);
			expect(finalReason.telemetryBuilder).toBeDefined();
		});
	});


	describe('edit window computation', () => {
		it('expandedEditWindowNLines overrides default nLinesBelow', async () => {
			const provider = createProvider();

			const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
			const cursorOffset = lines.slice(0, 5).join('\n').length;

			const request = createRequestWithEdit(lines, {
				insertionOffset: cursorOffset,
				insertedText: 'x',
				expandedEditWindowNLines: 40,
			});

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			if (edits.length > 0) {
				const window = edits[0].v.window;
				expect(window).toBeDefined();
			}
		});

		it('merge conflict markers expand the edit window when configured', async () => {
			const provider = createProvider();
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabMaxMergeConflictLines, 20);

			const lines = [
				'line 0',
				'line 1',
				'<<<<<<< HEAD',
				'  our version',
				'=======',
				'  their version',
				'>>>>>>> branch',
				'line 7',
			];

			const cursorOffset = lines.slice(0, 2).join('\n').length + 1;
			const request = createRequestWithEdit(lines, {
				insertionOffset: cursorOffset,
				insertedText: 'x',
			});

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const result = await collectEdits(gen);

			expect(result.finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});
	});


	describe('model configuration', () => {
		it('uses selectedModelConfiguration from model service', async () => {
			const provider = createProvider();

			mockModelService.setSelectedConfig({
				promptingStrategy: PromptingStrategy.Xtab275,
			});

			const lines = ['const x = 1;', 'const y = 2;', 'const z = 3;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			await AsyncIterUtils.drainUntilReturn(gen);

			expect(streamingFetcher.callCount).toBeGreaterThan(0);

			const capturedMessages = streamingFetcher.capturedOptions[0]?.messages;
			expect(capturedMessages).toBeDefined();
			const systemMessage = capturedMessages?.find(m => m.role === Raw.ChatRole.System);
			expect(systemMessage).toBeDefined();
			expect(getMessageText(systemMessage!)).toBe(xtab275SystemPrompt);
		});

		it('applies configured aggressiveness only to aggressiveness strategies', async () => {
			const lines = ['const x = 1;', 'const y = 2;'];
			const captureUserPrompt = async (promptingStrategy: PromptingStrategy, aggressivenessLevel: AggressivenessLevel) => {
				mockModelService.setSelectedConfig({ promptingStrategy });
				await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabAggressivenessLevel, aggressivenessLevel);
				streamingFetcher.setStreamingLines(lines);

				const gen = createProvider().provideNextEdit(createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' }), createMockLogger(), createLogContext(), CancellationToken.None);
				await AsyncIterUtils.drainUntilReturn(gen);

				const messages = streamingFetcher.capturedOptions.at(-1)?.messages;
				const userMessage = messages?.find(message => message.role === Raw.ChatRole.User);
				expect(userMessage).toBeDefined();
				return getMessageText(userMessage!);
			};

			const nonAggressiveLow = await captureUserPrompt(PromptingStrategy.Xtab275, AggressivenessLevel.Low);
			const nonAggressiveHigh = await captureUserPrompt(PromptingStrategy.Xtab275, AggressivenessLevel.High);
			const aggressiveLow = await captureUserPrompt(PromptingStrategy.XtabAggressiveness, AggressivenessLevel.Low);
			const aggressiveHigh = await captureUserPrompt(PromptingStrategy.XtabAggressiveness, AggressivenessLevel.High);

			expect({
				nonAggressivePromptsMatch: nonAggressiveLow === nonAggressiveHigh,
				nonAggressivePromptHasLevel: nonAggressiveLow.includes('<|aggressive|>'),
				aggressiveLowHasLevel: aggressiveLow.includes('<|aggressive|>low<|/aggressive|>'),
				aggressiveHighHasLevel: aggressiveHigh.includes('<|aggressive|>high<|/aggressive|>'),
			}).toEqual({
				nonAggressivePromptsMatch: true,
				nonAggressivePromptHasLevel: false,
				aggressiveLowHasLevel: true,
				aggressiveHighHasLevel: true,
			});
		});

		it('retries with default model after NotFound response', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.NotFound,
				reason: 'test',
				requestId: 'req-1',
				serverRequestId: undefined,
			});
			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			await AsyncIterUtils.drainUntilReturn(gen);

			expect(streamingFetcher.callCount).toBe(2);
		});

		it('does not loop infinitely on repeated NotFound', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			const notFoundResponse = {
				type: ChatFetchResponseType.NotFound as const,
				reason: 'test',
				requestId: 'req-1',
				serverRequestId: undefined,
			};
			streamingFetcher.enqueueResponse(notFoundResponse);
			streamingFetcher.enqueueResponse(notFoundResponse);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.FetchFailure);
			expect(streamingFetcher.callCount).toBe(2);
		});

		it('returns NoSuggestions when response contains no choices', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.Unknown,
				reason: RESPONSE_CONTAINED_NO_CHOICES,
				requestId: 'req-1',
				serverRequestId: undefined,
			});

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('returns FetchFailure for Unknown response with a different reason', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.Unknown,
				reason: 'some other error',
				requestId: 'req-1',
				serverRequestId: undefined,
			});

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.FetchFailure);
		});
	});


	describe('global budget', () => {

		async function captureUserPrompt(provider: XtabProvider, request: StatelessNextEditRequest): Promise<string> {
			streamingFetcher.setStreamingLines(['x']);
			const capturesBefore = streamingFetcher.capturedOptions.length;
			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			await AsyncIterUtils.drainUntilReturn(gen);
			expect(streamingFetcher.capturedOptions.length).toBeGreaterThan(capturesBefore);
			const messages = streamingFetcher.capturedOptions.at(-1)?.messages;
			const userMessage = messages?.find(m => m.role === Raw.ChatRole.User);
			expect(userMessage).toBeDefined();
			return getMessageText(userMessage!);
		}

		function currentFileRegionLineCount(prompt: string): number {
			const start = prompt.indexOf(PromptTags.CURRENT_FILE.start);
			const end = prompt.indexOf(PromptTags.CURRENT_FILE.end);
			expect(start).toBeGreaterThanOrEqual(0);
			expect(end).toBeGreaterThan(start);
			return prompt.slice(start, end).split('\n').length;
		}

		const bigFile = Array.from({ length: 400 }, (_, i) => `const value${i} = ${i};`);

		// Under a global budget the current file is clipped LAST, so it absorbs whatever
		it('absorbs leftover cascade budget so it keeps more of the current file than the legacy cap', async () => {
			const legacy = await captureUserPrompt(createProvider(), createRequestWithEdit(bigFile, { insertionOffset: 3, insertedText: 'a' }));

			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabGlobalBudget, '{}');
			const enabledAtDefault = await captureUserPrompt(createProvider(), createRequestWithEdit(bigFile, { insertionOffset: 3, insertedText: 'a' }));

			expect(legacy).not.toContain('const value399 = 399;');
			expect(enabledAtDefault).toContain('const value399 = 399;');
			expect(currentFileRegionLineCount(legacy)).toBeLessThan(currentFileRegionLineCount(enabledAtDefault));
		});

		it('keeps more of the current file as the total budget grows', async () => {
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabGlobalBudget, JSON.stringify({ totalTokens: 2000 }));
			const smallBudget = await captureUserPrompt(createProvider(), createRequestWithEdit(bigFile, { insertionOffset: 3, insertedText: 'a' }));

			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabGlobalBudget, JSON.stringify({ totalTokens: 8000 }));
			const wideBudget = await captureUserPrompt(createProvider(), createRequestWithEdit(bigFile, { insertionOffset: 3, insertedText: 'a' }));

			expect(smallBudget).not.toContain('const value399 = 399;');
			expect(wideBudget).toContain('const value399 = 399;');
			expect(currentFileRegionLineCount(smallBudget)).toBeLessThan(currentFileRegionLineCount(wideBudget));
		});
	});

	describe('filter pipeline', () => {
		it('filters out import-only changes', async () => {
			const provider = createProvider();

			const lines = [
				'import { foo } from "bar";',
				'',
				'function main() {',
				'  foo();',
				'}',
			];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 5,
				insertedText: 'x',
				languageId: 'typescript',
			});

			const responseLines = [...lines];
			responseLines[0] = 'import { foo, baz } from "bar";';
			streamingFetcher.setStreamingLines(responseLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			expect(edits.length).toBe(0);
		});

		it('allows import-only changes when model config allows them', async () => {
			const provider = createProvider();
			mockModelService.setSelectedConfig({ allowImportChanges: ImportChanges.All });

			const lines = [
				'import { foo } from "bar";',
				'',
				'function main() {',
				'  foo();',
				'}',
			];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 5,
				insertedText: 'x',
				languageId: 'typescript',
			});

			const responseLines = [...lines];
			responseLines[0] = 'import { foo, baz } from "bar";';
			streamingFetcher.setStreamingLines(responseLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
		});

		it('passes through substantive code edits', async () => {
			const provider = createProvider();

			const lines = [
				'function main() {',
				'  return 1;',
				'}',
			];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 30,
				insertedText: 'x',
			});

			const responseLines = [
				'function main() {',
				'  return 42;',
				'}',
			];
			streamingFetcher.setStreamingLines(responseLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
		});

		it('filters out whitespace-only changes by default', async () => {
			const provider = createProvider();

			const lines = [
				'function main() {',
				'    return 1;',
				'}',
			];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 20,
				insertedText: ' ',
			});

			const responseLines = [
				'function main() {',
				'  return 1;',
				'}',
			];
			streamingFetcher.setStreamingLines(responseLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			expect(edits.length).toBe(0);
		});

		it('allows whitespace-only changes when config enables them', async () => {
			const provider = createProvider();
			await configService.setConfig(ConfigKey.InlineEditsAllowWhitespaceOnlyChanges, true);

			const lines = [
				'function main() {',
				'  const a  =  1;',
				'}',
			];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 20,
				insertedText: ' ',
			});

			const responseLines = [
				'function main() {',
				'  const a = 1;',
				'}',
			];
			streamingFetcher.setStreamingLines(responseLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
		});
	});


	describe('response format handling', () => {
		it('EditWindowOnly: streams edit directly through diff pipeline', async () => {
			const provider = createProvider();

			mockModelService.setSelectedConfig({ promptingStrategy: undefined });

			const lines = [
				'function hello() {',
				'  console.log("hello");',
				'}',
			];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 25,
				insertedText: 'x',
			});

			const responseLines = [
				'function hello() {',
				'  console.log("world");',
				'}',
			];
			streamingFetcher.setStreamingLines(responseLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			const firstEdit = edits[0].v.edit;
			expect(firstEdit.newLines.some(line => line.includes('world'))).toBe(true);
		});

		it('UnifiedWithXml NO_CHANGE triggers cursor jump path (returns NoSuggestions when disabled)', async () => {
			const provider = createProvider();

			mockModelService.setSelectedConfig({
				promptingStrategy: PromptingStrategy.UnifiedModel,
			});

			await configService.setConfig(ConfigKey.InlineEditsNextCursorPredictionEnabled, false);

			const lines = ['const a = 1;', 'const b = 2;'];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 5,
				insertedText: 'x',
			});

			streamingFetcher.setStreamingLines(['<NO_CHANGE>']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('CustomDiffPatch clamps tagged content range to the source document', async () => {
			const provider = createProvider();
			mockModelService.setSelectedConfig({
				promptingStrategy: PromptingStrategy.PatchBased02,
				includeTagsInCurrentFile: true,
			});

			const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'e' });
			streamingFetcher.setStreamingLines([]);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect({
				editCount: edits.length,
				finalReason: finalReason.v.constructor.name,
			}).toEqual({
				editCount: 0,
				finalReason: NoNextEditReason.NoSuggestions.name,
			});
		});

		it('UnifiedWithXml INSERT yields insertion edit at cursor line', async () => {
			const provider = createProvider();

			mockModelService.setSelectedConfig({
				promptingStrategy: PromptingStrategy.UnifiedModel,
			});

			const lines = ['const a = 1;', 'const b = 2;', 'const c = 3;'];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 5,
				insertedText: 'x',
			});

			streamingFetcher.setStreamingLines([
				'<INSERT>',
				' + additional',
				'</INSERT>',
			]);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
		});

		it('UnifiedWithXml EDIT response streams through diff pipeline', async () => {
			const provider = createProvider();

			mockModelService.setSelectedConfig({
				promptingStrategy: PromptingStrategy.UnifiedModel,
			});

			const lines = ['const a = 1;', 'const b = 2;', 'const c = 3;'];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 5,
				insertedText: 'x',
			});

			streamingFetcher.setStreamingLines([
				'<EDIT>',
				'const a = 42;',
				'const b = 2;',
				'const c = 3;',
				'</EDIT>',
			]);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			const firstEdit = edits[0].v.edit;
			expect(firstEdit.newLines.some(line => line.includes('42'))).toBe(true);
		});

		it('UnifiedWithXml unexpected tag returns Unexpected error', async () => {
			const provider = createProvider();

			mockModelService.setSelectedConfig({
				promptingStrategy: PromptingStrategy.UnifiedModel,
			});

			const lines = ['const a = 1;'];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 5,
				insertedText: 'x',
			});

			streamingFetcher.setStreamingLines(['<UNKNOWN_TAG>']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.Unexpected);
		});

		it('EditWindowWithEditIntent: high intent passes through', async () => {
			const provider = createProvider();

			mockModelService.setSelectedConfig({
				promptingStrategy: PromptingStrategy.Xtab275EditIntent,
			});

			const lines = [
				'function hello() {',
				'  return 1;',
				'}',
			];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 25,
				insertedText: 'x',
			});

			const responseLines = [
				'<|edit_intent|>high<|/edit_intent|>',
				'function hello() {',
				'  return 42;',
				'}',
			];
			streamingFetcher.setStreamingLines(responseLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
		});

		it('EditWindowWithEditIntent: no_edit intent filters out edit', async () => {
			const provider = createProvider();

			mockModelService.setSelectedConfig({
				promptingStrategy: PromptingStrategy.Xtab275EditIntent,
			});

			const lines = [
				'function hello() {',
				'  return 1;',
				'}',
			];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 25,
				insertedText: 'x',
			});

			const responseLines = [
				'<|edit_intent|>no_edit<|/edit_intent|>',
				'function hello() {',
				'  return 42;',
				'}',
			];
			streamingFetcher.setStreamingLines(responseLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.FilteredOut);
		});

		it('EditWindowWithEditIntentShort: H passes through', async () => {
			const provider = createProvider();

			mockModelService.setSelectedConfig({
				promptingStrategy: PromptingStrategy.Xtab275EditIntentShort,
			});

			const lines = [
				'function hello() {',
				'  return 1;',
				'}',
			];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 25,
				insertedText: 'x',
			});

			const responseLines = [
				'H',
				'function hello() {',
				'  return 42;',
				'}',
			];
			streamingFetcher.setStreamingLines(responseLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
		});

		it('EditWindowWithEditIntentShort: N short name filters no_edit', async () => {
			const provider = createProvider();

			mockModelService.setSelectedConfig({
				promptingStrategy: PromptingStrategy.Xtab275EditIntentShort,
			});

			const lines = [
				'function hello() {',
				'  return 1;',
				'}',
			];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 25,
				insertedText: 'x',
			});

			const responseLines = [
				'N',
				'function hello() {',
				'  return 42;',
				'}',
			];
			streamingFetcher.setStreamingLines(responseLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.FilteredOut);
		});

		it('empty response returns NoSuggestions', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;'];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 5,
				insertedText: 'x',
			});

			streamingFetcher.setStreamingLines([]);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('identical response (no diff) returns NoSuggestions', async () => {
			const provider = createProvider();

			await configService.setConfig(ConfigKey.InlineEditsNextCursorPredictionEnabled, false);

			const lines = ['function hello() {', '  return 1;', '}'];
			const request = createRequestWithEdit(lines, { insertionOffset: 5 });

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});
	});


	describe('cursor jump retry logic', () => {
		it('no edits + cursor prediction disabled → returns NoSuggestions', async () => {
			const provider = createProvider();
			await configService.setConfig(ConfigKey.InlineEditsNextCursorPredictionEnabled, false);

			const lines = ['line 0', 'line 1', 'line 2'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3 });

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('no edits + cursor prediction enabled + user typed during request → skips cursor prediction', async () => {
			const provider = createProvider();
			await configService.setConfig(ConfigKey.InlineEditsNextCursorPredictionEnabled, true);
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsNextCursorPredictionModelName, 'test-model');

			const lines = ['line 0', 'line 1', 'line 2'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3 });

			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(0), 'x')
			);

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
			expect(streamingFetcher.callCount).toBe(1);
		});

		it('no edits + cursor prediction enabled + intermediateUserEdit undefined → skips cursor prediction', async () => {
			const provider = createProvider();
			await configService.setConfig(ConfigKey.InlineEditsNextCursorPredictionEnabled, true);
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsNextCursorPredictionModelName, 'test-model');

			const lines = ['line 0', 'line 1', 'line 2'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3 });

			request.intermediateUserEdit = undefined;

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
			expect(streamingFetcher.callCount).toBe(1);
		});

		it('same-file cursor jump with edit: retry yields edits with isFromCursorJump', async () => {
			const provider = createProvider();
			await configService.setConfig(ConfigKey.InlineEditsNextCursorPredictionEnabled, true);
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsNextCursorPredictionModelName, 'test-model');

			const lines = Array.from({ length: 30 }, (_, i) => `line ${i} content`);
			const cursorOffset = lines.slice(0, 5).join('\n').length;
			const request = createRequestWithEdit(lines, {
				insertionOffset: cursorOffset,
			});

			const mainEditWindowLines = lines.slice(3, 11);
			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.Success,
				requestId: 'req-main',
				serverRequestId: 'srv-main',
				usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
				value: mainEditWindowLines.join('\n'),
				resolvedModel: 'test-model',
			});

			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.Success,
				requestId: 'req-cursor',
				serverRequestId: 'srv-cursor',
				usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
				value: '20',
				resolvedModel: 'test-model',
			});

			const retryEditWindowLines = lines.slice(18, 26).map((l, i) => i === 2 ? 'MODIFIED line 20 content' : l);
			streamingFetcher.setStreamingLines(retryEditWindowLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			for (const edit of edits) {
				expect(edit.v.isFromCursorJump).toBe(true);
			}
			for (const edit of edits) {
				expect(edit.v.originalWindow).toBeDefined();
			}
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
			expect(streamingFetcher.callCount).toBe(3);
		});

		it('cursor jump retry does not double-retry when second call also yields no edits', async () => {
			const provider = createProvider();
			await configService.setConfig(ConfigKey.InlineEditsNextCursorPredictionEnabled, true);
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsNextCursorPredictionModelName, 'test-model');

			const lines = Array.from({ length: 30 }, (_, i) => `line ${i} content`);
			const cursorOffset = lines.slice(0, 5).join('\n').length;
			const request = createRequestWithEdit(lines, {
				insertionOffset: cursorOffset,
			});

			const mainEditWindowLines = lines.slice(3, 11);
			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.Success,
				requestId: 'req-main',
				serverRequestId: 'srv-main',
				usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
				value: mainEditWindowLines.join('\n'),
				resolvedModel: 'test-model',
			});

			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.Success,
				requestId: 'req-cursor',
				serverRequestId: 'srv-cursor',
				usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
				value: '20',
				resolvedModel: 'test-model',
			});

			const retryEditWindowLines = lines.slice(18, 26);
			streamingFetcher.setStreamingLines(retryEditWindowLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
			expect(streamingFetcher.callCount).toBe(3);
		});

		it('cross-file cursor jump with out-of-bounds predicted line → NoSuggestions without throwing', async () => {
			const provider = createProvider();
			await configService.setConfig(ConfigKey.InlineEditsNextCursorPredictionEnabled, true);
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsNextCursorPredictionModelName, 'test-model');

			const lines = Array.from({ length: 30 }, (_, i) => `line ${i} content`);
			const cursorOffset = lines.slice(0, 5).join('\n').length;
			const request = createRequestWithEdit(lines, { insertionOffset: cursorOffset });

			const mainEditWindowLines = lines.slice(3, 11);
			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.Success,
				requestId: 'req-main',
				serverRequestId: 'srv-main',
				usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
				value: mainEditWindowLines.join('\n'),
				resolvedModel: 'test-model',
			});

			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.Success,
				requestId: 'req-cursor',
				serverRequestId: 'srv-cursor',
				usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } },
				value: '/test/other.ts:50',
				resolvedModel: 'test-model',
			});

			const targetDoc = createTextDocumentData(
				URI.file('/test/other.ts'),
				Array.from({ length: 5 }, (_, i) => `other ${i}`).join('\n'),
				'typescript',
			).document;
			const workspaceService = instaService.invokeFunction(accessor => accessor.get(IWorkspaceService));
			const openSpy = vi.spyOn(workspaceService, 'openTextDocument').mockResolvedValue(targetDoc);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
			expect(streamingFetcher.callCount).toBe(2);
			expect(openSpy).toHaveBeenCalledOnce();

			openSpy.mockRestore();
		});

		it('model fallback retry on NotFound then yields edits on second attempt', async () => {
			const provider = createProvider();

			const lines = ['function foo() {', '  return 1;', '}'];
			const request = createRequestWithEdit(lines, { insertionOffset: 5 });

			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.NotFound,
				reason: 'test',
				requestId: 'req-1',
				serverRequestId: undefined,
			});

			const modifiedLines = ['function foo() {', '  return 42;', '}'];
			streamingFetcher.setStreamingLines(modifiedLines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			for (const edit of edits) {
				expect(edit.v.isFromCursorJump).toBe(false);
			}
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
			expect(streamingFetcher.callCount).toBe(2);
		});

		it('model fallback + identical content → NoSuggestions without looping', async () => {
			const provider = createProvider();
			await configService.setConfig(ConfigKey.InlineEditsNextCursorPredictionEnabled, false);

			const lines = ['const a = 1;', 'const b = 2;', 'const c = 3;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3 });

			streamingFetcher.enqueueResponse({
				type: ChatFetchResponseType.NotFound,
				reason: 'test',
				requestId: 'req-1',
				serverRequestId: undefined,
			});

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
			expect(streamingFetcher.callCount).toBe(2);
		});
	});


	describe('debounce behavior', () => {
		it('does not change timing for a non-aggressiveness strategy when user eagerness is default', async () => {
			mockModelService.setSelectedConfig({ promptingStrategy: PromptingStrategy.Xtab275 });
			const setBaseDebounceTime = vi.spyOn(DelaySession.prototype, 'setBaseDebounceTime');
			const setExpectedTotalTime = vi.spyOn(DelaySession.prototype, 'setExpectedTotalTime');

			try {
				const lines = ['const x = 1;', 'const y = 2;'];
				streamingFetcher.setStreamingLines(lines);
				const gen = createProvider().provideNextEdit(createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' }), createMockLogger(), createLogContext(), CancellationToken.None);
				await AsyncIterUtils.drainUntilReturn(gen);

				expect({
					setBaseDebounceTimeCalls: setBaseDebounceTime.mock.calls.length,
					setExpectedTotalTimeCalls: setExpectedTotalTime.mock.calls.length,
				}).toEqual({
					setBaseDebounceTimeCalls: 0,
					setExpectedTotalTimeCalls: 0,
				});
			} finally {
				setBaseDebounceTime.mockRestore();
				setExpectedTotalTime.mockRestore();
			}
		});

		it('debounce is skipped in simulation tests', async () => {
			const testingServiceCollection = createExtensionUnitTestingServices(disposables);
			testingServiceCollection.set(IInlineEditsModelService, mockModelService);
			streamingFetcher = new StreamingMockChatMLFetcher();
			testingServiceCollection.set(IChatMLFetcher, streamingFetcher);
			testingServiceCollection.set(ISimulationTestContext, {
				isInSimulationTests: true,
				_serviceBrand: undefined,
				writeFile: async () => '',
			} satisfies ISimulationTestContext);

			const accessor2 = disposables.add(testingServiceCollection.createTestingAccessor());
			const simProvider = accessor2.get(IInstantiationService).createInstance(XtabProvider);

			const lines = ['const x = 1;', 'const y = 2;'];
			const doc = makeDocumentWithEdit(lines, { insertionOffset: 5, insertedText: 'a' });
			const beforeText = new StringText(doc.documentBeforeEdits.value);
			const request = new StatelessNextEditRequest(
				'req-sim', 'opp-sim', beforeText, [doc], 0,
				[{ docId: doc.id, kind: 'visibleRanges', visibleRanges: [new OffsetRange(0, 100)], documentContent: doc.documentAfterEdits }],
				new DeferredPromise<Result<unknown, NoNextEditReason>>(), undefined,
				false,
				createLogContext(), undefined, undefined, Date.now(),
			);

			streamingFetcher.setStreamingLines(['const x = 42;', 'const y = 2;']);

			const startTime = Date.now();
			const gen = simProvider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			await AsyncIterUtils.drainUntilReturn(gen);
			const elapsed = Date.now() - startTime;

			expect(elapsed).toBeLessThan(5000);
		});

		it('does not apply extra debounce for speculative requests even when cursor is at end of line', async () => {
			const provider = createProvider();
			const spy = vi.spyOn(DelaySession.prototype, 'setExtraDebounce');

			const request = createRequestWithEdit(['const x = 1;'], { insertionOffset: 12, isSpeculative: true });
			streamingFetcher.setStreamingLines(['const x = 42;']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			await AsyncIterUtils.drainUntilReturn(gen);

			expect(spy).not.toHaveBeenCalled();
			spy.mockRestore();
		});

		it('applies extra debounce for non-speculative requests when cursor is at end of line', async () => {
			const provider = createProvider();
			const spy = vi.spyOn(DelaySession.prototype, 'setExtraDebounce');

			const request = createRequestWithEdit(['const x = 1;'], { insertionOffset: 12, isSpeculative: false });
			streamingFetcher.setStreamingLines(['const x = 42;']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			await AsyncIterUtils.drainUntilReturn(gen);

			expect(spy).toHaveBeenCalled();
			spy.mockRestore();
		});

		it('cancellation during debounce exits early with GotCancelled before LLM fetch', async () => {
			const debounceMs = 500;
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsDebounce, debounceMs);

			const provider = createProvider();
			const lines = ['function foo() {', '  return 1;', '}'];
			const request = createRequestWithEdit(lines, { insertionOffset: 5, insertedText: 'c' });
			streamingFetcher.setStreamingLines(lines);

			const cts = new CancellationTokenSource();
			vi.useFakeTimers();
			try {
				const genPromise = AsyncIterUtils.drainUntilReturn(
					provider.provideNextEdit(request, createMockLogger(), createLogContext(), cts.token)
				);

				await vi.advanceTimersByTimeAsync(0);
				cts.cancel();

				const finalValue = await genPromise;

				expect(finalValue.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect(streamingFetcher.callCount).toBe(0);
			} finally {
				vi.useRealTimers();
				cts.dispose();
			}
		});

		it('pre-cancelled token resolves without waiting for debounce', async () => {
			const debounceMs = 500;
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsDebounce, debounceMs);

			const provider = createProvider();
			const lines = ['function foo() {', '  return 1;', '}'];
			const request = createRequestWithEdit(lines, { insertionOffset: 5, insertedText: 'c' });
			streamingFetcher.setStreamingLines(lines);

			const cts = new CancellationTokenSource();
			cts.cancel();

			vi.useFakeTimers();
			try {
				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), cts.token);
				const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

				expect(finalValue.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
			} finally {
				vi.useRealTimers();
				cts.dispose();
			}
		});
	});


	describe('fetch failure handling', () => {
		it('maps RateLimited error to Uncategorized', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			streamingFetcher.setErrorResponse({
				type: ChatFetchResponseType.RateLimited,
				reason: 'test',
				requestId: 'req-1',
				serverRequestId: undefined,
				retryAfter: undefined,
				rateLimitKey: 'test',
				isAuto: false,
			});

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.Uncategorized);
		});

		it('maps NetworkError to FetchFailure', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			streamingFetcher.setErrorResponse({
				type: ChatFetchResponseType.NetworkError,
				reason: 'test',
				requestId: 'req-1',
				serverRequestId: undefined,
			});

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.FetchFailure);
		});

		it('maps Canceled to GotCancelled', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			streamingFetcher.setErrorResponse({
				type: ChatFetchResponseType.Canceled,
				reason: 'test',
				requestId: 'req-1',
				serverRequestId: undefined,
			});

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const finalValue = await AsyncIterUtils.drainUntilReturn(gen);

			expect(finalValue.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
		});
	});


	describe('prompt construction', () => {
		it('system prompt matches the configured prompting strategy', async () => {
			const strategies: [PromptingStrategy, string][] = [
				[PromptingStrategy.UnifiedModel, unifiedModelSystemPrompt],
				[PromptingStrategy.SimplifiedSystemPrompt, simplifiedPrompt],
				[PromptingStrategy.Xtab275, xtab275SystemPrompt],
				[PromptingStrategy.Nes41Miniv3, nes41Miniv3SystemPrompt],
			];

			for (const [strategy, expectedSystemPrompt] of strategies) {
				const provider = createProvider();
				mockModelService.setSelectedConfig({ promptingStrategy: strategy });

				const lines = ['const x = 1;', 'const y = 2;'];
				const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

				streamingFetcher.setStreamingLines(lines);
				streamingFetcher.resetTracking();

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				await AsyncIterUtils.drainUntilReturn(gen);

				const captured = streamingFetcher.capturedOptions[0];
				expect(captured).toBeDefined();
				const systemMsg = captured.messages.find(m => m.role === Raw.ChatRole.System);
				expect(systemMsg).toBeDefined();
				expect(getMessageText(systemMsg!)).toBe(expectedSystemPrompt);
			}
		});

		it('prompt has system and user messages', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;', 'const y = 2;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			await AsyncIterUtils.drainUntilReturn(gen);

			const captured = streamingFetcher.capturedOptions[0];
			expect(captured).toBeDefined();
			const roles = captured.messages.map(m => m.role);
			expect(roles).toContain(Raw.ChatRole.System);
			expect(roles).toContain(Raw.ChatRole.User);
		});

		it('request sets temperature to 0', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			await AsyncIterUtils.drainUntilReturn(gen);

			const captured = streamingFetcher.capturedOptions[0];
			expect(captured.requestOptions?.temperature).toBe(0);
		});

		it('request enables streaming', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;'];
			const request = createRequestWithEdit(lines, { insertionOffset: 3, insertedText: 'a' });

			streamingFetcher.setStreamingLines(lines);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			await AsyncIterUtils.drainUntilReturn(gen);

			const captured = streamingFetcher.capturedOptions[0];
			expect(captured.requestOptions?.stream).toBe(true);
		});
	});


	describe('cursor-line divergence cancellation', () => {

		function createDivergenceRequest(
			docAtRequestTime: string[],
			opts: { insertionOffset: number; insertedText: string },
		): StatelessNextEditRequest {
			const base = createRequestWithEdit(docAtRequestTime, opts);
			return new StatelessNextEditRequest(
				base.headerRequestId,
				base.opportunityId,
				new StringText(docAtRequestTime.join('\n')),
				base.documents,
				base.activeDocumentIdx,
				base.xtabEditHistory,
				new DeferredPromise<Result<unknown, NoNextEditReason>>(),
				base.expandedEditWindowNLines,
				base.isSpeculative,
				base.logContext,
				base.recordingBookmark,
				base.recording,
				base.providerRequestStartDateTime,
			);
		}

		beforeEach(async () => {
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabEarlyCursorLineDivergenceCancellation, EarlyDivergenceCancellationMode.Cursor);
		});

		it('cancels when user typed a character that diverges from model output', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['function fi'],
				{ insertionOffset: 10, insertedText: 'i' },
			);
			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(11), 'x')
			);

			streamingFetcher.setStreamingLines(['function fibonacci(n: number): number']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
			expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('cursorLineDiverged');
		});

		it('does not cancel when user typed a character consistent with model output', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['function fi'],
				{ insertionOffset: 10, insertedText: 'i' },
			);
			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(11), 'b')
			);

			streamingFetcher.setStreamingLines(['function fibonacci(n: number): number']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('does not cancel when user has not typed since request started', async () => {
			const provider = createProvider();

			const lines = ['function foo() {', '  return 1;', '}'];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 3,
				insertedText: 'c',
			});


			streamingFetcher.setStreamingLines(['function bar() {', '  return 2;', '}']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('does not cancel when intermediateUserEdit is undefined (consistency check failed)', async () => {
			const provider = createProvider();

			const lines = ['const x = 1;', 'const y = 2;'];
			const request = createRequestWithEdit(lines, {
				insertionOffset: 3,
				insertedText: 'a',
			});

			request.intermediateUserEdit = undefined;

			streamingFetcher.setStreamingLines(['completely different', 'content here']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.NoSuggestions);
		});

		it('does not cancel the request token (only the internal fetch token)', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['hello world'],
				{ insertionOffset: 5, insertedText: ' ' },
			);

			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(11), 'Z')
			);

			streamingFetcher.setStreamingLines(['hello worlQ completely different']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { finalReason } = await collectEdits(gen);

			expect(request.cancellationTokenSource.token.isCancellationRequested).toBe(false);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
			expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('cursorLineDiverged');
		});

		it('does not false-cancel when user inserted a line above the cursor', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['import foo', 'function fi', '}'],
				{ insertionOffset: 21, insertedText: 'i' },
			);

			request.intermediateUserEdit = StringEdit.create([
				new StringReplacement(OffsetRange.emptyAt(10), '\n'),
				new StringReplacement(OffsetRange.emptyAt(22), 'b'),
			]);

			streamingFetcher.setStreamingLines(['import foo', 'function fibonacci(n): number', '}']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { finalReason } = await collectEdits(gen);

			if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
				expect(finalReason.v.message).not.toBe('cursorLineDiverged');
			}
		});

		it('cancels on divergence when cursor is not on the first line of the edit window', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['const a = 1;', 'function fi', '}'],
				{ insertionOffset: 23, insertedText: 'i' },
			);

			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(24), 'x')
			);

			streamingFetcher.setStreamingLines(['const a = 1;', 'function fibonacci(n): number', '}']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
			expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('cursorLineDiverged');
		});

		it('does not cancel on compatible typing when cursor is not on the first line', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['const a = 1;', 'function fi', '}'],
				{ insertionOffset: 23, insertedText: 'i' },
			);

			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(24), 'b')
			);

			streamingFetcher.setStreamingLines(['const a = 1;', 'function fibonacci(n): number', '}']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { finalReason } = await collectEdits(gen);

			if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
				expect(finalReason.v.message).not.toBe('cursorLineDiverged');
			}
		});

		it('does not cancel when feature is disabled, even with divergent typing', async () => {
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabEarlyCursorLineDivergenceCancellation, EarlyDivergenceCancellationMode.Off);

			const provider = createProvider();

			const request = createDivergenceRequest(
				['function fi'],
				{ insertionOffset: 10, insertedText: 'i' },
			);
			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(11), 'x')
			);

			streamingFetcher.setStreamingLines(['function fibonacci(n: number): number']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
				expect(finalReason.v.message).not.toBe('cursorLineDiverged');
			}
		});

		it('does not cancel when model output is shorter than edit window (cursor line never reached)', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['line0', 'line1', 'line2'],
				{ insertionOffset: 16, insertedText: '2' },
			);
			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(17), 'Z')
			);

			streamingFetcher.setStreamingLines(['line0', 'COMPLETELY DIFFERENT']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { finalReason } = await collectEdits(gen);

			if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
				expect(finalReason.v.message).not.toBe('cursorLineDiverged');
			}
		});

		it('does not cancel when getCurrentCursorLine returns undefined (ambiguous mapping)', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['aaa', 'bbb'],
				{ insertionOffset: 4, insertedText: 'b' },
			);

			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(new OffsetRange(2, 6), 'Z')
			);

			streamingFetcher.setStreamingLines(['aaa', 'COMPLETELY DIFFERENT']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { finalReason } = await collectEdits(gen);

			if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
				expect(finalReason.v.message).not.toBe('cursorLineDiverged');
			}
		});

		it('does not cancel when user edit results in same content as original (net-zero)', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['hello world'],
				{ insertionOffset: 5, insertedText: ' ' },
			);

			request.intermediateUserEdit = StringEdit.empty;

			streamingFetcher.setStreamingLines(['COMPLETELY DIFFERENT']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
				expect(finalReason.v.message).not.toBe('cursorLineDiverged');
			}
		});

		it('yields edits for lines before cursor, then cancels at divergent cursor line', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['const a = 1;', 'function fi', '}'],
				{ insertionOffset: 23, insertedText: 'i' },
			);
			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(24), 'x')
			);

			streamingFetcher.setStreamingLines(['const b = 2;', 'function fibonacci(n): number', '}']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { finalReason } = await collectEdits(gen);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
			expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('cursorLineDiverged');
		});

		it('compatible with auto-close pair typing end-to-end', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['foo'],
				{ insertionOffset: 2, insertedText: 'o' },
			);
			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(3), '()')
			);

			streamingFetcher.setStreamingLines(['foo(x, y)']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { finalReason } = await collectEdits(gen);

			if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
				expect(finalReason.v.message).not.toBe('cursorLineDiverged');
			}
		});

		it('backward compat: boolean true activates cursor-mode divergence', async () => {
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabEarlyCursorLineDivergenceCancellation, true as any);

			const provider = createProvider();

			const request = createDivergenceRequest(
				['function fi'],
				{ insertionOffset: 10, insertedText: 'i' },
			);
			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(11), 'x')
			);

			streamingFetcher.setStreamingLines(['function fibonacci(n: number): number']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBe(0);
			expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
			expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('cursorLineDiverged');
		});

		it('backward compat: boolean false disables divergence', async () => {
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabEarlyCursorLineDivergenceCancellation, false as any);

			const provider = createProvider();
			const request = createDivergenceRequest(
				['function fi'],
				{ insertionOffset: 10, insertedText: 'i' },
			);
			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(11), 'x')
			);

			streamingFetcher.setStreamingLines(['function fibonacci(n: number): number']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
				expect(finalReason.v.message).not.toBe('cursorLineDiverged');
			}
		});

		it('backward compat: undefined disables divergence', async () => {
			await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabEarlyCursorLineDivergenceCancellation, undefined as any);

			const provider = createProvider();
			const request = createDivergenceRequest(
				['function fi'],
				{ insertionOffset: 10, insertedText: 'i' },
			);
			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(11), 'x')
			);

			streamingFetcher.setStreamingLines(['function fibonacci(n: number): number']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { edits, finalReason } = await collectEdits(gen);

			expect(edits.length).toBeGreaterThan(0);
			if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
				expect(finalReason.v.message).not.toBe('cursorLineDiverged');
			}
		});

		describe('cursor mode — adversarial scenarios', () => {

			it('ignores divergence on line BEFORE the cursor', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['line0', 'line1', 'line2'],
					{ insertionOffset: 16, insertedText: '2' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(4), 'Z')
				);

				streamingFetcher.setStreamingLines(['line0', 'line1', 'line2']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('cursorLineDiverged');
				}
			});

			it('ignores divergence on line AFTER the cursor', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['line0', 'line1', 'line2'],
					{ insertionOffset: 4, insertedText: '0' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(16), 'Z')
				);

				streamingFetcher.setStreamingLines(['line0', 'line1', 'line2']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('cursorLineDiverged');
				}
			});

			it('detects divergence even when cursor is on the last line of the edit window', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb', 'ccc'],
					{ insertionOffset: 10, insertedText: 'c' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(11), 'X')
				);

				streamingFetcher.setStreamingLines(['aaa', 'bbb', 'cccY']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('cursorLineDiverged');
			});

			it('does not cancel when user deleted text on cursor line but model matches result', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['foobar'],
					{ insertionOffset: 5, insertedText: 'r' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(new OffsetRange(3, 6), '')
				);

				streamingFetcher.setStreamingLines(['foo']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('cursorLineDiverged');
				}
			});

			it('cancels when user replaced text on cursor line and model disagrees', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['hello world'],
					{ insertionOffset: 10, insertedText: 'd' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(new OffsetRange(6, 11), 'earth')
				);

				streamingFetcher.setStreamingLines(['hello mars']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('cursorLineDiverged');
			});

			it('does not cancel when user typed multiple compatible chars', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['let '],
					{ insertionOffset: 3, insertedText: ' ' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(4), 'abc')
				);

				streamingFetcher.setStreamingLines(['let abcdef = 1;']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('cursorLineDiverged');
				}
			});

			it('cancels when model produces empty line but user typed on cursor', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['foo'],
					{ insertionOffset: 2, insertedText: 'o' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(3), 'b')
				);

				streamingFetcher.setStreamingLines(['']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('cursorLineDiverged');
			});
		});

		describe('editWindow mode', () => {

			beforeEach(async () => {
				await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabEarlyCursorLineDivergenceCancellation, EarlyDivergenceCancellationMode.EditWindow);
			});


			it('cancels when user edited a non-cursor line that diverges from model', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['const a = 1;', 'function fi', '}'],
					{ insertionOffset: 23, insertedText: 'i' },
				);

				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(11), 'Z')
				);

				streamingFetcher.setStreamingLines(['const a = 1;', 'function fibonacci(n): number', '}']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { edits, finalReason } = await collectEdits(gen);

				expect(edits.length).toBe(0);
				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});

			it('cancels on cursor-line divergence in editWindow mode', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['function fi'],
					{ insertionOffset: 10, insertedText: 'i' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(11), 'x')
				);

				streamingFetcher.setStreamingLines(['function fibonacci(n: number): number']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { edits, finalReason } = await collectEdits(gen);

				expect(edits.length).toBe(0);
				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});


			it('does not cancel when user edited a non-cursor line compatibly with model', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['const a = 1;', 'function fi', '}'],
					{ insertionOffset: 23, insertedText: 'i' },
				);

				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(11), '2')
				);

				streamingFetcher.setStreamingLines(['const a = 123;', 'function fibonacci(n): number', '}']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});

			it('does not cancel when no lines were changed by user', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb', 'ccc'],
					{ insertionOffset: 4, insertedText: 'b' },
				);

				streamingFetcher.setStreamingLines(['COMPLETELY', 'DIFFERENT', 'LINES']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});

			it('does not cancel when intermediateUserEdit is undefined', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb'],
					{ insertionOffset: 4, insertedText: 'b' },
				);
				request.intermediateUserEdit = undefined;

				streamingFetcher.setStreamingLines(['COMPLETELY', 'DIFFERENT']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});

			it('does not cancel when all user edits across multiple lines are compatible', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['let a', 'let b', 'let c'],
					{ insertionOffset: 8, insertedText: 'b' },
				);
				request.intermediateUserEdit = StringEdit.create([
					new StringReplacement(OffsetRange.emptyAt(5), '1'),
					new StringReplacement(OffsetRange.emptyAt(17), '2'),
				]);

				streamingFetcher.setStreamingLines(['let a12 = 1;', 'let b', 'let c23 = 3;']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});


			it('cancels on divergence at the very first line (line 0)', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb', 'ccc'],
					{ insertionOffset: 5, insertedText: 'b' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(2), 'Z')
				);

				streamingFetcher.setStreamingLines(['aaa', 'bbb', 'ccc']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { edits, finalReason } = await collectEdits(gen);

				expect(edits.length).toBe(0);
				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});

			it('cancels on divergence at the very last line of the edit window', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb', 'ccc'],
					{ insertionOffset: 2, insertedText: 'a' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(10), 'Z')
				);

				streamingFetcher.setStreamingLines(['aaa', 'bbb', 'ccc']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});

			it('cancels at the first divergent line when multiple lines diverge', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb', 'ccc'],
					{ insertionOffset: 5, insertedText: 'b' },
				);
				request.intermediateUserEdit = StringEdit.create([
					new StringReplacement(OffsetRange.emptyAt(2), 'X'),
					new StringReplacement(OffsetRange.emptyAt(10), 'Y'),
				]);

				streamingFetcher.setStreamingLines(['aaa', 'bbb', 'ccc']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { edits, finalReason } = await collectEdits(gen);

				expect(edits.length).toBe(0);
				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});

			it('cancels on second line when first line is compatible but second diverges', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb', 'ccc'],
					{ insertionOffset: 10, insertedText: 'c' },
				);
				request.intermediateUserEdit = StringEdit.create([
					new StringReplacement(OffsetRange.emptyAt(3), 'b'),
					new StringReplacement(OffsetRange.emptyAt(6), 'Z'),
				]);

				streamingFetcher.setStreamingLines(['aaabcd', 'bbb', 'ccc']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});


			it('does not false-cancel when user inserted a line above, shifting lines down', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['import foo', 'function fi', '}'],
					{ insertionOffset: 21, insertedText: 'i' },
				);
				request.intermediateUserEdit = StringEdit.create([
					new StringReplacement(OffsetRange.emptyAt(10), '\n'),
					new StringReplacement(OffsetRange.emptyAt(22), 'b'),
				]);

				streamingFetcher.setStreamingLines(['import foo', 'function fibonacci(n): number', '}']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});

			it('cancels when user deleted a line above, causing content shift on other lines', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb', 'ccc', 'ddd'],
					{ insertionOffset: 14, insertedText: 'd' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(new OffsetRange(4, 8), '')
				);

				streamingFetcher.setStreamingLines(['aaa', 'bbb', 'ccc', 'ddd']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});


			it('skips divergence check for a line whose start offset falls inside a replacement', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb', 'ccc'],
					{ insertionOffset: 10, insertedText: 'c' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(new OffsetRange(2, 6), 'ZZ')
				);

				streamingFetcher.setStreamingLines(['aaZZb_more', 'ANYTHING', 'ccc']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});


			it('does not cancel when model output has fewer lines than edit window and divergent line is not reached', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['line0', 'line1', 'line2'],
					{ insertionOffset: 10, insertedText: '1' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(16), 'Z')
				);

				streamingFetcher.setStreamingLines(['line0', 'line1']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});


			it('cancels when user deleted text on a non-cursor line and model kept original', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['foobar', 'cursor'],
					{ insertionOffset: 7, insertedText: 'c' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(new OffsetRange(3, 6), '')
				);

				streamingFetcher.setStreamingLines(['foobar', 'cursor']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});

			it('does not cancel when user deleted text on non-cursor line and model matches result', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['foobar', 'cursor'],
					{ insertionOffset: 7, insertedText: 'c' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(new OffsetRange(3, 6), '')
				);

				streamingFetcher.setStreamingLines(['foo', 'cursor']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});

			it('cancels when user replaced text on non-cursor line and model disagrees', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['hello world', 'cursor'],
					{ insertionOffset: 13, insertedText: 'u' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(new OffsetRange(6, 11), 'earth')
				);

				streamingFetcher.setStreamingLines(['hello mars', 'cursor']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { edits, finalReason } = await collectEdits(gen);

				expect(edits.length).toBe(0);
				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});


			it('does not cancel when user typed auto-close pair on non-cursor line and model fills it', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['foo', 'cursor'],
					{ insertionOffset: 5, insertedText: 'u' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(3), '()')
				);

				streamingFetcher.setStreamingLines(['foo(x, y)', 'cursor']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});

			it('cancels when user typed auto-close pair on non-cursor line but model has no closing char', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['foo', 'cursor'],
					{ insertionOffset: 5, insertedText: 'u' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(3), '()')
				);

				streamingFetcher.setStreamingLines(['foo(x, y', 'cursor']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { edits, finalReason } = await collectEdits(gen);

				expect(edits.length).toBe(0);
				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});


			it('cancels on divergence in a single-line edit window', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['hello'],
					{ insertionOffset: 4, insertedText: 'o' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(5), 'X')
				);

				streamingFetcher.setStreamingLines(['helloY']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});

			it('does not cancel compatible edit in a single-line edit window', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['hello'],
					{ insertionOffset: 4, insertedText: 'o' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(5), ' w')
				);

				streamingFetcher.setStreamingLines(['hello world!']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});


			it('cancels when model produces empty line for a non-cursor line that user edited', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['foo', 'cursor'],
					{ insertionOffset: 5, insertedText: 'u' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(3), 'b')
				);

				streamingFetcher.setStreamingLines(['', 'cursor']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { edits, finalReason } = await collectEdits(gen);

				expect(edits.length).toBe(0);
				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});


			it('does not cancel when user edit is net-zero (typed then backspaced)', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb'],
					{ insertionOffset: 5, insertedText: 'b' },
				);
				request.intermediateUserEdit = StringEdit.empty;

				streamingFetcher.setStreamingLines(['COMPLETELY', 'DIFFERENT']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});


			it('does not cancel when user added indentation and model continues with same indent', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['return 1;', 'cursor'],
					{ insertionOffset: 11, insertedText: 'u' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(0), '  ')
				);

				streamingFetcher.setStreamingLines(['  return 42;', 'cursor']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});


			it('does not cancel the request token, only the internal fetch token', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['aaa', 'bbb'],
					{ insertionOffset: 5, insertedText: 'b' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(2), 'Z')
				);

				streamingFetcher.setStreamingLines(['aaa', 'bbb']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				expect(request.cancellationTokenSource.token.isCancellationRequested).toBe(false);
				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				expect((finalReason.v as NoNextEditReason.GotCancelled).message).toBe('editWindowLineDiverged');
			});


			it('does not cancel non-cursor line divergence in cursor mode', async () => {
				await configService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabEarlyCursorLineDivergenceCancellation, EarlyDivergenceCancellationMode.Cursor);

				const provider = createProvider();

				const request = createDivergenceRequest(
					['const a = 1;', 'function fi', '}'],
					{ insertionOffset: 23, insertedText: 'i' },
				);

				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(11), 'Z')
				);

				streamingFetcher.setStreamingLines(['const a = 1;', 'function fibonacci(n): number', '}']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
					expect(finalReason.v.message).not.toBe('cursorLineDiverged');
					expect(finalReason.v.message).not.toBe('editWindowLineDiverged');
				}
			});


			it('uses editWindowLineDiverged reason, not cursorLineDiverged', async () => {
				const provider = createProvider();

				const request = createDivergenceRequest(
					['abc'],
					{ insertionOffset: 2, insertedText: 'c' },
				);
				request.intermediateUserEdit = StringEdit.single(
					new StringReplacement(OffsetRange.emptyAt(3), 'X')
				);

				streamingFetcher.setStreamingLines(['abcY']);

				const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
				const { finalReason } = await collectEdits(gen);

				expect(finalReason.v).toBeInstanceOf(NoNextEditReason.GotCancelled);
				const msg = (finalReason.v as NoNextEditReason.GotCancelled).message;
				expect(msg).toBe('editWindowLineDiverged');
				expect(msg).not.toBe('cursorLineDiverged');
			});
		});

		it('does not cancel when user continues typing what the model predicted (class Poin → class Point vs class Point {)', async () => {
			const provider = createProvider();

			const request = createDivergenceRequest(
				['class Poin'],
				{ insertionOffset: 9, insertedText: 'n' },
			);
			request.intermediateUserEdit = StringEdit.single(
				new StringReplacement(OffsetRange.emptyAt(10), 't')
			);

			streamingFetcher.setStreamingLines(['class Point {']);

			const gen = provider.provideNextEdit(request, createMockLogger(), createLogContext(), CancellationToken.None);
			const { finalReason } = await collectEdits(gen);

			if (finalReason.v instanceof NoNextEditReason.GotCancelled) {
				expect(finalReason.v.message).not.toBe('cursorLineDiverged');
			}
		});
	});
});
suite('filterOutEditsWithSubstrings', () => {

	function makeEdit(newLines: string[]): LineReplacement {
		return new LineReplacement(new LineRange(1, 2), newLines);
	}

	test('should return all edits when no lines contain any forbidden substring', () => {
		const edits = [
			makeEdit(['const x = 1;']),
			makeEdit(['const y = 2;']),
		];
		const result = filterOutEditsWithSubstrings(edits, ['<|forbidden|>']);
		expect(result).toEqual(edits);
	});

	test('should filter out edits where a line contains a forbidden substring', () => {
		const kept = makeEdit(['const x = 1;']);
		const filtered = makeEdit(['<|current_file_content|>some text']);
		const result = filterOutEditsWithSubstrings([kept, filtered], ['<|current_file_content|>']);
		expect(result).toEqual([kept]);
	});

	test('should filter out edits matching any of multiple substrings', () => {
		const e1 = makeEdit(['hello world']);
		const e2 = makeEdit(['<|diff_marker|>']);
		const e3 = makeEdit(['<|current_file_content|>']);
		const result = filterOutEditsWithSubstrings([e1, e2, e3], ['<|diff_marker|>', '<|current_file_content|>']);
		expect(result).toEqual([e1]);
	});

	test('should filter out edit if any line in newLines contains a forbidden substring', () => {
		const edit = makeEdit(['line 1', '<|diff_marker|> line 2', 'line 3']);
		const result = filterOutEditsWithSubstrings([edit], ['<|diff_marker|>']);
		expect(result).toEqual([]);
	});

	test('should keep edit when lines are close to but do not match the substring', () => {
		const edit = makeEdit(['<|diff_marke|>']);
		const result = filterOutEditsWithSubstrings([edit], ['<|diff_marker|>']);
		expect(result).toEqual([edit]);
	});

	test('should return empty array when all edits are filtered out', () => {
		const edits = [
			makeEdit(['<|current_file_content|>']),
			makeEdit(['<|diff_marker|>']),
		];
		const result = filterOutEditsWithSubstrings(edits, ['<|current_file_content|>', '<|diff_marker|>']);
		expect(result).toEqual([]);
	});

	test('should return all edits when substringsToFilterOut is empty', () => {
		const edits = [
			makeEdit(['<|current_file_content|>']),
			makeEdit(['anything']),
		];
		const result = filterOutEditsWithSubstrings(edits, []);
		expect(result).toEqual(edits);
	});

	test('should handle empty edits array', () => {
		const result = filterOutEditsWithSubstrings([], ['<|diff_marker|>']);
		expect(result).toEqual([]);
	});

	test('should keep edits with empty newLines', () => {
		const edit = makeEdit([]);
		const result = filterOutEditsWithSubstrings([edit], ['<|diff_marker|>']);
		expect(result).toEqual([edit]);
	});
});

suite('getNextCursorColumn', () => {

	function colWithMarker(line: string | undefined): string {
		const column = XtabProvider.getNextCursorColumn(line);
		const s = line ?? '';
		return s.slice(0, column - 1) + '|' + s.slice(column - 1);
	}

	test('indented with spaces', () => {
		expect(colWithMarker('    const x = 1;')).toMatchInlineSnapshot(`"    |const x = 1;"`);
	});

	test('indented with tabs', () => {
		expect(colWithMarker('\t\treturn;')).toMatchInlineSnapshot(`"		|return;"`);
	});

	test('no leading whitespace', () => {
		expect(colWithMarker('function foo() {')).toMatchInlineSnapshot(`"|function foo() {"`);
	});

	test('empty string', () => {
		expect(colWithMarker('')).toMatchInlineSnapshot(`"|"`);
	});

	test('whitespace-only line', () => {
		expect(colWithMarker('   ')).toMatchInlineSnapshot(`"   |"`);
	});

	test('undefined', () => {
		expect(colWithMarker(undefined)).toMatchInlineSnapshot(`"|"`);
	});
});
