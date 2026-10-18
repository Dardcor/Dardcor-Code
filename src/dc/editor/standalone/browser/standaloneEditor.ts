/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../base/browser/window.js';
import { Disposable, DisposableStore, IDisposable } from '../../../base/common/lifecycle.js';
import { splitLines } from '../../../base/common/strings.js';
import { URI } from '../../../base/common/uri.js';
import './standalone-tokens.css';
import { FontMeasurements } from '../../browser/config/fontMeasurements.js';
import { ICodeEditor } from '../../browser/editorBrowser.js';
import { EditorCommand, ServicesAccessor } from '../../browser/editorExtensions.js';
import { ICodeEditorService } from '../../browser/services/codeEditorService.js';
import { IInternalWebWorkerOptions, MonacoWebWorker, createWebWorker as actualCreateWebWorker } from './standaloneWebWorker.js';
import { ApplyUpdateResult, ConfigurationChangedEvent, EditorOptions } from '../../common/config/editorOptions.js';
import { EditorZoom } from '../../common/config/editorZoom.js';
import { BareFontInfo, FontInfo } from '../../common/config/fontInfo.js';
import { IPosition } from '../../common/core/position.js';
import { IRange } from '../../common/core/range.js';
import { EditorType, IDiffEditor } from '../../common/editorCommon.js';
import * as languages from '../../common/languages.js';
import { ILanguageService } from '../../common/languages/language.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../common/languages/modesRegistry.js';
import { NullState, nullTokenize } from '../../common/languages/nullTokenize.js';
import { FindMatch, ITextModel, TextModelResolvedOptions } from '../../common/model.js';
import { IModelService } from '../../common/services/model.js';
import * as standaloneEnums from '../../common/standalone/standaloneEnums.js';
import { Colorizer, IColorizerElementOptions, IColorizerOptions } from './colorizer.js';
import { IActionDescriptor, IStandaloneCodeEditor, IStandaloneDiffEditor, IStandaloneDiffEditorConstructionOptions, IStandaloneEditorConstructionOptions, StandaloneDiffEditor2, StandaloneEditor, createTextModel } from './standaloneCodeEditor.js';
import { IEditorOverrideServices, StandaloneKeybindingService, StandaloneServices } from './standaloneServices.js';
import { StandaloneThemeService } from './standaloneThemeService.js';
import { IStandaloneThemeData, IStandaloneThemeService } from '../common/standaloneTheme.js';
import { IMenuItem, MenuId, MenuRegistry } from '../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandHandler } from '../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { ITextResourceEditorInput } from '../../../platform/editor/common/editor.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { IMarker, IMarkerData, IMarkerService } from '../../../platform/markers/common/markers.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { MultiDiffEditorWidget } from '../../browser/widget/multiDiffEditor/multiDiffEditorWidget.js';
import { MultiDiffEditorVariant } from '../../browser/widget/multiDiffEditor/multiDiffEditorOptions.js';
import { IWebWorkerService } from '../../../platform/webWorker/browser/webWorkerService.js';

export function create(domElement: HTMLElement, options?: IStandaloneEditorConstructionOptions, override?: IEditorOverrideServices): IStandaloneCodeEditor {
	const instantiationService = StandaloneServices.initialize(override || {});
	return instantiationService.createInstance(StandaloneEditor, domElement, options);
}

export function onDidCreateEditor(listener: (codeEditor: ICodeEditor) => void): IDisposable {
	const codeEditorService = StandaloneServices.get(ICodeEditorService);
	return codeEditorService.onCodeEditorAdd((editor) => {
		listener(editor);
	});
}

export function onDidCreateDiffEditor(listener: (diffEditor: IDiffEditor) => void): IDisposable {
	const codeEditorService = StandaloneServices.get(ICodeEditorService);
	return codeEditorService.onDiffEditorAdd((editor) => {
		listener(<IDiffEditor>editor);
	});
}

export function getEditors(): readonly ICodeEditor[] {
	const codeEditorService = StandaloneServices.get(ICodeEditorService);
	return codeEditorService.listCodeEditors();
}

export function getDiffEditors(): readonly IDiffEditor[] {
	const codeEditorService = StandaloneServices.get(ICodeEditorService);
	return codeEditorService.listDiffEditors();
}

export function createDiffEditor(domElement: HTMLElement, options?: IStandaloneDiffEditorConstructionOptions, override?: IEditorOverrideServices): IStandaloneDiffEditor {
	const instantiationService = StandaloneServices.initialize(override || {});
	return instantiationService.createInstance(StandaloneDiffEditor2, domElement, options);
}

export function createMultiFileDiffEditor(domElement: HTMLElement, override?: IEditorOverrideServices) {
	const instantiationService = StandaloneServices.initialize(override || {});
	return new MultiDiffEditorWidget(domElement, {} as any, { variant: MultiDiffEditorVariant.Standard }, instantiationService);
}

export interface ICommandDescriptor {
	id: string;
	run: ICommandHandler;
}

export function addCommand(descriptor: ICommandDescriptor): IDisposable {
	if ((typeof descriptor.id !== 'string') || (typeof descriptor.run !== 'function')) {
		throw new Error('Invalid command descriptor, `id` and `run` are required properties!');
	}
	return CommandsRegistry.registerCommand(descriptor.id, descriptor.run);
}

export function addEditorAction(descriptor: IActionDescriptor): IDisposable {
	if ((typeof descriptor.id !== 'string') || (typeof descriptor.label !== 'string') || (typeof descriptor.run !== 'function')) {
		throw new Error('Invalid action descriptor, `id`, `label` and `run` are required properties!');
	}

	const precondition = ContextKeyExpr.deserialize(descriptor.precondition);
	const run = (accessor: ServicesAccessor, ...args: unknown[]): void | Promise<void> => {
		return EditorCommand.runEditorCommand(accessor, args, precondition, (accessor, editor, args) => Promise.resolve(descriptor.run(editor, ...args)));
	};

	const toDispose = new DisposableStore();

	toDispose.add(CommandsRegistry.registerCommand(descriptor.id, run));

	if (descriptor.contextMenuGroupId) {
		const menuItem: IMenuItem = {
			command: {
				id: descriptor.id,
				title: descriptor.label
			},
			when: precondition,
			group: descriptor.contextMenuGroupId,
			order: descriptor.contextMenuOrder || 0
		};
		toDispose.add(MenuRegistry.appendMenuItem(MenuId.EditorContext, menuItem));
	}

	if (Array.isArray(descriptor.keybindings)) {
		const keybindingService = StandaloneServices.get(IKeybindingService);
		if (!(keybindingService instanceof StandaloneKeybindingService)) {
			console.warn('Cannot add keybinding because the editor is configured with an unrecognized KeybindingService');
		} else {
			const keybindingsWhen = ContextKeyExpr.and(precondition, ContextKeyExpr.deserialize(descriptor.keybindingContext));
			toDispose.add(keybindingService.addDynamicKeybindings(descriptor.keybindings.map((keybinding) => {
				return {
					keybinding,
					command: descriptor.id,
					when: keybindingsWhen
				};
			})));
		}
	}

	return toDispose;
}

export interface IKeybindingRule {
	keybinding: number;
	command?: string | null;
	commandArgs?: any;
	when?: string | null;
}

export function addKeybindingRule(rule: IKeybindingRule): IDisposable {
	return addKeybindingRules([rule]);
}

export function addKeybindingRules(rules: IKeybindingRule[]): IDisposable {
	const keybindingService = StandaloneServices.get(IKeybindingService);
	if (!(keybindingService instanceof StandaloneKeybindingService)) {
		console.warn('Cannot add keybinding because the editor is configured with an unrecognized KeybindingService');
		return Disposable.None;
	}

	return keybindingService.addDynamicKeybindings(rules.map((rule) => {
		return {
			keybinding: rule.keybinding,
			command: rule.command,
			commandArgs: rule.commandArgs,
			when: ContextKeyExpr.deserialize(rule.when),
		};
	}));
}

export function createModel(value: string, language?: string, uri?: URI): ITextModel {
	const languageService = StandaloneServices.get(ILanguageService);
	const languageId = languageService.getLanguageIdByMimeType(language) || language;
	return createTextModel(
		StandaloneServices.get(IModelService),
		languageService,
		value,
		languageId,
		uri
	);
}

export function setModelLanguage(model: ITextModel, mimeTypeOrLanguageId: string): void {
	const languageService = StandaloneServices.get(ILanguageService);
	const languageId = languageService.getLanguageIdByMimeType(mimeTypeOrLanguageId) || mimeTypeOrLanguageId || PLAINTEXT_LANGUAGE_ID;
	model.setLanguage(languageService.createById(languageId));
}

export function setModelMarkers(model: ITextModel, owner: string, markers: IMarkerData[]): void {
	if (model) {
		const markerService = StandaloneServices.get(IMarkerService);
		markerService.changeOne(owner, model.uri, markers);
	}
}

export function removeAllMarkers(owner: string) {
	const markerService = StandaloneServices.get(IMarkerService);
	markerService.changeAll(owner, []);
}

export function getModelMarkers(filter: { owner?: string; resource?: URI; take?: number }): IMarker[] {
	const markerService = StandaloneServices.get(IMarkerService);
	return markerService.read(filter);
}

export function onDidChangeMarkers(listener: (e: readonly URI[]) => void): IDisposable {
	const markerService = StandaloneServices.get(IMarkerService);
	return markerService.onMarkerChanged(listener);
}

export function getModel(uri: URI): ITextModel | null {
	const modelService = StandaloneServices.get(IModelService);
	return modelService.getModel(uri);
}

export function getModels(): ITextModel[] {
	const modelService = StandaloneServices.get(IModelService);
	return modelService.getModels();
}

export function onDidCreateModel(listener: (model: ITextModel) => void): IDisposable {
	const modelService = StandaloneServices.get(IModelService);
	return modelService.onModelAdded(listener);
}

export function onWillDisposeModel(listener: (model: ITextModel) => void): IDisposable {
	const modelService = StandaloneServices.get(IModelService);
	return modelService.onModelRemoved(listener);
}

export function onDidChangeModelLanguage(listener: (e: { readonly model: ITextModel; readonly oldLanguage: string }) => void): IDisposable {
	const modelService = StandaloneServices.get(IModelService);
	return modelService.onModelLanguageChanged((e) => {
		listener({
			model: e.model,
			oldLanguage: e.oldLanguageId
		});
	});
}

export function createWebWorker<T extends object>(opts: IInternalWebWorkerOptions): MonacoWebWorker<T> {
	return actualCreateWebWorker<T>(StandaloneServices.get(IModelService), StandaloneServices.get(IWebWorkerService), opts);
}

export function colorizeElement(domNode: HTMLElement, options: IColorizerElementOptions): Promise<void> {
	const languageService = StandaloneServices.get(ILanguageService);
	const themeService = <StandaloneThemeService>StandaloneServices.get(IStandaloneThemeService);
	return Colorizer.colorizeElement(themeService, languageService, domNode, options).then(() => {
		themeService.registerEditorContainer(domNode);
	});
}

export function colorize(text: string, languageId: string, options: IColorizerOptions): Promise<string> {
	const languageService = StandaloneServices.get(ILanguageService);
	const themeService = <StandaloneThemeService>StandaloneServices.get(IStandaloneThemeService);
	themeService.registerEditorContainer(mainWindow.document.body);
	return Colorizer.colorize(languageService, text, languageId, options);
}

export function colorizeModelLine(model: ITextModel, lineNumber: number, tabSize: number = 4): string {
	const themeService = <StandaloneThemeService>StandaloneServices.get(IStandaloneThemeService);
	themeService.registerEditorContainer(mainWindow.document.body);
	return Colorizer.colorizeModelLine(model, lineNumber, tabSize);
}

/**
 * @internal
 */
function getSafeTokenizationSupport(language: string): Omit<languages.ITokenizationSupport, 'tokenizeEncoded'> {
	const tokenizationSupport = languages.TokenizationRegistry.get(language);
	if (tokenizationSupport) {
		return tokenizationSupport;
	}
	return {
		getInitialState: () => NullState,
		tokenize: (line: string, hasEOL: boolean, state: languages.IState) => nullTokenize(language, state)
	};
}

export function tokenize(text: string, languageId: string): languages.Token[][] {
	languages.TokenizationRegistry.getOrCreate(languageId);

	const tokenizationSupport = getSafeTokenizationSupport(languageId);
	const lines = splitLines(text);
	const result: languages.Token[][] = [];
	let state = tokenizationSupport.getInitialState();
	for (let i = 0, len = lines.length; i < len; i++) {
		const line = lines[i];
		const tokenizationResult = tokenizationSupport.tokenize(line, true, state);

		result[i] = tokenizationResult.tokens;
		state = tokenizationResult.endState;
	}
	return result;
}

export function defineTheme(themeName: string, themeData: IStandaloneThemeData): void {
	const standaloneThemeService = StandaloneServices.get(IStandaloneThemeService);
	standaloneThemeService.defineTheme(themeName, themeData);
}

export function setTheme(themeName: string): void {
	const standaloneThemeService = StandaloneServices.get(IStandaloneThemeService);
	standaloneThemeService.setTheme(themeName);
}

export function remeasureFonts(): void {
	FontMeasurements.clearAllFontInfos();
}

export function registerCommand(id: string, handler: (accessor: any, ...args: any[]) => void): IDisposable {
	return CommandsRegistry.registerCommand({ id, handler });
}

export interface ILinkOpener {
	open(resource: URI): boolean | Promise<boolean>;
}

export function registerLinkOpener(opener: ILinkOpener): IDisposable {
	const openerService = StandaloneServices.get(IOpenerService);
	return openerService.registerOpener({
		async open(resource: string | URI) {
			if (typeof resource === 'string') {
				resource = URI.parse(resource);
			}
			return opener.open(resource);
		}
	});
}

export interface ICodeEditorOpener {
	openCodeEditor(source: ICodeEditor, resource: URI, selectionOrPosition?: IRange | IPosition): boolean | Promise<boolean>;
}

export function registerEditorOpener(opener: ICodeEditorOpener): IDisposable {
	const codeEditorService = StandaloneServices.get(ICodeEditorService);
	return codeEditorService.registerCodeEditorOpenHandler(async (input: ITextResourceEditorInput, source: ICodeEditor | null, sideBySide?: boolean) => {
		if (!source) {
			return null;
		}
		const selection = input.options?.selection;
		let selectionOrPosition: IRange | IPosition | undefined;
		if (selection && typeof selection.endLineNumber === 'number' && typeof selection.endColumn === 'number') {
			selectionOrPosition = <IRange>selection;
		} else if (selection) {
			selectionOrPosition = { lineNumber: selection.startLineNumber, column: selection.startColumn };
		}
		if (await opener.openCodeEditor(source, input.resource, selectionOrPosition)) {
			return source;
		}
		return null;
	});
}

/**
 * @internal
 */
export function createMonacoEditorAPI(): typeof monaco.editor {
	return {
		// eslint-disable-next-line local/code-no-any-casts
		create: <any>create,
		// eslint-disable-next-line local/code-no-any-casts
		getEditors: <any>getEditors,
		// eslint-disable-next-line local/code-no-any-casts
		getDiffEditors: <any>getDiffEditors,
		// eslint-disable-next-line local/code-no-any-casts
		onDidCreateEditor: <any>onDidCreateEditor,
		// eslint-disable-next-line local/code-no-any-casts
		onDidCreateDiffEditor: <any>onDidCreateDiffEditor,
		// eslint-disable-next-line local/code-no-any-casts
		createDiffEditor: <any>createDiffEditor,

		// eslint-disable-next-line local/code-no-any-casts
		addCommand: <any>addCommand,
		// eslint-disable-next-line local/code-no-any-casts
		addEditorAction: <any>addEditorAction,
		// eslint-disable-next-line local/code-no-any-casts
		addKeybindingRule: <any>addKeybindingRule,
		// eslint-disable-next-line local/code-no-any-casts
		addKeybindingRules: <any>addKeybindingRules,

		// eslint-disable-next-line local/code-no-any-casts
		createModel: <any>createModel,
		// eslint-disable-next-line local/code-no-any-casts
		setModelLanguage: <any>setModelLanguage,
		// eslint-disable-next-line local/code-no-any-casts
		setModelMarkers: <any>setModelMarkers,
		// eslint-disable-next-line local/code-no-any-casts
		getModelMarkers: <any>getModelMarkers,
		removeAllMarkers: removeAllMarkers,
		// eslint-disable-next-line local/code-no-any-casts
		onDidChangeMarkers: <any>onDidChangeMarkers,
		// eslint-disable-next-line local/code-no-any-casts
		getModels: <any>getModels,
		// eslint-disable-next-line local/code-no-any-casts
		getModel: <any>getModel,
		// eslint-disable-next-line local/code-no-any-casts
		onDidCreateModel: <any>onDidCreateModel,
		// eslint-disable-next-line local/code-no-any-casts
		onWillDisposeModel: <any>onWillDisposeModel,
		// eslint-disable-next-line local/code-no-any-casts
		onDidChangeModelLanguage: <any>onDidChangeModelLanguage,


		// eslint-disable-next-line local/code-no-any-casts
		createWebWorker: <any>createWebWorker,
		// eslint-disable-next-line local/code-no-any-casts
		colorizeElement: <any>colorizeElement,
		// eslint-disable-next-line local/code-no-any-casts
		colorize: <any>colorize,
		// eslint-disable-next-line local/code-no-any-casts
		colorizeModelLine: <any>colorizeModelLine,
		// eslint-disable-next-line local/code-no-any-casts
		tokenize: <any>tokenize,
		// eslint-disable-next-line local/code-no-any-casts
		defineTheme: <any>defineTheme,
		// eslint-disable-next-line local/code-no-any-casts
		setTheme: <any>setTheme,
		remeasureFonts: remeasureFonts,
		registerCommand: registerCommand,

		registerLinkOpener: registerLinkOpener,
		// eslint-disable-next-line local/code-no-any-casts
		registerEditorOpener: <any>registerEditorOpener,

		AccessibilitySupport: standaloneEnums.AccessibilitySupport,
		ContentWidgetPositionPreference: standaloneEnums.ContentWidgetPositionPreference,
		CursorChangeReason: standaloneEnums.CursorChangeReason,
		DefaultEndOfLine: standaloneEnums.DefaultEndOfLine,
		EditorAutoIndentStrategy: standaloneEnums.EditorAutoIndentStrategy,
		EditorOption: standaloneEnums.EditorOption,
		EndOfLinePreference: standaloneEnums.EndOfLinePreference,
		EndOfLineSequence: standaloneEnums.EndOfLineSequence,
		MinimapPosition: standaloneEnums.MinimapPosition,
		MinimapSectionHeaderStyle: standaloneEnums.MinimapSectionHeaderStyle,
		MouseTargetType: standaloneEnums.MouseTargetType,
		OverlayWidgetPositionPreference: standaloneEnums.OverlayWidgetPositionPreference,
		OverviewRulerLane: standaloneEnums.OverviewRulerLane,
		GlyphMarginLane: standaloneEnums.GlyphMarginLane,
		RenderLineNumbersType: standaloneEnums.RenderLineNumbersType,
		RenderMinimap: standaloneEnums.RenderMinimap,
		ScrollbarVisibility: standaloneEnums.ScrollbarVisibility,
		ScrollType: standaloneEnums.ScrollType,
		TextEditorCursorBlinkingStyle: standaloneEnums.TextEditorCursorBlinkingStyle,
		TextEditorCursorStyle: standaloneEnums.TextEditorCursorStyle,
		TrackedRangeStickiness: standaloneEnums.TrackedRangeStickiness,
		WrappingIndent: standaloneEnums.WrappingIndent,
		InjectedTextCursorStops: standaloneEnums.InjectedTextCursorStops,
		PositionAffinity: standaloneEnums.PositionAffinity,
		ShowLightbulbIconMode: standaloneEnums.ShowLightbulbIconMode,
		TextDirection: standaloneEnums.TextDirection,

		// eslint-disable-next-line local/code-no-any-casts
		ConfigurationChangedEvent: <any>ConfigurationChangedEvent,
		// eslint-disable-next-line local/code-no-any-casts
		BareFontInfo: <any>BareFontInfo,
		// eslint-disable-next-line local/code-no-any-casts
		FontInfo: <any>FontInfo,
		// eslint-disable-next-line local/code-no-any-casts
		TextModelResolvedOptions: <any>TextModelResolvedOptions,
		// eslint-disable-next-line local/code-no-any-casts
		FindMatch: <any>FindMatch,
		// eslint-disable-next-line local/code-no-any-casts
		ApplyUpdateResult: <any>ApplyUpdateResult,
		// eslint-disable-next-line local/code-no-any-casts
		EditorZoom: <any>EditorZoom,

		// eslint-disable-next-line local/code-no-any-casts
		createMultiFileDiffEditor: <any>createMultiFileDiffEditor,

		EditorType: EditorType,
		// eslint-disable-next-line local/code-no-any-casts
		EditorOptions: <any>EditorOptions

	};
}
