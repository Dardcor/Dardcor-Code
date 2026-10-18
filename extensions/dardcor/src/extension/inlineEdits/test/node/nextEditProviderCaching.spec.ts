/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { outdent } from 'outdent';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';
import { ConfigKey, ExperimentBasedConfig, ExperimentBasedConfigType, IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { IGitExtensionService } from '../../../../platform/git/common/gitExtensionService';
import { NullGitExtensionService } from '../../../../platform/git/common/nullGitExtensionService';
import { DocumentId } from '../../../../platform/inlineEdits/common/dataTypes/documentId';
import { InlineEditRequestLogContext } from '../../../../platform/inlineEdits/common/inlineEditLogContext';
import { ObservableGit } from '../../../../platform/inlineEdits/common/observableGit';
import { MutableObservableWorkspace } from '../../../../platform/inlineEdits/common/observableWorkspace';
import { IStatelessNextEditProvider, NoNextEditReason, StatelessNextEditRequest, StatelessNextEditTelemetryBuilder, WithStatelessProviderTelemetry } from '../../../../platform/inlineEdits/common/statelessNextEditProvider';
import { NesHistoryContextProvider } from '../../../../platform/inlineEdits/common/workspaceEditTracker/nesHistoryContextProvider';
import { NesXtabHistoryTracker } from '../../../../platform/inlineEdits/common/workspaceEditTracker/nesXtabHistoryTracker';
import { ILogger, ILogService, LogServiceImpl } from '../../../../platform/log/common/logService';
import { IRequestLogger } from '../../../../platform/requestLogger/common/requestLogger';
import { NullRequestLogger } from '../../../../platform/requestLogger/node/nullRequestLogger';
import { ISnippyService, NullSnippyService } from '../../../../platform/snippy/common/snippyService';
import { IExperimentationService, NullExperimentationService } from '../../../../platform/telemetry/common/nullExperimentationService';
import { mockNotebookService } from '../../../../platform/test/common/testNotebookService';
import { TestWorkspaceService } from '../../../../platform/test/node/testWorkspaceService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { Result } from '../../../../util/common/result';
import { DeferredPromise, timeout } from '../../../../util/dardcor/base/common/async';
import { CancellationToken } from '../../../../util/dardcor/base/common/cancellation';
import { DisposableStore } from '../../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { generateUuid } from '../../../../util/dardcor/base/common/uuid';
import { LineEdit, LineReplacement } from '../../../../util/dardcor/editor/common/core/edits/lineEdit';
import { StringEdit } from '../../../../util/dardcor/editor/common/core/edits/stringEdit';
import { LineRange } from '../../../../util/dardcor/editor/common/core/ranges/lineRange';
import { OffsetRange } from '../../../../util/dardcor/editor/common/core/ranges/offsetRange';
import { NESInlineCompletionContext, NextEditProvider } from '../../node/nextEditProvider';
import { ILlmNESTelemetry, NextEditProviderTelemetryBuilder } from '../../node/nextEditProviderTelemetry';

const testModelName = 'test-patch-model';
const testModelConfig = JSON.stringify({ promptingStrategy: 'patchBased02' });

describe('NextEditProvider Caching', () => {

	let configService: IConfigurationService;
	let snippyService: ISnippyService;
	let gitExtensionService: IGitExtensionService;
	let logService: ILogService;
	let expService: IExperimentationService;
	let disposableStore: DisposableStore;
	let workspaceService: IWorkspaceService;
	let requestLogger: IRequestLogger;
	beforeAll(() => {
		disposableStore = new DisposableStore();
		workspaceService = disposableStore.add(new TestWorkspaceService());
		configService = new DefaultsOnlyConfigurationService();
		snippyService = new NullSnippyService();
		gitExtensionService = new NullGitExtensionService();
		logService = new LogServiceImpl([]);
		expService = new NullExperimentationService();
		requestLogger = new NullRequestLogger();
	});
	afterAll(() => {
		disposableStore.dispose();
	});
	function createStatelessNextEditProvider(patchIndices?: readonly (number | undefined)[]): IStatelessNextEditProvider {
		return {
			ID: 'TestNextEditProvider',
			provideNextEdit: async function*(request: StatelessNextEditRequest, logger: ILogger, logContext: InlineEditRequestLogContext, cancellationToken: CancellationToken) {
				const telemetryBuilder = new StatelessNextEditTelemetryBuilder(request.headerRequestId)
					.setModelName(testModelName)
					.setModelConfig(testModelConfig);
				const lineEdit = LineEdit.createFromUnsorted(
					[
						new LineReplacement(
							new LineRange(11, 12),
							['const myPoint = new Point3D(0, 1, 2);']
						),
						new LineReplacement(
							new LineRange(5, 5),
							['\t\tprivate readonly z: number,']
						),
						new LineReplacement(
							new LineRange(6, 9),
							[
								'\tgetDistance() {',
								'\t\treturn Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2);',
								'\t}'
							]
						)
					]
				);
				let editIndex = 0;
				for (const edit of lineEdit.replacements) {
					const patchIndex = patchIndices ? patchIndices[editIndex] : undefined;
					editIndex++;
					yield new WithStatelessProviderTelemetry({ targetDocument: request.getActiveDocument().id, edit, isFromCursorJump: false, patchIndex }, telemetryBuilder.build(Result.ok(undefined)));
				}
				const noSuggestions = new NoNextEditReason.NoSuggestions(request.documentBeforeEdits, undefined);
				return new WithStatelessProviderTelemetry(noSuggestions, telemetryBuilder.build(Result.error(noSuggestions)));
			}
		};
	}

	it('caches a response with multiple edits and reuses them correctly with rebasing', async () => {
		const obsWorkspace = new MutableObservableWorkspace();
		const obsGit = new ObservableGit(gitExtensionService);
		const statelessNextEditProvider = createStatelessNextEditProvider();

		const nextEditProvider: NextEditProvider = new NextEditProvider(obsWorkspace, statelessNextEditProvider, new NesHistoryContextProvider(obsWorkspace, obsGit), new NesXtabHistoryTracker(obsWorkspace, undefined, configService, expService), undefined, configService, snippyService, logService, expService, requestLogger);

		const doc = obsWorkspace.addDocument({
			id: DocumentId.create(URI.file('/test/test.ts').toString()),
			initialValue: outdent`
			class Point {
				constructor(
					private readonly x: number,
					private readonly y: number,
				) { }
				getDistance() {
					return Math.sqrt(this.x ** 2 + this.y ** 2);
				}
			}

			const myPoint = new Point(0, 1);`.trimStart()
		});
		doc.setSelection([new OffsetRange(1, 1)], undefined);

		doc.applyEdit(StringEdit.insert(11, '3D'));

		const context: NESInlineCompletionContext = { triggerKind: 1, selectedCompletionInfo: undefined, requestUuid: generateUuid(), requestIssuedDateTime: Date.now(), earliestShownDateTime: Date.now() + 200, enforceCacheDelay: false };
		const logContext = new InlineEditRequestLogContext(doc.id.toString(), 1, context);
		const cancellationToken = CancellationToken.None;
		const tb1 = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);

		let result = await nextEditProvider.getNextEdit(doc.id, context, logContext, cancellationToken, tb1.nesBuilder);

		tb1.dispose();

		assert(result.result?.edit);

		doc.applyEdit(result.result.edit.toEdit());

		expect(doc.value.get().value).toMatchInlineSnapshot(`
			"class Point3D {
				constructor(
					private readonly x: number,
					private readonly y: number,
					private readonly z: number,
				) { }
				getDistance() {
					return Math.sqrt(this.x ** 2 + this.y ** 2);
				}
			}

			const myPoint = new Point(0, 1);"
		`);

		const tb2 = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);

		result = await nextEditProvider.getNextEdit(doc.id, context, logContext, cancellationToken, tb2.nesBuilder);

		tb2.dispose();

		assert(result.result?.edit);

		doc.applyEdit(result.result.edit.toEdit());

		expect(doc.value.get().value).toMatchInlineSnapshot(`
			"class Point3D {
				constructor(
					private readonly x: number,
					private readonly y: number,
					private readonly z: number,
				) { }
				getDistance() {
					return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2);
				}
			}

			const myPoint = new Point(0, 1);"
		`);

		const tb3 = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);

		result = await nextEditProvider.getNextEdit(doc.id, context, logContext, cancellationToken, tb3.nesBuilder);

		tb3.dispose();

		assert(result.result?.edit);

		doc.applyEdit(result.result.edit.toEdit());

		expect(doc.value.get().value).toMatchInlineSnapshot(`
			"class Point3D {
				constructor(
					private readonly x: number,
					private readonly y: number,
					private readonly z: number,
				) { }
				getDistance() {
					return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2);
				}
			}

			const myPoint = new Point3D(0, 1, 2);"
		`);
	});

	it('caches a response with multiple edits correctly when document uses CRLF line endings', async () => {
		const obsWorkspace = new MutableObservableWorkspace();
		const obsGit = new ObservableGit(gitExtensionService);
		const statelessNextEditProvider = createStatelessNextEditProvider();

		const nextEditProvider: NextEditProvider = new NextEditProvider(obsWorkspace, statelessNextEditProvider, new NesHistoryContextProvider(obsWorkspace, obsGit), new NesXtabHistoryTracker(obsWorkspace, undefined, configService, expService), undefined, configService, snippyService, logService, expService, requestLogger);

		const initialValue = [
			'class Point {',
			'\tconstructor(',
			'\t\tprivate readonly x: number,',
			'\t\tprivate readonly y: number,',
			'\t) { }',
			'\tgetDistance() {',
			'\t\treturn Math.sqrt(this.x ** 2 + this.y ** 2);',
			'\t}',
			'}',
			'',
			'const myPoint = new Point(0, 1);',
		].join('\r\n');

		const doc = obsWorkspace.addDocument({
			id: DocumentId.create(URI.file('/test/test.ts').toString()),
			initialValue,
		});
		doc.setSelection([new OffsetRange(1, 1)], undefined);

		doc.applyEdit(StringEdit.insert(11, '3D'));

		const context: NESInlineCompletionContext = { triggerKind: 1, selectedCompletionInfo: undefined, requestUuid: generateUuid(), requestIssuedDateTime: Date.now(), earliestShownDateTime: Date.now() + 200, enforceCacheDelay: false };
		const logContext = new InlineEditRequestLogContext(doc.id.toString(), 1, context);
		const cancellationToken = CancellationToken.None;
		const tb1 = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);

		let result = await nextEditProvider.getNextEdit(doc.id, context, logContext, cancellationToken, tb1.nesBuilder);
		tb1.dispose();
		assert(result.result?.edit);
		doc.applyEdit(result.result.edit.toEdit());

		expect(doc.value.get().value).toContain('\r\n');
		expect(doc.value.get().value).not.toMatch(/[^\r]\n/);

		const tb2 = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);
		result = await nextEditProvider.getNextEdit(doc.id, context, logContext, cancellationToken, tb2.nesBuilder);
		tb2.dispose();
		assert(result.result?.edit, 'second cached edit should be found');
		doc.applyEdit(result.result.edit.toEdit());

		expect(doc.value.get().value).not.toMatch(/[^\r]\n/);

		const tb3 = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);
		result = await nextEditProvider.getNextEdit(doc.id, context, logContext, cancellationToken, tb3.nesBuilder);
		tb3.dispose();
		assert(result.result?.edit, 'third cached edit should be found');
		doc.applyEdit(result.result.edit.toEdit());

		const expectedLines = [
			'class Point3D {',
			'\tconstructor(',
			'\t\tprivate readonly x: number,',
			'\t\tprivate readonly y: number,',
			'\t\tprivate readonly z: number,',
			'\t) { }',
			'\tgetDistance() {',
			'\t\treturn Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2);',
			'\t}',
			'}',
			'',
			'const myPoint = new Point3D(0, 1, 2);',
		].join('\r\n');
		expect(doc.value.get().value).toBe(expectedLines);
	});

	it('exposes the cache entry on NextEditResult and preserves the wasRenderedAsInlineSuggestion flag across lookups', async () => {
		const obsWorkspace = new MutableObservableWorkspace();
		const obsGit = new ObservableGit(gitExtensionService);
		const statelessNextEditProvider = createStatelessNextEditProvider();

		const nextEditProvider: NextEditProvider = new NextEditProvider(obsWorkspace, statelessNextEditProvider, new NesHistoryContextProvider(obsWorkspace, obsGit), new NesXtabHistoryTracker(obsWorkspace, undefined, configService, expService), undefined, configService, snippyService, logService, expService, requestLogger);

		const doc = obsWorkspace.addDocument({
			id: DocumentId.create(URI.file('/test/test.ts').toString()),
			initialValue: outdent`
			class Point {
				constructor(
					private readonly x: number,
					private readonly y: number,
				) { }
				getDistance() {
					return Math.sqrt(this.x ** 2 + this.y ** 2);
				}
			}

			const myPoint = new Point(0, 1);`.trimStart()
		});
		doc.setSelection([new OffsetRange(1, 1)], undefined);

		doc.applyEdit(StringEdit.insert(11, '3D'));

		const context: NESInlineCompletionContext = { triggerKind: 1, selectedCompletionInfo: undefined, requestUuid: generateUuid(), requestIssuedDateTime: Date.now(), earliestShownDateTime: Date.now() + 200, enforceCacheDelay: false };
		const logContext = new InlineEditRequestLogContext(doc.id.toString(), 1, context);
		const cancellationToken = CancellationToken.None;

		const tb1 = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);
		const first = await nextEditProvider.getNextEdit(doc.id, context, logContext, cancellationToken, tb1.nesBuilder);
		tb1.dispose();
		assert(first.result?.edit);
		const firstCacheEntry = first.result.cacheEntry;
		assert(firstCacheEntry, 'expected a cacheEntry reference on the first (fresh) NextEditResult');
		expect(firstCacheEntry.wasRenderedAsInlineSuggestion).toBeFalsy();

		firstCacheEntry.wasRenderedAsInlineSuggestion = true;

		const tb2 = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);
		const second = await nextEditProvider.getNextEdit(doc.id, context, logContext, cancellationToken, tb2.nesBuilder);
		tb2.dispose();
		assert(second.result?.edit);
		const secondCacheEntry = second.result.cacheEntry;
		assert(secondCacheEntry, 'expected a cacheEntry reference on the second (cached) NextEditResult');
		expect(secondCacheEntry).toBe(firstCacheEntry);
		expect(secondCacheEntry.wasRenderedAsInlineSuggestion).toBe(true);
	});

	it('attributes each served edit to its originating model patch via sourcePatchIndex', async () => {
		const obsWorkspace = new MutableObservableWorkspace();
		const obsGit = new ObservableGit(gitExtensionService);
		const statelessNextEditProvider = createStatelessNextEditProvider([0, 0, 1]);

		const nextEditProvider: NextEditProvider = new NextEditProvider(obsWorkspace, statelessNextEditProvider, new NesHistoryContextProvider(obsWorkspace, obsGit), new NesXtabHistoryTracker(obsWorkspace, undefined, configService, expService), undefined, configService, snippyService, logService, expService, requestLogger);

		const doc = obsWorkspace.addDocument({
			id: DocumentId.create(URI.file('/test/test.ts').toString()),
			initialValue: outdent`
			class Point {
				constructor(
					private readonly x: number,
					private readonly y: number,
				) { }
				getDistance() {
					return Math.sqrt(this.x ** 2 + this.y ** 2);
				}
			}

			const myPoint = new Point(0, 1);`.trimStart()
		});
		doc.setSelection([new OffsetRange(1, 1)], undefined);
		doc.applyEdit(StringEdit.insert(11, '3D'));

		const context: NESInlineCompletionContext = { triggerKind: 1, selectedCompletionInfo: undefined, requestUuid: generateUuid(), requestIssuedDateTime: Date.now(), earliestShownDateTime: Date.now() + 200, enforceCacheDelay: false };
		const logContext = new InlineEditRequestLogContext(doc.id.toString(), 1, context);
		const cancellationToken = CancellationToken.None;

		const servedTelemetry: Pick<ILlmNESTelemetry, 'sourcePatchIndex' | 'isFromCache' | 'modelName' | 'modelConfig' | 'hadStatelessNextEditProviderCall'>[] = [];
		for (let i = 0; i < 3; i++) {
			const tb = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);
			const result = await nextEditProvider.getNextEdit(doc.id, context, logContext, cancellationToken, tb.nesBuilder);
			assert(result.result?.edit, `expected an edit on call ${i + 1}`);
			const telemetry = tb.nesBuilder.build(false);
			servedTelemetry.push({
				sourcePatchIndex: telemetry.sourcePatchIndex,
				isFromCache: telemetry.isFromCache,
				modelName: telemetry.modelName,
				modelConfig: telemetry.modelConfig,
				hadStatelessNextEditProviderCall: telemetry.hadStatelessNextEditProviderCall,
			});
			tb.dispose();
			doc.applyEdit(result.result.edit.toEdit());
		}

		expect(servedTelemetry).toEqual([
			{
				sourcePatchIndex: 0,
				isFromCache: false,
				modelName: testModelName,
				modelConfig: testModelConfig,
				hadStatelessNextEditProviderCall: true,
			},
			{
				sourcePatchIndex: 0,
				isFromCache: true,
				modelName: testModelName,
				modelConfig: testModelConfig,
				hadStatelessNextEditProviderCall: undefined,
			},
			{
				sourcePatchIndex: 1,
				isFromCache: true,
				modelName: testModelName,
				modelConfig: testModelConfig,
				hadStatelessNextEditProviderCall: undefined,
			},
		]);
	});

	it('preserves model attribution for a cached no-edit result', async () => {
		const obsWorkspace = new MutableObservableWorkspace();
		const obsGit = new ObservableGit(gitExtensionService);
		let providerCallCount = 0;
		const statelessNextEditProvider: IStatelessNextEditProvider = {
			ID: 'TestNoEditProvider',
			provideNextEdit: async function*(request: StatelessNextEditRequest) {
				providerCallCount++;
				const telemetryBuilder = new StatelessNextEditTelemetryBuilder(request.headerRequestId)
					.setModelName(testModelName)
					.setModelConfig(testModelConfig);
				const noSuggestions = new NoNextEditReason.NoSuggestions(request.documentBeforeEdits, undefined);
				return new WithStatelessProviderTelemetry(noSuggestions, telemetryBuilder.build(Result.error(noSuggestions)));
			}
		};
		const nextEditProvider = new NextEditProvider(obsWorkspace, statelessNextEditProvider, new NesHistoryContextProvider(obsWorkspace, obsGit), new NesXtabHistoryTracker(obsWorkspace, undefined, configService, expService), undefined, configService, snippyService, logService, expService, requestLogger);
		const doc = obsWorkspace.addDocument({
			id: DocumentId.create(URI.file('/test/no-edit.ts').toString()),
			initialValue: 'const value = 1;',
		});
		doc.setSelection([new OffsetRange(0, 0)], undefined);
		doc.applyEdit(StringEdit.insert(15, '\n'));

		const context: NESInlineCompletionContext = { triggerKind: 1, selectedCompletionInfo: undefined, requestUuid: generateUuid(), requestIssuedDateTime: Date.now(), earliestShownDateTime: Date.now(), enforceCacheDelay: false };
		const logContext = new InlineEditRequestLogContext(doc.id.toString(), 1, context);

		const firstBuilder = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);
		const first = await nextEditProvider.getNextEdit(doc.id, context, logContext, CancellationToken.None, firstBuilder.nesBuilder);
		firstBuilder.dispose();

		const cachedBuilder = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, doc);
		const cached = await nextEditProvider.getNextEdit(doc.id, context, logContext, CancellationToken.None, cachedBuilder.nesBuilder);
		const cachedTelemetry = cachedBuilder.nesBuilder.build(false);
		cachedBuilder.dispose();

		expect({
			firstResult: first.result,
			cachedResult: cached.result,
			providerCallCount,
			isFromCache: cachedTelemetry.isFromCache,
			modelName: cachedTelemetry.modelName,
			modelConfig: cachedTelemetry.modelConfig,
			hadStatelessNextEditProviderCall: cachedTelemetry.hadStatelessNextEditProviderCall,
		}).toEqual({
			firstResult: undefined,
			cachedResult: undefined,
			providerCallCount: 1,
			isFromCache: true,
			modelName: testModelName,
			modelConfig: testModelConfig,
			hadStatelessNextEditProviderCall: undefined,
		});

		nextEditProvider.dispose();
		doc.dispose();
	});

	class PurgeDisabledConfigurationService extends InMemoryConfigurationService {
		override getExperimentBasedConfig<T extends ExperimentBasedConfigType>(key: ExperimentBasedConfig<T>, experimentationService: IExperimentationService): T {
			if (key === ConfigKey.Advanced.InlineEditsTriggerOnEditorChangeAfterSeconds) {
				return undefined as T;
			}
			return super.getExperimentBasedConfig(key, experimentationService);
		}
	}

	function createCrossFileStatelessProvider(targetDocId: DocumentId, targetEdit: LineReplacement, activeDocWindow?: OffsetRange): { provider: IStatelessNextEditProvider; getCallCount: () => number; whenFirstStreamEnded: Promise<void> } {
		let callCount = 0;
		const firstStreamEnded = new DeferredPromise<void>();
		const provider: IStatelessNextEditProvider = {
			ID: 'TestCrossFileNextEditProvider',
			provideNextEdit: async function*(request: StatelessNextEditRequest, logger: ILogger, logContext: InlineEditRequestLogContext, cancellationToken: CancellationToken) {
				const telemetryBuilder = new StatelessNextEditTelemetryBuilder(request.headerRequestId)
					.setModelName(testModelName)
					.setModelConfig(testModelConfig);
				callCount++;
				const isFirstCall = callCount === 1;
				try {
					if (isFirstCall) {
						yield new WithStatelessProviderTelemetry({ targetDocument: targetDocId, edit: targetEdit, isFromCursorJump: false, window: activeDocWindow, patchIndex: undefined }, telemetryBuilder.build(Result.ok(undefined)));
					}
					const noSuggestions = new NoNextEditReason.NoSuggestions(request.documentBeforeEdits, undefined);
					return new WithStatelessProviderTelemetry(noSuggestions, telemetryBuilder.build(Result.error(noSuggestions)));
				} finally {
					if (isFirstCall) {
						firstStreamEnded.complete();
					}
				}
			}
		};
		return { provider, getCallCount: () => callCount, whenFirstStreamEnded: firstStreamEnded.p };
	}

	async function runCrossFileScenario(options?: { activeDocWindow?: OffsetRange; disposeTargetBeforeSecondRequest?: boolean; mutateTargetBeforeSecondRequest?: boolean; disableEditorChangeTrigger?: boolean }) {
		const obsWorkspace = new MutableObservableWorkspace();
		const obsGit = new ObservableGit(gitExtensionService);

		const docAId = DocumentId.create(URI.file('/test/a.ts').toString());
		const docBId = DocumentId.create(URI.file('/test/b.ts').toString());

		const scenarioConfigService = options?.disableEditorChangeTrigger ? new PurgeDisabledConfigurationService(new DefaultsOnlyConfigurationService()) : configService;

		const targetEdit = new LineReplacement(new LineRange(2, 3), ['\treturn 42;']);
		const { provider: statelessNextEditProvider, getCallCount, whenFirstStreamEnded } = createCrossFileStatelessProvider(docBId, targetEdit, options?.activeDocWindow);

		const nextEditProvider: NextEditProvider = new NextEditProvider(obsWorkspace, statelessNextEditProvider, new NesHistoryContextProvider(obsWorkspace, obsGit), new NesXtabHistoryTracker(obsWorkspace, undefined, scenarioConfigService, expService), undefined, scenarioConfigService, snippyService, logService, expService, requestLogger);

		const docB = obsWorkspace.addDocument({ id: docBId, initialValue: ['export function helper() {', '\treturn 1;', '}'].join('\n') });
		const docA = obsWorkspace.addDocument({ id: docAId, initialValue: ['class Point {', '\tconstructor(', '\t\tprivate readonly x: number,', '\t) { }', '}'].join('\n') });

		docB.setSelection([new OffsetRange(0, 0)], undefined);
		docA.setSelection([new OffsetRange(1, 1)], undefined);

		docB.applyEdit(StringEdit.insert(docB.value.get().value.length, '\n// touched'));
		docA.applyEdit(StringEdit.insert(11, '3D'));

		const context: NESInlineCompletionContext = { triggerKind: 1, selectedCompletionInfo: undefined, requestUuid: generateUuid(), requestIssuedDateTime: Date.now(), earliestShownDateTime: Date.now() + 200, enforceCacheDelay: false };
		const logContext = new InlineEditRequestLogContext(docA.id.toString(), 1, context);
		const cancellationToken = CancellationToken.None;

		const tb1 = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, docA);
		const first = await nextEditProvider.getNextEdit(docA.id, context, logContext, cancellationToken, tb1.nesBuilder);
		tb1.dispose();

		await whenFirstStreamEnded;
		await timeout(0);

		if (options?.disposeTargetBeforeSecondRequest) {
			docB.dispose();
		}
		if (options?.mutateTargetBeforeSecondRequest) {
			docB.applyEdit(StringEdit.insert(0, '// header\n'));
		}

		const tb2 = new NextEditProviderTelemetryBuilder(gitExtensionService, mockNotebookService, workspaceService, nextEditProvider.ID, docA);
		const second = await nextEditProvider.getNextEdit(docA.id, context, logContext, cancellationToken, tb2.nesBuilder);
		const secondTelemetry = tb2.nesBuilder.build(false);
		tb2.dispose();

		nextEditProvider.dispose();
		docA.dispose();
		docB.dispose();

		return { first, second, secondTelemetry, docBId, getCallCount };
	}

	it('re-serves a cross-file suggestion from cache while the cursor stays in the active document (surviving the no-suggestions stream end)', async () => {
		const { first, second, secondTelemetry, docBId, getCallCount } = await runCrossFileScenario();

		assert(first.result?.edit, 'expected a cross-file edit on the first request');
		expect(first.result.targetDocumentId).toBe(docBId);

		assert(second.result?.edit, 'expected the cross-file edit to be re-served from cache');
		expect(second.result.targetDocumentId).toBe(docBId);
		expect(second.result.edit).toBe(first.result.edit);
		expect(getCallCount()).toBe(1);
		expect({
			isFromCache: secondTelemetry.isFromCache,
			modelName: secondTelemetry.modelName,
			modelConfig: secondTelemetry.modelConfig,
			hadStatelessNextEditProviderCall: secondTelemetry.hadStatelessNextEditProviderCall,
		}).toEqual({
			isFromCache: true,
			modelName: testModelName,
			modelConfig: testModelConfig,
			hadStatelessNextEditProviderCall: undefined,
		});
	});

	it('re-serves a cross-file suggestion from cache when the cursor is within the cached edit window', async () => {
		const { first, second, docBId, getCallCount } = await runCrossFileScenario({ activeDocWindow: new OffsetRange(0, 14) });

		assert(first.result?.edit, 'expected a cross-file edit on the first request');
		expect(first.result.targetDocumentId).toBe(docBId);

		assert(second.result?.edit, 'expected the cross-file edit to be re-served from cache');
		expect(second.result.targetDocumentId).toBe(docBId);
		expect(second.result.edit).toBe(first.result.edit);
		expect(getCallCount()).toBe(1);
	});

	it('does not re-serve a cross-file suggestion from cache when the cursor is outside the cached edit window', async () => {
		const { first, second, docBId, getCallCount } = await runCrossFileScenario({ activeDocWindow: new OffsetRange(20, 30) });

		assert(first.result?.edit, 'expected a cross-file edit on the first request');
		expect(first.result.targetDocumentId).toBe(docBId);

		expect(second.result?.edit).toBeUndefined();
		expect(getCallCount()).toBe(2);
	});

	it('refetches instead of serving a stale cross-file suggestion when the target document is no longer open', async () => {
		const { first, second, docBId, getCallCount } = await runCrossFileScenario({ disposeTargetBeforeSecondRequest: true });

		assert(first.result?.edit, 'expected a cross-file edit on the first request');
		expect(first.result.targetDocumentId).toBe(docBId);

		expect(second.result?.edit).toBeUndefined();
		expect(getCallCount()).toBe(2);
	});

	it('re-serves a cross-file suggestion (with the purge disabled) while the target document is unchanged', async () => {
		const { first, second, docBId, getCallCount } = await runCrossFileScenario({ disableEditorChangeTrigger: true });

		assert(first.result?.edit, 'expected a cross-file edit on the first request');
		expect(first.result.targetDocumentId).toBe(docBId);

		assert(second.result?.edit, 'expected the cross-file edit to be re-served from cache');
		expect(second.result.targetDocumentId).toBe(docBId);
		expect(second.result.edit).toBe(first.result.edit);
		expect(getCallCount()).toBe(1);
	});

	it('refetches instead of serving a stale cross-file suggestion when the target document changed since it was produced', async () => {
		const { first, second, docBId, getCallCount } = await runCrossFileScenario({ mutateTargetBeforeSecondRequest: true, disableEditorChangeTrigger: true });

		assert(first.result?.edit, 'expected a cross-file edit on the first request');
		expect(first.result.targetDocumentId).toBe(docBId);

		expect(second.result?.edit).toBeUndefined();
		expect(getCallCount()).toBe(2);
	});

	it('does not serve a stale cross-file suggestion when the target document changed under the default (purge-enabled) configuration', async () => {
		const { first, second, docBId, getCallCount } = await runCrossFileScenario({ mutateTargetBeforeSecondRequest: true });

		assert(first.result?.edit, 'expected a cross-file edit on the first request');
		expect(first.result.targetDocumentId).toBe(docBId);

		expect(second.result?.edit).toBeUndefined();
		expect(getCallCount()).toBe(2);
	});
});
