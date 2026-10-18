/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as aria from '../../../base/browser/ui/aria/aria.js';
import { Disposable, IDisposable, toDisposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { ICodeEditor, IDiffEditor, IDiffEditorConstructionOptions } from '../../browser/editorBrowser.js';
import { ICodeEditorService } from '../../browser/services/codeEditorService.js';
import { CodeEditorWidget } from '../../browser/widget/codeEditor/codeEditorWidget.js';
import { IDiffEditorOptions, IEditorOptions } from '../../common/config/editorOptions.js';
import { InternalEditorAction } from '../../common/editorAction.js';
import { IModelChangedEvent } from '../../common/editorCommon.js';
import { ITextModel } from '../../common/model.js';
import { StandaloneKeybindingService, updateConfigurationService } from './standaloneServices.js';
import { IStandaloneThemeService } from '../common/standaloneTheme.js';
import { IMenuItem, MenuId, MenuRegistry } from '../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandHandler, ICommandService } from '../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr, ContextKeyValue, IContextKey, IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../platform/contextview/browser/contextView.js';
import { IInstantiationService, ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IThemeService } from '../../../platform/theme/common/themeService.js';
import { IAccessibilityService } from '../../../platform/accessibility/common/accessibility.js';
import { StandaloneCodeEditorNLS } from '../../common/standaloneStrings.js';
import { IClipboardService } from '../../../platform/clipboard/common/clipboardService.js';
import { IEditorProgressService } from '../../../platform/progress/common/progress.js';
import { StandaloneThemeService } from './standaloneThemeService.js';
import { IModelService } from '../../common/services/model.js';
import { ILanguageSelection, ILanguageService } from '../../common/languages/language.js';
import { URI } from '../../../base/common/uri.js';
import { StandaloneCodeEditorService } from './standaloneCodeEditorService.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../common/languages/modesRegistry.js';
import { ILanguageConfigurationService } from '../../common/languages/languageConfigurationRegistry.js';
import { IEditorConstructionOptions } from '../../browser/config/editorConfiguration.js';
import { ILanguageFeaturesService } from '../../common/services/languageFeatures.js';
import { DiffEditorWidget } from '../../browser/widget/diffEditor/diffEditorWidget.js';
import { IAccessibilitySignalService } from '../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { mainWindow } from '../../../base/browser/window.js';
import { setHoverDelegateFactory } from '../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverService, WorkbenchHoverDelegate } from '../../../platform/hover/browser/hover.js';
import { setBaseLayerHoverDelegate } from '../../../base/browser/ui/hover/hoverDelegate2.js';
import { IMarkdownRendererService } from '../../../platform/markdown/browser/markdownRenderer.js';
import { EditorMarkdownCodeBlockRenderer } from '../../browser/widget/markdownRenderer/browser/editorMarkdownCodeBlockRenderer.js';
import { IUserInteractionService } from '../../../platform/userInteraction/browser/userInteractionService.js';

export interface IActionDescriptor {
	id: string;
	label: string;
	precondition?: string;
	keybindings?: number[];
	keybindingContext?: string;
	contextMenuGroupId?: string;
	contextMenuOrder?: number;
	run(editor: ICodeEditor, ...args: unknown[]): void | Promise<void>;
}

export interface IGlobalEditorOptions {
	tabSize?: number;
	insertSpaces?: boolean;
	detectIndentation?: boolean;
	trimAutoWhitespace?: boolean;
	largeFileOptimizations?: boolean;
	wordBasedSuggestions?: 'off' | 'currentDocument' | 'matchingDocuments' | 'allDocuments';
	wordBasedSuggestionsOnlySameLanguage?: boolean;
	'semanticHighlighting.enabled'?: true | false | 'configuredByTheme';
	stablePeek?: boolean;
	maxTokenizationLineLength?: number;
	theme?: string;
	autoDetectHighContrast?: boolean;
}

export interface IStandaloneEditorConstructionOptions extends IEditorConstructionOptions, IGlobalEditorOptions {
	model?: ITextModel | null;
	value?: string;
	language?: string;
	theme?: string;
	autoDetectHighContrast?: boolean;
	accessibilityHelpUrl?: string;
	ariaContainerElement?: HTMLElement;
}

export interface IStandaloneDiffEditorConstructionOptions extends IDiffEditorConstructionOptions {
	theme?: string;
	autoDetectHighContrast?: boolean;
}

export interface IStandaloneCodeEditor extends ICodeEditor {
	updateOptions(newOptions: IEditorOptions & IGlobalEditorOptions): void;
	addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null;
	createContextKey<T extends ContextKeyValue = ContextKeyValue>(key: string, defaultValue: T): IContextKey<T>;
	addAction(descriptor: IActionDescriptor): IDisposable;
}

export interface IStandaloneDiffEditor extends IDiffEditor {
	addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null;
	createContextKey<T extends ContextKeyValue = ContextKeyValue>(key: string, defaultValue: T): IContextKey<T>;
	addAction(descriptor: IActionDescriptor): IDisposable;

	getOriginalEditor(): IStandaloneCodeEditor;
	getModifiedEditor(): IStandaloneCodeEditor;
}

let LAST_GENERATED_COMMAND_ID = 0;

let ariaDomNodeCreated = false;
function createAriaDomNode(parent: HTMLElement | undefined) {
	if (!parent) {
		if (ariaDomNodeCreated) {
			return;
		}
		ariaDomNodeCreated = true;
	}
	aria.setARIAContainer(parent || mainWindow.document.body);
}

export class StandaloneCodeEditor extends CodeEditorWidget implements IStandaloneCodeEditor {

	private readonly _standaloneKeybindingService: StandaloneKeybindingService | null;

	constructor(
		domElement: HTMLElement,
		_options: Readonly<IStandaloneEditorConstructionOptions>,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@ICommandService commandService: ICommandService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHoverService hoverService: IHoverService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IThemeService themeService: IThemeService,
		@INotificationService notificationService: INotificationService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@ILanguageConfigurationService languageConfigurationService: ILanguageConfigurationService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IMarkdownRendererService markdownRendererService: IMarkdownRendererService,
		@IUserInteractionService userInteractionService: IUserInteractionService,
	) {
		const options = { ..._options };
		options.ariaLabel = options.ariaLabel || StandaloneCodeEditorNLS.editorViewAccessibleLabel;
		super(domElement, options, {}, instantiationService, codeEditorService, commandService, contextKeyService, themeService, notificationService, accessibilityService, languageConfigurationService, languageFeaturesService, userInteractionService);

		if (keybindingService instanceof StandaloneKeybindingService) {
			this._standaloneKeybindingService = keybindingService;
		} else {
			this._standaloneKeybindingService = null;
		}

		createAriaDomNode(options.ariaContainerElement);

		setHoverDelegateFactory((placement, enableInstantHover) => instantiationService.createInstance(WorkbenchHoverDelegate, placement, { instantHover: enableInstantHover }, {}));
		setBaseLayerHoverDelegate(hoverService);

		markdownRendererService.setDefaultCodeBlockRenderer(instantiationService.createInstance(EditorMarkdownCodeBlockRenderer));
	}

	public addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null {
		if (!this._standaloneKeybindingService) {
			console.warn('Cannot add command because the editor is configured with an unrecognized KeybindingService');
			return null;
		}
		const commandId = 'DYNAMIC_' + (++LAST_GENERATED_COMMAND_ID);
		const whenExpression = ContextKeyExpr.deserialize(context);
		this._standaloneKeybindingService.addDynamicKeybinding(commandId, keybinding, handler, whenExpression);
		return commandId;
	}

	public createContextKey<T extends ContextKeyValue = ContextKeyValue>(key: string, defaultValue: T): IContextKey<T> {
		return this._contextKeyService.createKey(key, defaultValue);
	}

	public addAction(_descriptor: IActionDescriptor): IDisposable {
		if ((typeof _descriptor.id !== 'string') || (typeof _descriptor.label !== 'string') || (typeof _descriptor.run !== 'function')) {
			throw new Error('Invalid action descriptor, `id`, `label` and `run` are required properties!');
		}
		if (!this._standaloneKeybindingService) {
			console.warn('Cannot add keybinding because the editor is configured with an unrecognized KeybindingService');
			return Disposable.None;
		}

		const id = _descriptor.id;
		const label = _descriptor.label;
		const precondition = ContextKeyExpr.and(
			ContextKeyExpr.equals('editorId', this.getId()),
			ContextKeyExpr.deserialize(_descriptor.precondition)
		);
		const keybindings = _descriptor.keybindings;
		const keybindingsWhen = ContextKeyExpr.and(
			precondition,
			ContextKeyExpr.deserialize(_descriptor.keybindingContext)
		);
		const contextMenuGroupId = _descriptor.contextMenuGroupId || null;
		const contextMenuOrder = _descriptor.contextMenuOrder || 0;
		const run = (_accessor?: ServicesAccessor, ...args: unknown[]): Promise<void> => {
			return Promise.resolve(_descriptor.run(this, ...args));
		};


		const toDispose = new DisposableStore();

		const uniqueId = this.getId() + ':' + id;

		toDispose.add(CommandsRegistry.registerCommand(uniqueId, run));

		if (contextMenuGroupId) {
			const menuItem: IMenuItem = {
				command: {
					id: uniqueId,
					title: label
				},
				when: precondition,
				group: contextMenuGroupId,
				order: contextMenuOrder
			};
			toDispose.add(MenuRegistry.appendMenuItem(MenuId.EditorContext, menuItem));
		}

		if (Array.isArray(keybindings)) {
			for (const kb of keybindings) {
				toDispose.add(this._standaloneKeybindingService.addDynamicKeybinding(uniqueId, kb, run, keybindingsWhen));
			}
		}

		const internalAction = new InternalEditorAction(
			uniqueId,
			label,
			label,
			undefined,
			precondition,
			(...args: unknown[]) => Promise.resolve(_descriptor.run(this, ...args)),
			this._contextKeyService
		);

		this._actions.set(id, internalAction);
		toDispose.add(toDisposable(() => {
			this._actions.delete(id);
		}));

		return toDispose;
	}

	protected override _triggerCommand(handlerId: string, payload: unknown): void {
		if (this._codeEditorService instanceof StandaloneCodeEditorService) {
			try {
				this._codeEditorService.setActiveCodeEditor(this);
				super._triggerCommand(handlerId, payload);
			} finally {
				this._codeEditorService.setActiveCodeEditor(null);
			}
		} else {
			super._triggerCommand(handlerId, payload);
		}
	}
}

export class StandaloneEditor extends StandaloneCodeEditor implements IStandaloneCodeEditor {

	private readonly _configurationService: IConfigurationService;
	private readonly _standaloneThemeService: IStandaloneThemeService;
	private _ownsModel: boolean;

	constructor(
		domElement: HTMLElement,
		_options: Readonly<IStandaloneEditorConstructionOptions> | undefined,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@ICommandService commandService: ICommandService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHoverService hoverService: IHoverService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IStandaloneThemeService themeService: IStandaloneThemeService,
		@INotificationService notificationService: INotificationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IModelService modelService: IModelService,
		@ILanguageService languageService: ILanguageService,
		@ILanguageConfigurationService languageConfigurationService: ILanguageConfigurationService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IMarkdownRendererService markdownRendererService: IMarkdownRendererService,
		@IUserInteractionService userInteractionService: IUserInteractionService,
	) {
		const options = { ..._options };
		updateConfigurationService(configurationService, options, false);
		const themeDomRegistration = (<StandaloneThemeService>themeService).registerEditorContainer(domElement);
		if (typeof options.theme === 'string') {
			themeService.setTheme(options.theme);
		}
		if (typeof options.autoDetectHighContrast !== 'undefined') {
			themeService.setAutoDetectHighContrast(Boolean(options.autoDetectHighContrast));
		}
		const _model: ITextModel | null | undefined = options.model;
		delete options.model;
		super(domElement, options, instantiationService, codeEditorService, commandService, contextKeyService, hoverService, keybindingService, themeService, notificationService, accessibilityService, languageConfigurationService, languageFeaturesService, markdownRendererService, userInteractionService);

		this._configurationService = configurationService;
		this._standaloneThemeService = themeService;
		this._register(themeDomRegistration);

		let model: ITextModel | null;
		if (typeof _model === 'undefined') {
			const languageId = languageService.getLanguageIdByMimeType(options.language) || options.language || PLAINTEXT_LANGUAGE_ID;
			model = createTextModel(modelService, languageService, options.value || '', languageId, undefined);
			this._ownsModel = true;
		} else {
			model = _model;
			this._ownsModel = false;
		}

		this._attachModel(model);
		if (model) {
			const e: IModelChangedEvent = {
				oldModelUrl: null,
				newModelUrl: model.uri
			};
			this._onDidChangeModel.fire(e);
		}
	}


	public override updateOptions(newOptions: Readonly<IEditorOptions & IGlobalEditorOptions>): void {
		updateConfigurationService(this._configurationService, newOptions, false);
		if (typeof newOptions.theme === 'string') {
			this._standaloneThemeService.setTheme(newOptions.theme);
		}
		if (typeof newOptions.autoDetectHighContrast !== 'undefined') {
			this._standaloneThemeService.setAutoDetectHighContrast(Boolean(newOptions.autoDetectHighContrast));
		}
		super.updateOptions(newOptions);
	}

	protected override _postDetachModelCleanup(detachedModel: ITextModel): void {
		super._postDetachModelCleanup(detachedModel);
		if (detachedModel && this._ownsModel) {
			detachedModel.dispose();
			this._ownsModel = false;
		}
	}
}

export class StandaloneDiffEditor2 extends DiffEditorWidget implements IStandaloneDiffEditor {

	private readonly _configurationService: IConfigurationService;
	private readonly _standaloneThemeService: IStandaloneThemeService;

	constructor(
		domElement: HTMLElement,
		_options: Readonly<IStandaloneDiffEditorConstructionOptions> | undefined,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IStandaloneThemeService themeService: IStandaloneThemeService,
		@INotificationService notificationService: INotificationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IEditorProgressService editorProgressService: IEditorProgressService,
		@IClipboardService clipboardService: IClipboardService,
		@IAccessibilitySignalService accessibilitySignalService: IAccessibilitySignalService,
	) {
		const options = { ..._options };
		updateConfigurationService(configurationService, options, true);
		const themeDomRegistration = (<StandaloneThemeService>themeService).registerEditorContainer(domElement);
		if (typeof options.theme === 'string') {
			themeService.setTheme(options.theme);
		}
		if (typeof options.autoDetectHighContrast !== 'undefined') {
			themeService.setAutoDetectHighContrast(Boolean(options.autoDetectHighContrast));
		}

		super(
			domElement,
			options,
			{},
			contextKeyService,
			instantiationService,
			codeEditorService,
			accessibilitySignalService,
			editorProgressService,
		);

		this._configurationService = configurationService;
		this._standaloneThemeService = themeService;

		this._register(themeDomRegistration);
	}


	public override updateOptions(newOptions: Readonly<IDiffEditorOptions & IGlobalEditorOptions>): void {
		updateConfigurationService(this._configurationService, newOptions, true);
		if (typeof newOptions.theme === 'string') {
			this._standaloneThemeService.setTheme(newOptions.theme);
		}
		if (typeof newOptions.autoDetectHighContrast !== 'undefined') {
			this._standaloneThemeService.setAutoDetectHighContrast(Boolean(newOptions.autoDetectHighContrast));
		}
		super.updateOptions(newOptions);
	}

	protected override _createInnerEditor(instantiationService: IInstantiationService, container: HTMLElement, options: Readonly<IEditorOptions>): CodeEditorWidget {
		return instantiationService.createInstance(StandaloneCodeEditor, container, options);
	}

	public override getOriginalEditor(): IStandaloneCodeEditor {
		return <StandaloneCodeEditor>super.getOriginalEditor();
	}

	public override getModifiedEditor(): IStandaloneCodeEditor {
		return <StandaloneCodeEditor>super.getModifiedEditor();
	}

	public addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null {
		return this.getModifiedEditor().addCommand(keybinding, handler, context);
	}

	public createContextKey<T extends ContextKeyValue = ContextKeyValue>(key: string, defaultValue: T): IContextKey<T> {
		return this.getModifiedEditor().createContextKey(key, defaultValue);
	}

	public addAction(descriptor: IActionDescriptor): IDisposable {
		return this.getModifiedEditor().addAction(descriptor);
	}
}

/**
 * @internal
 */
export function createTextModel(modelService: IModelService, languageService: ILanguageService, value: string, languageId: string | undefined, uri: URI | undefined): ITextModel {
	value = value || '';
	if (!languageId) {
		const firstLF = value.indexOf('\n');
		let firstLine = value;
		if (firstLF !== -1) {
			firstLine = value.substring(0, firstLF);
		}
		return doCreateModel(modelService, value, languageService.createByFilepathOrFirstLine(uri || null, firstLine), uri);
	}
	return doCreateModel(modelService, value, languageService.createById(languageId), uri);
}

/**
 * @internal
 */
function doCreateModel(modelService: IModelService, value: string, languageSelection: ILanguageSelection, uri: URI | undefined): ITextModel {
	return modelService.createModel(value, languageSelection, uri);
}
