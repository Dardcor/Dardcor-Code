/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/anythingQuickAccess.css';
import { IQuickInputButton, IKeyMods, quickPickItemScorerAccessor, QuickPickItemScorerAccessor, IQuickPick, IQuickPickItemWithResource, QuickInputHideReason, IQuickInputService, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IPickerQuickAccessItem, PickerQuickAccessProvider, TriggerAction, FastAndSlowPicks, Picks, PicksWithActive } from '../../../../platform/quickinput/browser/pickerQuickAccess.js';
import { prepareQuery, IPreparedQuery, compareItemsByFuzzyScore, scoreItemFuzzy, FuzzyScorerCache } from '../../../../base/common/fuzzyScorer.js';
import { IFileQueryBuilderOptions, QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { getOutOfWorkspaceEditorResources, extractRangeFromFilter, IWorkbenchSearchConfiguration } from '../common/search.js';
import { ISearchService, ISearchComplete } from '../../../services/search/common/search.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { untildify } from '../../../../base/common/labels.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { URI } from '../../../../base/common/uri.js';
import { toLocalResource, dirname, basenameOrAuthority } from '../../../../base/common/resources.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore, IDisposable, toDisposable, MutableDisposable, Disposable } from '../../../../base/common/lifecycle.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { getIconClasses } from '../../../../editor/common/services/getIconClasses.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { localize } from '../../../../nls.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchEditorConfiguration, EditorResourceAccessor, isEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService, SIDE_GROUP, ACTIVE_GROUP } from '../../../services/editor/common/editorService.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ThrottledDelayer } from '../../../../base/common/async.js';
import { top } from '../../../../base/common/arrays.js';
import { FileQueryCacheState } from '../common/cacheState.js';
import { IHistoryService } from '../../../services/history/common/history.js';
import { IResourceEditorInput, ITextEditorOptions } from '../../../../platform/editor/common/editor.js';
import { Schemas } from '../../../../base/common/network.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { SymbolsQuickAccessProvider } from './symbolsQuickAccess.js';
import { AnythingQuickAccessProviderRunOptions, DefaultQuickAccessFilterValue, Extensions, IQuickAccessRegistry } from '../../../../platform/quickinput/common/quickAccess.js';
import { PickerEditorState, IWorkbenchQuickAccessConfiguration } from '../../../browser/quickaccess.js';
import { GotoSymbolQuickAccessProvider } from '../../codeEditor/browser/quickaccess/gotoSymbolQuickAccess.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ScrollType, IEditor } from '../../../../editor/common/editorCommon.js';
import { Event } from '../../../../base/common/event.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { stripIcons } from '../../../../base/common/iconLabels.js';
import { Lazy } from '../../../../base/common/lazy.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ASK_QUICK_QUESTION_ACTION_ID } from '../../chat/browser/actions/chatQuickInputActions.js';
import { IChatWidgetService, IQuickChatService } from '../../chat/browser/chat.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICustomEditorLabelService } from '../../../services/editor/common/customEditorLabelService.js';

export interface IAnythingQuickPickItem extends IPickerQuickAccessItem, IQuickPickItemWithResource {
	readonly editor?: EditorInput | IResourceEditorInput;
}

interface IEditorSymbolAnythingQuickPickItem extends IAnythingQuickPickItem {
	resource: URI;
	range: { decoration: IRange; selection: IRange };
}

function isEditorSymbolQuickPickItem(pick?: IAnythingQuickPickItem): pick is IEditorSymbolAnythingQuickPickItem {
	const candidate = pick as IEditorSymbolAnythingQuickPickItem | undefined;

	return !!candidate?.range && !!candidate.resource;
}

interface IAnythingPickState extends IDisposable {
	picker: IQuickPick<IAnythingQuickPickItem, { useSeparators: true }> | undefined;
	editorViewState: PickerEditorState;

	scorerCache: FuzzyScorerCache;
	fileQueryCache: FileQueryCacheState | undefined;

	lastOriginalFilter: string | undefined;
	lastFilter: string | undefined;
	lastRange: IRange | undefined;

	lastGlobalPicks: PicksWithActive<IAnythingQuickPickItem> | undefined;

	isQuickNavigating: boolean | undefined;

	set(picker: IQuickPick<IAnythingQuickPickItem, { useSeparators: true }>): void;
}


export class AnythingQuickAccessProvider extends PickerQuickAccessProvider<IAnythingQuickPickItem> {

	static PREFIX = '';

	private static readonly NO_RESULTS_PICK: IAnythingQuickPickItem = {
		label: localize('noAnythingResults', "No matching results")
	};

	private static readonly MAX_RESULTS = 512;

	private static readonly TYPING_SEARCH_DELAY = 200;

	private static SYMBOL_PICKS_MERGE_DELAY = 200;

	private readonly pickState: IAnythingPickState;

	get defaultFilterValue(): DefaultQuickAccessFilterValue | undefined {
		if (this.configuration.preserveInput) {
			return DefaultQuickAccessFilterValue.LAST;
		}

		return undefined;
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ISearchService private readonly searchService: ISearchService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IPathService private readonly pathService: IPathService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IHistoryService private readonly historyService: IHistoryService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IQuickChatService private readonly quickChatService: IQuickChatService,
		@ILogService private readonly logService: ILogService,
		@ICustomEditorLabelService private readonly customEditorLabelService: ICustomEditorLabelService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService
	) {
		super(AnythingQuickAccessProvider.PREFIX, {
			canAcceptInBackground: true,
			noResultsPick: AnythingQuickAccessProvider.NO_RESULTS_PICK
		});

		this.pickState = this._register(new class extends Disposable {

			picker: IQuickPick<IAnythingQuickPickItem, { useSeparators: true }> | undefined = undefined;

			editorViewState: PickerEditorState;

			scorerCache: FuzzyScorerCache = Object.create(null);
			fileQueryCache: FileQueryCacheState | undefined = undefined;

			lastOriginalFilter: string | undefined = undefined;
			lastFilter: string | undefined = undefined;
			lastRange: IRange | undefined = undefined;

			lastGlobalPicks: PicksWithActive<IAnythingQuickPickItem> | undefined = undefined;

			isQuickNavigating: boolean | undefined = undefined;

			constructor(
				private readonly provider: AnythingQuickAccessProvider,
				instantiationService: IInstantiationService
			) {
				super();
				this.editorViewState = this._register(instantiationService.createInstance(PickerEditorState));
			}

			set(picker: IQuickPick<IAnythingQuickPickItem, { useSeparators: true }>): void {

				this.picker = picker;
				Event.once(picker.onDispose)(() => {
					if (picker === this.picker) {
						this.picker = undefined;
					}
				});

				const isQuickNavigating = !!picker.quickNavigate;
				if (!isQuickNavigating) {
					this.fileQueryCache = this.provider.createFileQueryCache();
					this.scorerCache = Object.create(null);
				}

				this.isQuickNavigating = isQuickNavigating;
				this.lastOriginalFilter = undefined;
				this.lastFilter = undefined;
				this.lastRange = undefined;
				this.lastGlobalPicks = undefined;
				this.editorViewState.reset();
			}
		}(this, instantiationService));

		this.fileQueryBuilder = this.instantiationService.createInstance(QueryBuilder);
		this.workspaceSymbolsQuickAccess = this._register(instantiationService.createInstance(SymbolsQuickAccessProvider));
		this.editorSymbolsQuickAccess = this.instantiationService.createInstance(GotoSymbolQuickAccessProvider);
	}

	private get configuration() {
		const editorConfig = this.configurationService.getValue<IWorkbenchEditorConfiguration>().workbench?.editor;
		const searchConfig = this.configurationService.getValue<IWorkbenchSearchConfiguration>().search;
		const quickAccessConfig = this.configurationService.getValue<IWorkbenchQuickAccessConfiguration>().workbench.quickOpen;

		return {
			openEditorPinned: !editorConfig?.enablePreviewFromQuickOpen || !editorConfig?.enablePreview,
			openSideBySideDirection: editorConfig?.openSideBySideDirection,
			includeSymbols: searchConfig?.quickOpen?.includeSymbols,
			includeHistory: searchConfig?.quickOpen?.includeHistory ?? true,
			historyFilterSortOrder: searchConfig?.quickOpen?.history?.filterSortOrder,
			preserveInput: quickAccessConfig?.preserveInput
		};
	}

	override provide(picker: IQuickPick<IAnythingQuickPickItem, { useSeparators: true }>, token: CancellationToken, runOptions?: AnythingQuickAccessProviderRunOptions): IDisposable {
		const disposables = new DisposableStore();

		this.pickState.set(picker);

		const editorDecorationsDisposable = disposables.add(new MutableDisposable());
		disposables.add(picker.onDidChangeActive(() => {

			editorDecorationsDisposable.value = undefined;

			const [item] = picker.activeItems;
			if (isEditorSymbolQuickPickItem(item)) {
				editorDecorationsDisposable.value = this.decorateAndRevealSymbolRange(item);
			}
		}));

		disposables.add(Event.once(picker.onDidHide)(({ reason }) => {
			if (reason === QuickInputHideReason.Gesture) {
				this.pickState.editorViewState.restore();
			}
		}));

		disposables.add(super.provide(picker, token, runOptions));

		return disposables;
	}

	private decorateAndRevealSymbolRange(pick: IEditorSymbolAnythingQuickPickItem): IDisposable {
		const activeEditor = this.editorService.activeEditor;
		if (!this.uriIdentityService.extUri.isEqual(pick.resource, activeEditor?.resource)) {
			return Disposable.None;
		}

		const activeEditorControl = this.editorService.activeTextEditorControl;
		if (!activeEditorControl) {
			return Disposable.None;
		}

		this.pickState.editorViewState.set();

		activeEditorControl.revealRangeInCenter(pick.range.selection, ScrollType.Smooth);

		this.addDecorations(activeEditorControl, pick.range.decoration);

		return toDisposable(() => this.clearDecorations(activeEditorControl));
	}

	protected _getPicks(originalFilter: string, disposables: DisposableStore, token: CancellationToken, runOptions?: AnythingQuickAccessProviderRunOptions): Picks<IAnythingQuickPickItem> | Promise<Picks<IAnythingQuickPickItem>> | FastAndSlowPicks<IAnythingQuickPickItem> | null {

		const filterWithRange = extractRangeFromFilter(originalFilter, [GotoSymbolQuickAccessProvider.PREFIX]);

		let filter: string;
		if (filterWithRange) {
			filter = filterWithRange.filter;
		} else {
			filter = originalFilter;
		}

		this.pickState.lastRange = filterWithRange?.range;

		if (originalFilter !== this.pickState.lastOriginalFilter && filter === this.pickState.lastFilter) {
			return null;
		}

		const lastWasFiltering = !!this.pickState.lastOriginalFilter;
		this.pickState.lastOriginalFilter = originalFilter;
		this.pickState.lastFilter = filter;

		// We can use this state to return back to the global pick
		const picks = this.pickState.picker?.items;
		const activePick = this.pickState.picker?.activeItems[0];
		if (picks && activePick) {
			const activePickIsEditorSymbol = isEditorSymbolQuickPickItem(activePick);
			const activePickIsNoResultsInEditorSymbols = activePick === AnythingQuickAccessProvider.NO_RESULTS_PICK && filter.indexOf(GotoSymbolQuickAccessProvider.PREFIX) >= 0;
			if (!activePickIsEditorSymbol && !activePickIsNoResultsInEditorSymbols) {
				this.pickState.lastGlobalPicks = {
					items: picks,
					active: activePick
				};
			}
		}

		return this.doGetPicks(
			filter,
			{
				...runOptions,
				enableEditorSymbolSearch: lastWasFiltering
			},
			disposables,
			token
		);
	}

	private doGetPicks(
		filter: string,
		options: AnythingQuickAccessProviderRunOptions & { enableEditorSymbolSearch: boolean },
		disposables: DisposableStore,
		token: CancellationToken
	): Picks<IAnythingQuickPickItem> | Promise<Picks<IAnythingQuickPickItem>> | FastAndSlowPicks<IAnythingQuickPickItem> {
		const query = prepareQuery(filter);

		// - having a previously active global pick (e.g. a file)
		if (options.enableEditorSymbolSearch) {
			const editorSymbolPicks = this.getEditorSymbolPicks(query, disposables, token);
			if (editorSymbolPicks) {
				return editorSymbolPicks;
			}
		}

		// the last global pick to support the case of narrowing out from a
		// editor symbol search back into the global search
		const activePick = this.pickState.picker?.activeItems[0];
		if (isEditorSymbolQuickPickItem(activePick) && this.pickState.lastGlobalPicks) {
			return this.pickState.lastGlobalPicks;
		}

		const historyEditorPicks = this.getEditorHistoryPicks(query);

		let picks = new Array<IAnythingQuickPickItem | IQuickPickSeparator>();
		if (options.additionPicks) {
			for (const pick of options.additionPicks) {
				if (pick.type === 'separator') {
					picks.push(pick);
					continue;
				}
				if (!query.original) {
					pick.highlights = undefined;
					picks.push(pick);
					continue;
				}
				const { score, labelMatch, descriptionMatch } = scoreItemFuzzy(pick, query, true, quickPickItemScorerAccessor, this.pickState.scorerCache);
				if (!score) {
					continue;
				}
				pick.highlights = {
					label: labelMatch,
					description: descriptionMatch
				};
				picks.push(pick);
			}
		}
		if (this.pickState.isQuickNavigating) {
			if (picks.length > 0) {
				picks.push({ type: 'separator', label: localize('recentlyOpenedSeparator', "recently opened") } satisfies IQuickPickSeparator);
			}
			picks = historyEditorPicks;
		} else {
			if (options.includeHelp) {
				picks.push(...this.getHelpPicks(query, token, options));
			}
			if (historyEditorPicks.length !== 0) {
				picks.push({ type: 'separator', label: localize('recentlyOpenedSeparator', "recently opened") } satisfies IQuickPickSeparator);
				picks.push(...historyEditorPicks);
			}
		}

		return {

			picks: options.filter ? picks.filter((p) => options.filter?.(p)) : picks,

			additionalPicks: (async (): Promise<Picks<IAnythingQuickPickItem>> => {

				const additionalPicksExcludes = new ResourceMap<boolean>(uri => this.uriIdentityService.extUri.getComparisonKey(uri));
				for (const historyEditorPick of historyEditorPicks) {
					if (historyEditorPick.resource) {
						additionalPicksExcludes.set(historyEditorPick.resource, true);
					}
				}

				let additionalPicks = await this.getAdditionalPicks(query, additionalPicksExcludes, Boolean(this.configuration?.includeSymbols), token);
				if (options.filter) {
					additionalPicks = additionalPicks.filter((p) => options.filter?.(p));
				}
				if (token.isCancellationRequested) {
					return [];
				}

				return additionalPicks.length > 0 ? [
					{ type: 'separator', label: this.configuration.includeSymbols ? localize('fileAndSymbolResultsSeparator', "file and symbol results") : localize('fileResultsSeparator', "file results") },
					...additionalPicks
				] : [];
			})(),

			mergeDelay: AnythingQuickAccessProvider.SYMBOL_PICKS_MERGE_DELAY
		};
	}

	private async getAdditionalPicks(query: IPreparedQuery, excludes: ResourceMap<boolean>, includeSymbols: boolean, token: CancellationToken): Promise<Array<IAnythingQuickPickItem>> {

		const [filePicks, symbolPicks] = await Promise.all([
			this.getFilePicks(query, excludes, token),
			this.getWorkspaceSymbolPicks(query, includeSymbols, token)
		]);

		if (token.isCancellationRequested) {
			return [];
		}

		const sortedAnythingPicks = top(
			[...filePicks, ...symbolPicks],
			(anyPickA, anyPickB) => compareItemsByFuzzyScore(anyPickA, anyPickB, query, true, quickPickItemScorerAccessor, this.pickState.scorerCache),
			AnythingQuickAccessProvider.MAX_RESULTS
		);

		const filteredAnythingPicks: IAnythingQuickPickItem[] = [];
		for (const anythingPick of sortedAnythingPicks) {

			if (anythingPick.highlights) {
				filteredAnythingPicks.push(anythingPick);
			}

			else {
				const { score, labelMatch, descriptionMatch } = scoreItemFuzzy(anythingPick, query, true, quickPickItemScorerAccessor, this.pickState.scorerCache);
				if (!score) {
					continue;
				}

				anythingPick.highlights = {
					label: labelMatch,
					description: descriptionMatch
				};

				filteredAnythingPicks.push(anythingPick);
			}
		}

		return filteredAnythingPicks;
	}



	private readonly labelOnlyEditorHistoryPickAccessor = new QuickPickItemScorerAccessor({ skipDescription: true });

	private getEditorHistoryPicks(query: IPreparedQuery): Array<IAnythingQuickPickItem> {
		const configuration = this.configuration;

		if (!query.normalized) {
			return this.historyService.getHistory().map(editor => this.createAnythingPick(editor, configuration));
		}

		if (!this.configuration.includeHistory) {
			return [];
		}

		const editorHistoryScorerAccessor = query.containsPathSeparator ? quickPickItemScorerAccessor : this.labelOnlyEditorHistoryPickAccessor;
		const editorHistoryPicks: Array<IAnythingQuickPickItem> = [];
		for (const editor of this.historyService.getHistory()) {
			const resource = editor.resource;
			if (!resource) {
				continue;
			}

			const editorHistoryPick = this.createAnythingPick(editor, configuration);

			const { score, labelMatch, descriptionMatch } = scoreItemFuzzy(editorHistoryPick, query, false, editorHistoryScorerAccessor, this.pickState.scorerCache);
			if (!score) {
				continue;
			}

			editorHistoryPick.highlights = {
				label: labelMatch,
				description: descriptionMatch
			};

			editorHistoryPicks.push(editorHistoryPick);
		}

		if (this.configuration.historyFilterSortOrder === 'recency') {
			return editorHistoryPicks;
		}

		return editorHistoryPicks.sort((editorA, editorB) => compareItemsByFuzzyScore(editorA, editorB, query, false, editorHistoryScorerAccessor, this.pickState.scorerCache));
	}




	private readonly fileQueryDelayer = this._register(new ThrottledDelayer<URI[]>(AnythingQuickAccessProvider.TYPING_SEARCH_DELAY));

	private readonly fileQueryBuilder: QueryBuilder;

	private createFileQueryCache(): FileQueryCacheState {
		return new FileQueryCacheState(
			cacheKey => this.fileQueryBuilder.file(this.contextService.getWorkspace().folders, this.getFileQueryOptions({ cacheKey })),
			query => this.searchService.fileSearch(query),
			cacheKey => this.searchService.clearCache(cacheKey),
			this.pickState.fileQueryCache
		).load();
	}

	private async getFilePicks(query: IPreparedQuery, excludes: ResourceMap<boolean>, token: CancellationToken): Promise<Array<IAnythingQuickPickItem>> {
		if (!query.normalized) {
			return [];
		}

		const absolutePathResult = await this.getAbsolutePathFileResult(query, token);
		if (token.isCancellationRequested) {
			return [];
		}

		let fileMatches: Array<URI>;
		if (absolutePathResult) {
			if (excludes.has(absolutePathResult)) {
				return [];
			}

			const absolutePathPick = this.createAnythingPick(absolutePathResult, this.configuration);
			absolutePathPick.highlights = {
				label: [{ start: 0, end: absolutePathPick.label.length }],
				description: absolutePathPick.description ? [{ start: 0, end: absolutePathPick.description.length }] : undefined
			};

			return [absolutePathPick];
		}

		if (this.pickState.fileQueryCache?.isLoaded) {
			fileMatches = await this.doFileSearch(query, token);
		} else {
			fileMatches = await this.fileQueryDelayer.trigger(async () => {
				if (token.isCancellationRequested) {
					return [];
				}

				return this.doFileSearch(query, token);
			});
		}

		if (token.isCancellationRequested) {
			return [];
		}

		const configuration = this.configuration;
		return fileMatches
			.filter(resource => !excludes.has(resource))
			.map(resource => this.createAnythingPick(resource, configuration));
	}

	private async doFileSearch(query: IPreparedQuery, token: CancellationToken): Promise<URI[]> {
		const [fileSearchResults, relativePathFileResults] = await Promise.all([

			this.getFileSearchResults(query, token),

			this.getRelativePathFileResults(query, token)
		]);

		if (token.isCancellationRequested) {
			return [];
		}

		if (!relativePathFileResults) {
			return fileSearchResults;
		}

		const relativePathFileResultsMap = new ResourceMap<boolean>(uri => this.uriIdentityService.extUri.getComparisonKey(uri));
		for (const relativePathFileResult of relativePathFileResults) {
			relativePathFileResultsMap.set(relativePathFileResult, true);
		}

		return [
			...fileSearchResults.filter(result => !relativePathFileResultsMap.has(result)),
			...relativePathFileResults
		];
	}

	private async getFileSearchResults(query: IPreparedQuery, token: CancellationToken): Promise<URI[]> {

		let filePattern = '';
		if (query.values && query.values.length > 1) {
			filePattern = query.values[0].original;
		} else {
			filePattern = query.original;
		}

		const fileSearchResults = await this.doGetFileSearchResults(filePattern, token);
		if (token.isCancellationRequested) {
			return [];
		}

		if (fileSearchResults.limitHit && query.values && query.values.length > 1) {
			const additionalFileSearchResults = await this.doGetFileSearchResults(query.original, token);
			if (token.isCancellationRequested) {
				return [];
			}

			const existingFileSearchResultsMap = new ResourceMap<boolean>(uri => this.uriIdentityService.extUri.getComparisonKey(uri));
			for (const fileSearchResult of fileSearchResults.results) {
				existingFileSearchResultsMap.set(fileSearchResult.resource, true);
			}

			for (const additionalFileSearchResult of additionalFileSearchResults.results) {
				if (!existingFileSearchResultsMap.has(additionalFileSearchResult.resource)) {
					fileSearchResults.results.push(additionalFileSearchResult);
				}
			}
		}

		return fileSearchResults.results.map(result => result.resource);
	}

	private doGetFileSearchResults(filePattern: string, token: CancellationToken): Promise<ISearchComplete> {
		const start = Date.now();
		return this.searchService.fileSearch(
			this.fileQueryBuilder.file(
				this.contextService.getWorkspace().folders,
				this.getFileQueryOptions({
					filePattern,
					cacheKey: this.pickState.fileQueryCache?.cacheKey,
					maxResults: AnythingQuickAccessProvider.MAX_RESULTS
				})
			), token).finally(() => {
				this.logService.trace(`QuickAccess fileSearch ${Date.now() - start}ms`);
			});
	}

	private getFileQueryOptions(input: { filePattern?: string; cacheKey?: string; maxResults?: number }): IFileQueryBuilderOptions {
		return {
			_reason: 'openFileHandler',
			extraFileResources: this.instantiationService.invokeFunction(getOutOfWorkspaceEditorResources),
			filePattern: input.filePattern || '',
			cacheKey: input.cacheKey,
			maxResults: input.maxResults || 0,
			sortByScore: true
		};
	}

	private async getAbsolutePathFileResult(query: IPreparedQuery, token: CancellationToken): Promise<URI | undefined> {
		if (!query.containsPathSeparator) {
			return;
		}

		const userHome = await this.pathService.userHome();
		const detildifiedQuery = untildify(query.original, userHome.scheme === Schemas.file ? userHome.fsPath : userHome.path);
		if (token.isCancellationRequested) {
			return;
		}

		const isAbsolutePathQuery = (await this.pathService.path).isAbsolute(detildifiedQuery);
		if (token.isCancellationRequested) {
			return;
		}

		if (isAbsolutePathQuery) {
			const resource = toLocalResource(
				await this.pathService.fileURI(detildifiedQuery),
				this.environmentService.remoteAuthority,
				this.pathService.defaultUriScheme
			);

			if (token.isCancellationRequested) {
				return;
			}

			try {
				const stat = await this.fileService.stat(resource);
				if (stat.isFile) {
					return await this.matchFilenameCasing(resource);
				}
			} catch (error) {
			}
		}

		return;
	}

	private async getRelativePathFileResults(query: IPreparedQuery, token: CancellationToken): Promise<URI[] | undefined> {
		if (!query.containsPathSeparator) {
			return;
		}

		const isAbsolutePathQuery = (await this.pathService.path).isAbsolute(query.original);
		if (!isAbsolutePathQuery) {
			const resources: URI[] = [];
			for (const folder of this.contextService.getWorkspace().folders) {
				if (token.isCancellationRequested) {
					break;
				}

				const resource = toLocalResource(
					folder.toResource(query.original),
					this.environmentService.remoteAuthority,
					this.pathService.defaultUriScheme
				);

				try {
					const stat = await this.fileService.stat(resource);
					if (stat.isFile) {
						resources.push(await this.matchFilenameCasing(resource));
					}
				} catch (error) {
				}
			}

			return resources;
		}

		return;
	}

	private async matchFilenameCasing(resource: URI): Promise<URI> {
		const parent = dirname(resource);
		const stat = await this.fileService.resolve(parent, { resolveTo: [resource] });
		if (stat?.children) {
			const match = stat.children.find(child => this.uriIdentityService.extUri.isEqual(child.resource, resource));
			if (match) {
				return URI.joinPath(parent, match.name);
			}
		}
		return resource;
	}



	private readonly lazyRegistry = new Lazy(() => Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess));

	private getHelpPicks(query: IPreparedQuery, token: CancellationToken, runOptions?: AnythingQuickAccessProviderRunOptions): IAnythingQuickPickItem[] {
		if (query.normalized) {
			return [];
		}

		type IHelpAnythingQuickPickItem = IAnythingQuickPickItem & { commandCenterOrder: number };
		const providers: IHelpAnythingQuickPickItem[] = this.lazyRegistry.value.getQuickAccessProviders(this.contextKeyService)
			.filter(p => p.helpEntries.some(h => h.commandCenterOrder !== undefined))
			.flatMap(provider => provider.helpEntries
				.filter(h => h.commandCenterOrder !== undefined)
				.map(helpEntry => {
					const providerSpecificOptions: AnythingQuickAccessProviderRunOptions | undefined = {
						...runOptions,
						includeHelp: provider.prefix === AnythingQuickAccessProvider.PREFIX ? false : runOptions?.includeHelp
					};

					const label = helpEntry.commandCenterLabel ?? helpEntry.description;
					return {
						label,
						description: helpEntry.prefix ?? provider.prefix,
						commandCenterOrder: helpEntry.commandCenterOrder!,
						keybinding: helpEntry.commandId ? this.keybindingService.lookupKeybinding(helpEntry.commandId) : undefined,
						ariaLabel: localize('helpPickAriaLabel', "{0}, {1}", label, helpEntry.description),
						accept: () => {
							this.quickInputService.quickAccess.show(provider.prefix, {
								preserveValue: true,
								providerOptions: providerSpecificOptions
							});
						}
					};
				}));

		if (this.quickChatService.enabled) {
			providers.push({
				label: localize('chat', "Open Quick Chat"),
				commandCenterOrder: 30,
				keybinding: this.keybindingService.lookupKeybinding(ASK_QUICK_QUESTION_ACTION_ID),
				accept: () => this.quickChatService.toggle()
			});
		}

		return providers.sort((a, b) => a.commandCenterOrder - b.commandCenterOrder);
	}



	private workspaceSymbolsQuickAccess: SymbolsQuickAccessProvider;

	private async getWorkspaceSymbolPicks(query: IPreparedQuery, includeSymbols: boolean, token: CancellationToken): Promise<Array<IAnythingQuickPickItem>> {
		if (
			!query.normalized ||
			!includeSymbols ||
			this.pickState.lastRange
		) {
			return [];
		}

		return this.workspaceSymbolsQuickAccess.getSymbolPicks(query.original, {
			skipLocal: true,
			skipSorting: true,
			delay: AnythingQuickAccessProvider.TYPING_SEARCH_DELAY
		}, token);
	}



	//#region Editor Symbols (if narrowing down into a global pick via `@`)

	private readonly editorSymbolsQuickAccess: GotoSymbolQuickAccessProvider;

	private getEditorSymbolPicks(query: IPreparedQuery, disposables: DisposableStore, token: CancellationToken): Promise<Picks<IAnythingQuickPickItem>> | null {
		const filterSegments = query.original.split(GotoSymbolQuickAccessProvider.PREFIX);
		const filter = filterSegments.length > 1 ? filterSegments[filterSegments.length - 1].trim() : undefined;
		if (typeof filter !== 'string') {
			return null;
		}

		const activeGlobalPick = this.pickState.lastGlobalPicks?.active;
		if (!activeGlobalPick) {
			return null; // we need an active global pick to find symbols for
		}

		const activeGlobalResource = activeGlobalPick.resource;
		if (!activeGlobalResource || (!this.fileService.hasProvider(activeGlobalResource) && activeGlobalResource.scheme !== Schemas.untitled)) {
			return null;
		}

		if (activeGlobalPick.label.includes(GotoSymbolQuickAccessProvider.PREFIX) || activeGlobalPick.description?.includes(GotoSymbolQuickAccessProvider.PREFIX)) {
			if (filterSegments.length < 3) {
				return null;
			}
		}

		return this.doGetEditorSymbolPicks(activeGlobalPick, activeGlobalResource, filter, disposables, token);
	}

	private async doGetEditorSymbolPicks(activeGlobalPick: IAnythingQuickPickItem, activeGlobalResource: URI, filter: string, disposables: DisposableStore, token: CancellationToken): Promise<Picks<IAnythingQuickPickItem>> {

		try {

			this.pickState.editorViewState.set();

			await this.pickState.editorViewState.openTransientEditor({
				resource: activeGlobalResource,
				options: { preserveFocus: true, revealIfOpened: true, ignoreError: true }
			});
		} catch (error) {
			return [];
		}

		if (token.isCancellationRequested) {
			return [];
		}

		let model = this.modelService.getModel(activeGlobalResource);
		if (!model) {
			try {
				const modelReference = disposables.add(await this.textModelService.createModelReference(activeGlobalResource));
				if (token.isCancellationRequested) {
					return [];
				}

				model = modelReference.object.textEditorModel;
			} catch (error) {
				return [];
			}
		}

		const editorSymbolPicks = (await this.editorSymbolsQuickAccess.getSymbolPicks(model, filter, { extraContainerLabel: stripIcons(activeGlobalPick.label) }, disposables, token));
		if (token.isCancellationRequested) {
			return [];
		}

		return editorSymbolPicks.map(editorSymbolPick => {

			if (editorSymbolPick.type === 'separator') {
				return editorSymbolPick;
			}

			return {
				...editorSymbolPick,
				resource: activeGlobalResource,
				description: editorSymbolPick.description,
				trigger: (buttonIndex, keyMods) => {
					this.openAnything(activeGlobalResource, { keyMods, range: editorSymbolPick.range?.selection, forceOpenSideBySide: true });

					return TriggerAction.CLOSE_PICKER;
				},
				accept: (keyMods, event) => this.openAnything(activeGlobalResource, { keyMods, range: editorSymbolPick.range?.selection, preserveFocus: event.inBackground, forcePinned: event.inBackground })
			};
		});
	}

	addDecorations(editor: IEditor, range: IRange): void {
		this.editorSymbolsQuickAccess.addDecorations(editor, range);
	}

	clearDecorations(editor: IEditor): void {
		this.editorSymbolsQuickAccess.clearDecorations(editor);
	}




	private createAnythingPick(resourceOrEditor: URI | EditorInput | IResourceEditorInput, configuration: { openSideBySideDirection: 'right' | 'down' | undefined }): IAnythingQuickPickItem {
		const isEditorHistoryEntry = !URI.isUri(resourceOrEditor);

		let resource: URI | undefined;
		let label: string;
		let description: string | undefined = undefined;
		let isDirty: boolean | undefined = undefined;
		let extraClasses: string[];
		let icon: ThemeIcon | URI | undefined = undefined;

		if (isEditorInput(resourceOrEditor)) {
			resource = EditorResourceAccessor.getOriginalUri(resourceOrEditor);
			label = resourceOrEditor.getName();
			description = resourceOrEditor.getDescription();
			isDirty = resourceOrEditor.isDirty() && !resourceOrEditor.isSaving();
			extraClasses = resourceOrEditor.getLabelExtraClasses();
			icon = resourceOrEditor.getIcon();
		} else {
			resource = URI.isUri(resourceOrEditor) ? resourceOrEditor : resourceOrEditor.resource;
			const customLabel = this.customEditorLabelService.getName(resource);
			label = customLabel || basenameOrAuthority(resource);
			description = this.labelService.getUriLabel(!!customLabel ? resource : dirname(resource), { relative: true });
			isDirty = this.workingCopyService.isDirty(resource) && !this.filesConfigurationService.hasShortAutoSaveDelay(resource);
			extraClasses = [];
		}

		const labelAndDescription = description ? `${label} ${description}` : label;

		const iconClassesValue = new Lazy(() => getIconClasses(this.modelService, this.languageService, resource, undefined, icon).concat(extraClasses));

		const buttonsValue = new Lazy(() => {
			const openSideBySideDirection = configuration.openSideBySideDirection;
			const buttons: IQuickInputButton[] = [];

			buttons.push({
				iconClass: openSideBySideDirection === 'right' ? ThemeIcon.asClassName(Codicon.splitHorizontal) : ThemeIcon.asClassName(Codicon.splitVertical),
				tooltip: openSideBySideDirection === 'right' ?
					localize({ key: 'openToSide', comment: ['Open this file in a split editor on the left/right side'] }, "Open to the Side") :
					localize({ key: 'openToBottom', comment: ['Open this file in a split editor on the bottom'] }, "Open to the Bottom")
			});

			if (isEditorHistoryEntry) {
				buttons.push({
					iconClass: isDirty ? ('dirty-anything ' + ThemeIcon.asClassName(Codicon.circleFilled)) : ThemeIcon.asClassName(Codicon.close),
					tooltip: localize('closeEditor', "Remove from Recently Opened"),
					alwaysVisible: isDirty
				});
			}

			return buttons;
		});

		return {
			resource,
			editor: !URI.isUri(resourceOrEditor) ? resourceOrEditor : undefined,
			label,
			ariaLabel: isDirty ? localize('filePickAriaLabelDirty', "{0} unsaved changes", labelAndDescription) : labelAndDescription,
			description,
			iconPath: URI.isUri(icon) ? { dark: icon } : undefined,
			get iconClasses() { return iconClassesValue.value; },
			get buttons() { return buttonsValue.value; },
			trigger: (buttonIndex, keyMods) => {
				switch (buttonIndex) {

					case 0:
						this.openAnything(resourceOrEditor, { keyMods, range: this.pickState.lastRange, forceOpenSideBySide: true });

						return TriggerAction.CLOSE_PICKER;

					case 1:
						if (!URI.isUri(resourceOrEditor)) {
							this.historyService.removeFromHistory(resourceOrEditor);

							return TriggerAction.REMOVE_ITEM;
						}
				}

				return TriggerAction.NO_ACTION;
			},
			accept: (keyMods, event) => this.openAnything(resourceOrEditor, { keyMods, range: this.pickState.lastRange, preserveFocus: event.inBackground, forcePinned: event.inBackground }),
			attach: (keyMods, event) => {
				if (keyMods.shift) {
					const widget = this.chatWidgetService.lastFocusedWidget;
					if (widget && resource) {
						widget.attachmentModel.addContext(widget.attachmentModel.asFileVariableEntry(resource));
					}
					return;
				}

				this.openAnything(resourceOrEditor, { keyMods, range: this.pickState.lastRange, preserveFocus: event.inBackground, forcePinned: event.inBackground });
			}
		};
	}

	private async openAnything(resourceOrEditor: URI | EditorInput | IResourceEditorInput, options: { keyMods?: IKeyMods; preserveFocus?: boolean; range?: IRange; forceOpenSideBySide?: boolean; forcePinned?: boolean }): Promise<void> {

		const editorOptions: ITextEditorOptions = {
			preserveFocus: options.preserveFocus,
			pinned: options.keyMods?.ctrlCmd || options.forcePinned || this.configuration.openEditorPinned,
			selection: options.range
		};

		const targetGroup = options.keyMods?.alt || (this.configuration.openEditorPinned && options.keyMods?.ctrlCmd) || options.forceOpenSideBySide ? SIDE_GROUP : ACTIVE_GROUP;

		if (targetGroup === SIDE_GROUP) {
			await this.pickState.editorViewState.restore();
		}

		if (isEditorInput(resourceOrEditor)) {
			await this.editorService.openEditor(resourceOrEditor, editorOptions, targetGroup);
		}

		else {
			let resourceEditorInput: IResourceEditorInput;
			if (URI.isUri(resourceOrEditor)) {
				resourceEditorInput = {
					resource: resourceOrEditor,
					options: editorOptions
				};
			} else {
				resourceEditorInput = {
					...resourceOrEditor,
					options: {
						...resourceOrEditor.options,
						...editorOptions
					}
				};
			}

			await this.editorService.openEditor(resourceEditorInput, targetGroup);
		}
	}

}
