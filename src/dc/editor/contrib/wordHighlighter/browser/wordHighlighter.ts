/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { alert } from '../../../../base/browser/ui/aria/aria.js';
import { CancelablePromise, createCancelablePromise, Delayer, first } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { onUnexpectedError, onUnexpectedExternalError } from '../../../../base/common/errors.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { matchesScheme, Schemas } from '../../../../base/common/network.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IActiveCodeEditor, ICodeEditor, isDiffEditor } from '../../../browser/editorBrowser.js';
import { EditorAction, EditorContributionInstantiation, IActionOptions, registerEditorAction, registerEditorContribution, registerModelAndPositionCommand } from '../../../browser/editorExtensions.js';
import { ICodeEditorService } from '../../../browser/services/codeEditorService.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { Position } from '../../../common/core/position.js';
import { Range } from '../../../common/core/range.js';
import { Selection } from '../../../common/core/selection.js';
import { IWordAtPosition } from '../../../common/core/wordHelper.js';
import { CursorChangeReason, ICursorPositionChangedEvent } from '../../../common/cursorEvents.js';
import { IDiffEditor, IEditorContribution, IEditorDecorationsCollection } from '../../../common/editorCommon.js';
import { EditorContextKeys } from '../../../common/editorContextKeys.js';
import { registerEditorFeature } from '../../../common/editorFeatures.js';
import { LanguageFeatureRegistry } from '../../../common/languageFeatureRegistry.js';
import { DocumentHighlight, DocumentHighlightProvider, MultiDocumentHighlightProvider } from '../../../common/languages.js';
import { score } from '../../../common/languageSelector.js';
import { IModelDeltaDecoration, ITextModel, shouldSynchronizeModel } from '../../../common/model.js';
import { ILanguageFeaturesService } from '../../../common/services/languageFeatures.js';
import { ITextModelService } from '../../../common/services/resolverService.js';
import { getHighlightDecorationOptions } from './highlightDecorations.js';
import { TextualMultiDocumentHighlightFeature } from './textualHighlightProvider.js';

const ctxHasWordHighlights = new RawContextKey<boolean>('hasWordHighlights', false);

export function getOccurrencesAtPosition(registry: LanguageFeatureRegistry<DocumentHighlightProvider>, model: ITextModel, position: Position, token: CancellationToken): Promise<ResourceMap<DocumentHighlight[]> | null | undefined> {
	const orderedByScore = registry.ordered(model);

	return first<DocumentHighlight[] | null | undefined>(orderedByScore.map(provider => () => {
		return Promise.resolve(provider.provideDocumentHighlights(model, position, token))
			.then(undefined, onUnexpectedExternalError);
	}), (result): result is DocumentHighlight[] => result !== undefined && result !== null).then(result => {
		if (result) {
			const map = new ResourceMap<DocumentHighlight[]>();
			map.set(model.uri, result);
			return map;
		}
		return new ResourceMap<DocumentHighlight[]>();
	});
}

export function getOccurrencesAcrossMultipleModels(registry: LanguageFeatureRegistry<MultiDocumentHighlightProvider>, model: ITextModel, position: Position, token: CancellationToken, otherModels: ITextModel[]): Promise<ResourceMap<DocumentHighlight[]> | null | undefined> {
	const orderedByScore = registry.ordered(model);

	return first<ResourceMap<DocumentHighlight[]> | null | undefined>(orderedByScore.map(provider => () => {
		const filteredModels = otherModels.filter(otherModel => {
			return shouldSynchronizeModel(otherModel);
		}).filter(otherModel => {
			return score(provider.selector, otherModel.uri, otherModel.getLanguageId(), true, undefined, undefined) > 0;
		});
		return Promise.resolve(provider.provideMultiDocumentHighlights(model, position, filteredModels, token))
			.then(undefined, onUnexpectedExternalError);
	}), (result): result is ResourceMap<DocumentHighlight[]> => result !== undefined && result !== null);
}

interface IOccurenceAtPositionRequest {
	readonly result: Promise<ResourceMap<DocumentHighlight[]>>;
	isValid(model: ITextModel, selection: Selection, decorations: IEditorDecorationsCollection): boolean;
	cancel(): void;
}

interface IWordHighlighterQuery {
	modelInfo: {
		modelURI: URI;
		selection: Selection;
	} | null;
}

abstract class OccurenceAtPositionRequest implements IOccurenceAtPositionRequest {

	private readonly _wordRange: Range | null;
	private _result: CancelablePromise<ResourceMap<DocumentHighlight[]>> | null;

	constructor(private readonly _model: ITextModel, private readonly _selection: Selection, private readonly _wordSeparators: string) {
		this._wordRange = this._getCurrentWordRange(_model, _selection);
		this._result = null;
	}

	get result() {
		if (!this._result) {
			this._result = createCancelablePromise(token => this._compute(this._model, this._selection, this._wordSeparators, token));
		}
		return this._result;
	}

	protected abstract _compute(model: ITextModel, selection: Selection, wordSeparators: string, token: CancellationToken): Promise<ResourceMap<DocumentHighlight[]>>;

	private _getCurrentWordRange(model: ITextModel, selection: Selection): Range | null {
		const word = model.getWordAtPosition(selection.getPosition());
		if (word) {
			return new Range(selection.startLineNumber, word.startColumn, selection.startLineNumber, word.endColumn);
		}
		return null;
	}

	public isValid(model: ITextModel, selection: Selection, decorations: IEditorDecorationsCollection): boolean {

		const lineNumber = selection.startLineNumber;
		const startColumn = selection.startColumn;
		const endColumn = selection.endColumn;
		const currentWordRange = this._getCurrentWordRange(model, selection);

		let requestIsValid = Boolean(this._wordRange && this._wordRange.equalsRange(currentWordRange));

		for (let i = 0, len = decorations.length; !requestIsValid && i < len; i++) {
			const range = decorations.getRange(i);
			if (range && range.startLineNumber === lineNumber) {
				if (range.startColumn <= startColumn && range.endColumn >= endColumn) {
					requestIsValid = true;
				}
			}
		}

		return requestIsValid;
	}

	public cancel(): void {
		this.result.cancel();
	}
}

class SemanticOccurenceAtPositionRequest extends OccurenceAtPositionRequest {

	private readonly _providers: LanguageFeatureRegistry<DocumentHighlightProvider>;

	constructor(model: ITextModel, selection: Selection, wordSeparators: string, providers: LanguageFeatureRegistry<DocumentHighlightProvider>) {
		super(model, selection, wordSeparators);
		this._providers = providers;
	}

	protected _compute(model: ITextModel, selection: Selection, wordSeparators: string, token: CancellationToken): Promise<ResourceMap<DocumentHighlight[]>> {
		return getOccurrencesAtPosition(this._providers, model, selection.getPosition(), token).then(value => {
			if (!value) {
				return new ResourceMap<DocumentHighlight[]>();
			}
			return value;
		});
	}
}

class MultiModelOccurenceRequest extends OccurenceAtPositionRequest {
	private readonly _providers: LanguageFeatureRegistry<MultiDocumentHighlightProvider>;
	private readonly _otherModels: ITextModel[];

	constructor(model: ITextModel, selection: Selection, wordSeparators: string, providers: LanguageFeatureRegistry<MultiDocumentHighlightProvider>, otherModels: ITextModel[]) {
		super(model, selection, wordSeparators);
		this._providers = providers;
		this._otherModels = otherModels;
	}

	protected override _compute(model: ITextModel, selection: Selection, wordSeparators: string, token: CancellationToken): Promise<ResourceMap<DocumentHighlight[]>> {
		return getOccurrencesAcrossMultipleModels(this._providers, model, selection.getPosition(), token, this._otherModels).then(value => {
			if (!value) {
				return new ResourceMap<DocumentHighlight[]>();
			}
			return value;
		});
	}
}


function computeOccurencesAtPosition(registry: LanguageFeatureRegistry<DocumentHighlightProvider>, model: ITextModel, selection: Selection, wordSeparators: string): IOccurenceAtPositionRequest {
	return new SemanticOccurenceAtPositionRequest(model, selection, wordSeparators, registry);
}

function computeOccurencesMultiModel(registry: LanguageFeatureRegistry<MultiDocumentHighlightProvider>, model: ITextModel, selection: Selection, wordSeparators: string, otherModels: ITextModel[]): IOccurenceAtPositionRequest {
	return new MultiModelOccurenceRequest(model, selection, wordSeparators, registry, otherModels);
}

registerModelAndPositionCommand('_executeDocumentHighlights', async (accessor, model, position) => {
	const languageFeaturesService = accessor.get(ILanguageFeaturesService);
	const map = await getOccurrencesAtPosition(languageFeaturesService.documentHighlightProvider, model, position, CancellationToken.None);
	return map?.get(model.uri);
});

class WordHighlighter {

	private readonly editor: IActiveCodeEditor;
	private readonly providers: LanguageFeatureRegistry<DocumentHighlightProvider>;
	private readonly multiDocumentProviders: LanguageFeatureRegistry<MultiDocumentHighlightProvider>;
	private readonly model: ITextModel;
	private readonly decorations: IEditorDecorationsCollection;
	private readonly toUnhook = new DisposableStore();

	private readonly textModelService: ITextModelService;
	private readonly codeEditorService: ICodeEditorService;
	private readonly configurationService: IConfigurationService;
	private readonly logService: ILogService;

	private occurrencesHighlightEnablement: string;
	private occurrencesHighlightDelay: number;

	private workerRequestTokenId: number = 0;
	private workerRequest: IOccurenceAtPositionRequest | null;
	private workerRequestCompleted: boolean = false;
	private workerRequestValue: ResourceMap<DocumentHighlight[]> = new ResourceMap();

	private lastCursorPositionChangeTime: number = 0;
	private renderDecorationsTimer: Timeout | undefined = undefined;

	private readonly _hasWordHighlights: IContextKey<boolean>;
	private _ignorePositionChangeEvent: boolean;

	private readonly runDelayer: Delayer<void> = this.toUnhook.add(new Delayer<void>(50));

	private static storedDecorationIDs: ResourceMap<string[]> = new ResourceMap();
	private static query: IWordHighlighterQuery | null = null;

	constructor(
		editor: IActiveCodeEditor,
		providers: LanguageFeatureRegistry<DocumentHighlightProvider>,
		multiProviders: LanguageFeatureRegistry<MultiDocumentHighlightProvider>,
		contextKeyService: IContextKeyService,
		@ITextModelService textModelService: ITextModelService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService,
	) {
		this.editor = editor;
		this.providers = providers;
		this.multiDocumentProviders = multiProviders;

		this.codeEditorService = codeEditorService;
		this.textModelService = textModelService;
		this.configurationService = configurationService;
		this.logService = logService;

		this._hasWordHighlights = ctxHasWordHighlights.bindTo(contextKeyService);
		this._ignorePositionChangeEvent = false;
		this.occurrencesHighlightEnablement = this.editor.getOption(EditorOption.occurrencesHighlight);
		this.occurrencesHighlightDelay = this.configurationService.getValue<number>('editor.occurrencesHighlightDelay');
		this.model = this.editor.getModel();

		this.toUnhook.add(editor.onDidChangeCursorPosition((e: ICursorPositionChangedEvent) => {
			if (this._ignorePositionChangeEvent) {
				return;
			}

			if (this.occurrencesHighlightEnablement === 'off') {
				return;
			}

			this.runDelayer.trigger(() => { this._onPositionChanged(e); }).catch(onUnexpectedError);
		}));
		this.toUnhook.add(editor.onDidFocusEditorText((e) => {
			if (this.occurrencesHighlightEnablement === 'off') {
				return;
			}

			if (!this.workerRequest) {
				this.runDelayer.trigger(() => { this._run(); }).catch(onUnexpectedError);
			}
		}));
		this.toUnhook.add(editor.onDidChangeModelContent((e) => {
			if (!matchesScheme(this.model.uri, 'output')) {
				this._stopAll();
			}
		}));
		this.toUnhook.add(editor.onDidChangeModel((e) => {
			if (!e.newModelUrl && e.oldModelUrl) {
				this._stopSingular();
			} else if (WordHighlighter.query) {
				this._run();
			}
		}));
		this.toUnhook.add(editor.onDidChangeConfiguration((e) => {
			const newEnablement = this.editor.getOption(EditorOption.occurrencesHighlight);
			if (this.occurrencesHighlightEnablement !== newEnablement) {
				this.occurrencesHighlightEnablement = newEnablement;
				switch (newEnablement) {
					case 'off':
						this._stopAll();
						break;
					case 'singleFile':
						this._stopAll(WordHighlighter.query?.modelInfo?.modelURI);
						break;
					case 'multiFile':
						if (WordHighlighter.query) {
							this._run(true);
						}
						break;
					default:
						console.warn('Unknown occurrencesHighlight setting value:', newEnablement);
						break;
				}
			}
		}));
		this.toUnhook.add(this.configurationService.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('editor.occurrencesHighlightDelay')) {
				const newDelay = configurationService.getValue<number>('editor.occurrencesHighlightDelay');
				if (this.occurrencesHighlightDelay !== newDelay) {
					this.occurrencesHighlightDelay = newDelay;
				}
			}
		}));
		this.toUnhook.add(editor.onDidBlurEditorWidget(() => {

			const activeEditor = this.codeEditorService.getFocusedCodeEditor();
			if (!activeEditor) {
				this._stopAll();
			} else if (activeEditor.getModel()?.uri.scheme === Schemas.vscodeNotebookCell && this.editor.getModel()?.uri.scheme !== Schemas.vscodeNotebookCell) {
				this._stopAll();
			}
		}));

		this.decorations = this.editor.createDecorationsCollection();
		this.workerRequestTokenId = 0;
		this.workerRequest = null;
		this.workerRequestCompleted = false;

		this.lastCursorPositionChangeTime = 0;
		this.renderDecorationsTimer = undefined;

		if (WordHighlighter.query) {
			this._run();
		}
	}

	public hasDecorations(): boolean {
		return (this.decorations.length > 0);
	}

	public restore(delay: number): void {
		if (this.occurrencesHighlightEnablement === 'off') {
			return;
		}

		this.runDelayer.cancel();
		this.runDelayer.trigger(() => { this._run(false, delay); }).catch(onUnexpectedError);
	}

	public trigger() {
		this.runDelayer.cancel();
		this._run(false, 0);
	}

	public stop(): void {
		if (this.occurrencesHighlightEnablement === 'off') {
			return;
		}

		this._stopAll();
	}

	private _getSortedHighlights(): Range[] {
		return (
			this.decorations.getRanges()
				.sort(Range.compareRangesUsingStarts)
		);
	}

	public moveNext() {
		const highlights = this._getSortedHighlights();
		const index = highlights.findIndex((range) => range.containsPosition(this.editor.getPosition()));
		const newIndex = ((index + 1) % highlights.length);
		const dest = highlights[newIndex];
		try {
			this._ignorePositionChangeEvent = true;
			this.editor.setPosition(dest.getStartPosition());
			this.editor.revealRangeInCenterIfOutsideViewport(dest);
			const word = this._getWord();
			if (word) {
				const lineContent = this.editor.getModel().getLineContent(dest.startLineNumber);
				alert(`${lineContent}, ${newIndex + 1} of ${highlights.length} for '${word.word}'`);
			}
		} finally {
			this._ignorePositionChangeEvent = false;
		}
	}

	public moveBack() {
		const highlights = this._getSortedHighlights();
		const index = highlights.findIndex((range) => range.containsPosition(this.editor.getPosition()));
		const newIndex = ((index - 1 + highlights.length) % highlights.length);
		const dest = highlights[newIndex];
		try {
			this._ignorePositionChangeEvent = true;
			this.editor.setPosition(dest.getStartPosition());
			this.editor.revealRangeInCenterIfOutsideViewport(dest);
			const word = this._getWord();
			if (word) {
				const lineContent = this.editor.getModel().getLineContent(dest.startLineNumber);
				alert(`${lineContent}, ${newIndex + 1} of ${highlights.length} for '${word.word}'`);
			}
		} finally {
			this._ignorePositionChangeEvent = false;
		}
	}

	private _removeSingleDecorations(): void {
		if (!this.editor.hasModel()) {
			return;
		}

		const currentDecorationIDs = WordHighlighter.storedDecorationIDs.get(this.editor.getModel().uri);
		if (!currentDecorationIDs) {
			return;
		}

		this.editor.removeDecorations(currentDecorationIDs);
		WordHighlighter.storedDecorationIDs.delete(this.editor.getModel().uri);

		if (this.decorations.length > 0) {
			this.decorations.clear();
			this._hasWordHighlights.set(false);
		}
	}

	private _removeAllDecorations(preservedModel?: URI): void {
		const currentEditors = this.codeEditorService.listCodeEditors();
		const deleteURI = [];
		for (const editor of currentEditors) {
			if (!editor.hasModel() || isEqual(editor.getModel().uri, preservedModel)) {
				continue;
			}

			const currentDecorationIDs = WordHighlighter.storedDecorationIDs.get(editor.getModel().uri);
			if (!currentDecorationIDs) {
				continue;
			}

			editor.removeDecorations(currentDecorationIDs);
			deleteURI.push(editor.getModel().uri);

			const editorHighlighterContrib = WordHighlighterContribution.get(editor);
			if (!editorHighlighterContrib?.wordHighlighter) {
				continue;
			}

			if (editorHighlighterContrib.wordHighlighter.decorations.length > 0) {
				editorHighlighterContrib.wordHighlighter.decorations.clear();
				editorHighlighterContrib.wordHighlighter.workerRequest = null;
				editorHighlighterContrib.wordHighlighter._hasWordHighlights.set(false);
			}
		}

		for (const uri of deleteURI) {
			WordHighlighter.storedDecorationIDs.delete(uri);
		}
	}

	private _stopSingular(): void {
		this._removeSingleDecorations();

		if (this.editor.hasTextFocus()) {
			if (this.editor.getModel()?.uri.scheme !== Schemas.vscodeNotebookCell && WordHighlighter.query?.modelInfo?.modelURI.scheme !== Schemas.vscodeNotebookCell) {
				WordHighlighter.query = null;
				this._run();
			} else {
				if (WordHighlighter.query?.modelInfo) {
					WordHighlighter.query.modelInfo = null;
				}
			}
		}

		if (this.renderDecorationsTimer !== undefined) {
			clearTimeout(this.renderDecorationsTimer);
			this.renderDecorationsTimer = undefined;
		}

		if (this.workerRequest !== null) {
			this.workerRequest.cancel();
			this.workerRequest = null;
		}

		if (!this.workerRequestCompleted) {
			this.workerRequestTokenId++;
			this.workerRequestCompleted = true;
		}
	}

	private _stopAll(preservedModel?: URI): void {
		this._removeAllDecorations(preservedModel);

		if (this.renderDecorationsTimer !== undefined) {
			clearTimeout(this.renderDecorationsTimer);
			this.renderDecorationsTimer = undefined;
		}

		if (this.workerRequest !== null) {
			this.workerRequest.cancel();
			this.workerRequest = null;
		}

		if (!this.workerRequestCompleted) {
			this.workerRequestTokenId++;
			this.workerRequestCompleted = true;
		}
	}

	private _onPositionChanged(e: ICursorPositionChangedEvent): void {

		if (this.occurrencesHighlightEnablement === 'off') {
			this._stopAll();
			return;
		}

		if (e.source !== 'api' && e.reason !== CursorChangeReason.Explicit) {
			this._stopAll();
			return;
		}

		this._run();
	}

	private _getWord(): IWordAtPosition | null {
		const editorSelection = this.editor.getSelection();
		const lineNumber = editorSelection.startLineNumber;
		const startColumn = editorSelection.startColumn;

		if (this.model.isDisposed()) {
			return null;
		}

		return this.model.getWordAtPosition({
			lineNumber: lineNumber,
			column: startColumn
		});
	}

	private getOtherModelsToHighlight(model: ITextModel): ITextModel[] {
		if (!model) {
			return [];
		}

		const isNotebookEditor = model.uri.scheme === Schemas.vscodeNotebookCell;
		if (isNotebookEditor) {
			const currentModels: ITextModel[] = [];
			const currentEditors = this.codeEditorService.listCodeEditors();
			for (const editor of currentEditors) {
				const tempModel = editor.getModel();
				if (tempModel && tempModel !== model && tempModel.uri.scheme === Schemas.vscodeNotebookCell) {
					currentModels.push(tempModel);
				}
			}
			return currentModels;
		}

		const currentModels: ITextModel[] = [];
		const currentEditors = this.codeEditorService.listCodeEditors();
		for (const editor of currentEditors) {
			if (!isDiffEditor(editor)) {
				continue;
			}
			const diffModel = (editor as IDiffEditor).getModel();
			if (!diffModel) {
				continue;
			}
			if (model === diffModel.modified) {
				currentModels.push(diffModel.modified);
			}
		}
		if (currentModels.length) {
			return currentModels;
		}

		if (this.occurrencesHighlightEnablement === 'singleFile') {
			return [];
		}

		for (const editor of currentEditors) {
			const tempModel = editor.getModel();

			const isValidModel = tempModel && tempModel !== model;

			if (isValidModel) {
				currentModels.push(tempModel);
			}
		}
		return currentModels;
	}

	private async _run(multiFileConfigChange?: boolean, delay?: number): Promise<void> {

		const hasTextFocus = this.editor.hasTextFocus();
		if (!hasTextFocus) {
			if (!WordHighlighter.query) {
				this._stopAll();
				return;
			}
		} else {
			const editorSelection = this.editor.getSelection();

			if (!editorSelection || editorSelection.startLineNumber !== editorSelection.endLineNumber) {
				WordHighlighter.query = null;
				this._stopAll();
				return;
			}

			const startColumn = editorSelection.startColumn;
			const endColumn = editorSelection.endColumn;

			const word = this._getWord();

			if (!word || word.startColumn > startColumn || word.endColumn < endColumn) {
				WordHighlighter.query = null;
				this._stopAll();
				return;
			}

			WordHighlighter.query = {
				modelInfo: {
					modelURI: this.model.uri,
					selection: editorSelection,
				}
			};
		}


		this.lastCursorPositionChangeTime = (new Date()).getTime();

		if (isEqual(this.editor.getModel().uri, WordHighlighter.query.modelInfo?.modelURI)) {

			if (!multiFileConfigChange) {
				const currentModelDecorationRanges = this.decorations.getRanges();
				for (const storedRange of currentModelDecorationRanges) {
					if (storedRange.containsPosition(this.editor.getPosition())) {
						return;
					}
				}
			}

			this._stopAll(multiFileConfigChange ? this.model.uri : undefined);

			const myRequestId = ++this.workerRequestTokenId;
			this.workerRequestCompleted = false;

			const otherModelsToHighlight = this.getOtherModelsToHighlight(this.editor.getModel());

			if (!WordHighlighter.query || !WordHighlighter.query.modelInfo) {
				return;
			}

			const queryModelRef = await this.textModelService.createModelReference(WordHighlighter.query.modelInfo.modelURI);
			try {
				this.workerRequest = this.computeWithModel(queryModelRef.object.textEditorModel, WordHighlighter.query.modelInfo.selection, otherModelsToHighlight);
				this.workerRequest?.result.then(data => {
					if (myRequestId === this.workerRequestTokenId) {
						this.workerRequestCompleted = true;
						this.workerRequestValue = data || [];
						this._beginRenderDecorations(delay ?? this.occurrencesHighlightDelay);
					}
				}, onUnexpectedError);
			} catch (e) {
				this.logService.error('Unexpected error during occurrence request. Log: ', e);
			} finally {
				queryModelRef.dispose();
			}

		} else if (this.model.uri.scheme === Schemas.vscodeNotebookCell) {

			const myRequestId = ++this.workerRequestTokenId;
			this.workerRequestCompleted = false;

			if (!WordHighlighter.query || !WordHighlighter.query.modelInfo) {
				return;
			}

			const queryModelRef = await this.textModelService.createModelReference(WordHighlighter.query.modelInfo.modelURI);
			try {
				this.workerRequest = this.computeWithModel(queryModelRef.object.textEditorModel, WordHighlighter.query.modelInfo.selection, [this.model]);
				this.workerRequest?.result.then(data => {
					if (myRequestId === this.workerRequestTokenId) {
						this.workerRequestCompleted = true;
						this.workerRequestValue = data || [];
						this._beginRenderDecorations(delay ?? this.occurrencesHighlightDelay);
					}
				}, onUnexpectedError);
			} catch (e) {
				this.logService.error('Unexpected error during occurrence request. Log: ', e);
			} finally {
				queryModelRef.dispose();
			}
		}
	}

	private computeWithModel(model: ITextModel, selection: Selection, otherModels: ITextModel[]): IOccurenceAtPositionRequest | null {
		if (!otherModels.length) {
			return computeOccurencesAtPosition(this.providers, model, selection, this.editor.getOption(EditorOption.wordSeparators));
		} else {
			return computeOccurencesMultiModel(this.multiDocumentProviders, model, selection, this.editor.getOption(EditorOption.wordSeparators), otherModels);
		}
	}

	private _beginRenderDecorations(delay: number): void {
		const currentTime = (new Date()).getTime();
		const minimumRenderTime = this.lastCursorPositionChangeTime + delay;

		if (currentTime >= minimumRenderTime) {
			this.renderDecorationsTimer = undefined;
			this.renderDecorations();
		} else {
			this.renderDecorationsTimer = setTimeout(() => {
				this.renderDecorations();
			}, (minimumRenderTime - currentTime));
		}
	}

	private renderDecorations(): void {
		this.renderDecorationsTimer = undefined;
		const currentEditors = this.codeEditorService.listCodeEditors();
		for (const editor of currentEditors) {
			const editorHighlighterContrib = WordHighlighterContribution.get(editor);
			if (!editorHighlighterContrib) {
				continue;
			}

			const newDecorations: IModelDeltaDecoration[] = [];
			const uri = editor.getModel()?.uri;
			if (uri && this.workerRequestValue.has(uri)) {
				const oldDecorationIDs: string[] | undefined = WordHighlighter.storedDecorationIDs.get(uri);
				const newDocumentHighlights = this.workerRequestValue.get(uri);
				if (newDocumentHighlights) {
					for (const highlight of newDocumentHighlights) {
						if (!highlight.range) {
							continue;
						}
						newDecorations.push({
							range: highlight.range,
							options: getHighlightDecorationOptions(highlight.kind)
						});
					}
				}

				let newDecorationIDs: string[] = [];
				editor.changeDecorations((changeAccessor) => {
					newDecorationIDs = changeAccessor.deltaDecorations(oldDecorationIDs ?? [], newDecorations);
				});
				WordHighlighter.storedDecorationIDs = WordHighlighter.storedDecorationIDs.set(uri, newDecorationIDs);

				if (newDecorations.length > 0) {
					editorHighlighterContrib.wordHighlighter?.decorations.set(newDecorations);
					editorHighlighterContrib.wordHighlighter?._hasWordHighlights.set(true);
				}
			}
		}

		this.workerRequest = null;
	}

	public dispose(): void {
		this._stopSingular();
		this.toUnhook.dispose();
	}
}

export class WordHighlighterContribution extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.wordHighlighter';

	public static get(editor: ICodeEditor): WordHighlighterContribution | null {
		return editor.getContribution<WordHighlighterContribution>(WordHighlighterContribution.ID);
	}

	private _wordHighlighter: WordHighlighter | null;

	constructor(
		editor: ICodeEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@ITextModelService textModelService: ITextModelService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService,
	) {
		super();
		this._wordHighlighter = null;
		const createWordHighlighterIfPossible = () => {
			if (editor.hasModel() && !editor.getModel().isTooLargeForTokenization() && editor.getModel().uri.scheme !== Schemas.accessibleView) {
				this._wordHighlighter = new WordHighlighter(editor, languageFeaturesService.documentHighlightProvider, languageFeaturesService.multiDocumentHighlightProvider, contextKeyService, textModelService, codeEditorService, configurationService, logService);
			}
		};
		this._register(editor.onDidChangeModel((e) => {
			if (this._wordHighlighter) {
				if (!e.newModelUrl && e.oldModelUrl?.scheme !== Schemas.vscodeNotebookCell) {
					this.wordHighlighter?.stop();
				}

				this._wordHighlighter.dispose();
				this._wordHighlighter = null;
			}
			createWordHighlighterIfPossible();
		}));
		createWordHighlighterIfPossible();
	}

	public get wordHighlighter(): WordHighlighter | null {
		return this._wordHighlighter;
	}

	public saveViewState(): boolean {
		if (this._wordHighlighter && this._wordHighlighter.hasDecorations()) {
			return true;
		}
		return false;
	}

	public moveNext() {
		this._wordHighlighter?.moveNext();
	}

	public moveBack() {
		this._wordHighlighter?.moveBack();
	}

	public restoreViewState(state: boolean | undefined): void {
		if (this._wordHighlighter && state) {
			this._wordHighlighter.restore(250);
		}
	}

	public stopHighlighting() {
		this._wordHighlighter?.stop();
	}

	public override dispose(): void {
		if (this._wordHighlighter) {
			this._wordHighlighter.dispose();
			this._wordHighlighter = null;
		}
		super.dispose();
	}
}


class WordHighlightNavigationAction extends EditorAction {

	private readonly _isNext: boolean;

	constructor(next: boolean, opts: IActionOptions) {
		super(opts);
		this._isNext = next;
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const controller = WordHighlighterContribution.get(editor);
		if (!controller) {
			return;
		}

		if (this._isNext) {
			controller.moveNext();
		} else {
			controller.moveBack();
		}
	}
}

class NextWordHighlightAction extends WordHighlightNavigationAction {
	constructor() {
		super(true, {
			id: 'editor.action.wordHighlight.next',
			label: nls.localize2('wordHighlight.next.label', "Go to Next Symbol Highlight"),
			precondition: ctxHasWordHighlights,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyCode.F7,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}
}

class PrevWordHighlightAction extends WordHighlightNavigationAction {
	constructor() {
		super(false, {
			id: 'editor.action.wordHighlight.prev',
			label: nls.localize2('wordHighlight.previous.label', "Go to Previous Symbol Highlight"),
			precondition: ctxHasWordHighlights,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.Shift | KeyCode.F7,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}
}

class TriggerWordHighlightAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.wordHighlight.trigger',
			label: nls.localize2('wordHighlight.trigger.label', "Trigger Symbol Highlight"),
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: 0,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const controller = WordHighlighterContribution.get(editor);
		if (!controller) {
			return;
		}

		controller.restoreViewState(true);
	}
}

registerEditorContribution(WordHighlighterContribution.ID, WordHighlighterContribution, EditorContributionInstantiation.Eager);
registerEditorAction(NextWordHighlightAction);
registerEditorAction(PrevWordHighlightAction);
registerEditorAction(TriggerWordHighlightAction);
registerEditorFeature(TextualMultiDocumentHighlightFeature);
