/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { distinct, deepClone } from '../../../../base/common/objects.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { isObject, assertReturnsDefined } from '../../../../base/common/types.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorOpenContext, IEditorPaneSelection, EditorPaneSelectionCompareResult, EditorPaneSelectionChangeReason, IEditorPaneWithSelection, IEditorPaneSelectionChangeEvent, IEditorPaneScrollPosition, IEditorPaneWithScrolling } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { computeEditorAriaLabel } from '../../editor.js';
import { AbstractEditorWithViewState } from './editorWithViewState.js';
import { IEditorViewState } from '../../../../editor/common/editorCommon.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITextResourceConfigurationChangeEvent, ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { IEditorOptions as ICodeEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorOptions, ITextEditorOptions, TextEditorSelectionRevealType, TextEditorSelectionSource } from '../../../../platform/editor/common/editor.js';
import { ICursorPositionChangedEvent } from '../../../../editor/common/cursorEvents.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';

export interface IEditorConfiguration {
	editor: object;
	diffEditor: object;
	accessibility?: {
		verbosity?: {
			diffEditor?: boolean;
		};
	};
	problems?: {
		visibility?: boolean;
	};
}

export abstract class AbstractTextEditor<T extends IEditorViewState> extends AbstractEditorWithViewState<T> implements IEditorPaneWithSelection, IEditorPaneWithScrolling {

	private static readonly VIEW_STATE_PREFERENCE_KEY = 'textEditorViewState';

	protected readonly _onDidChangeSelection = this._register(new Emitter<IEditorPaneSelectionChangeEvent>());
	readonly onDidChangeSelection = this._onDidChangeSelection.event;

	protected readonly _onDidChangeScroll = this._register(new Emitter<void>());
	readonly onDidChangeScroll = this._onDidChangeScroll.event;

	private editorContainer: HTMLElement | undefined;

	private hasPendingConfigurationChange: boolean | undefined;
	private lastAppliedEditorOptions?: ICodeEditorOptions;

	private readonly inputListener = this._register(new MutableDisposable());

	constructor(
		id: string,
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IThemeService themeService: IThemeService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IFileService protected readonly fileService: IFileService
	) {
		super(id, group, AbstractTextEditor.VIEW_STATE_PREFERENCE_KEY, telemetryService, instantiationService, storageService, textResourceConfigurationService, themeService, editorService, editorGroupService);

		this._register(this.textResourceConfigurationService.onDidChangeConfiguration(e => this.handleConfigurationChangeEvent(e)));


		this._register(Event.any(this.editorGroupService.onDidAddGroup, this.editorGroupService.onDidRemoveGroup)(() => {
			const ariaLabel = this.computeAriaLabel();

			this.editorContainer?.setAttribute('aria-label', ariaLabel);
			this.updateEditorControlOptions({ ariaLabel });
		}));

		this._register(this.fileService.onDidChangeFileSystemProviderCapabilities(e => this.onDidChangeFileSystemProvider(e.scheme)));
		this._register(this.fileService.onDidChangeFileSystemProviderRegistrations(e => this.onDidChangeFileSystemProvider(e.scheme)));
	}

	private handleConfigurationChangeEvent(e: ITextResourceConfigurationChangeEvent): void {
		const resource = this.getActiveResource();
		if (!this.shouldHandleConfigurationChangeEvent(e, resource)) {
			return;
		}

		if (this.isVisible()) {
			this.updateEditorConfiguration(resource);
		} else {
			this.hasPendingConfigurationChange = true;
		}
	}

	protected shouldHandleConfigurationChangeEvent(e: ITextResourceConfigurationChangeEvent, resource: URI | undefined): boolean {
		return e.affectsConfiguration(resource, 'editor') || e.affectsConfiguration(resource, 'problems.visibility');
	}

	private consumePendingConfigurationChangeEvent(): void {
		if (this.hasPendingConfigurationChange) {
			this.updateEditorConfiguration();
			this.hasPendingConfigurationChange = false;
		}
	}

	protected computeConfiguration(configuration: IEditorConfiguration): ICodeEditorOptions {

		const editorConfiguration: ICodeEditorOptions = isObject(configuration.editor) ? deepClone(configuration.editor) : Object.create(null);
		Object.assign(editorConfiguration, this.getConfigurationOverrides(configuration));

		editorConfiguration.ariaLabel = this.computeAriaLabel();

		return editorConfiguration;
	}

	protected computeAriaLabel(): string {
		return this.input ? computeEditorAriaLabel(this.input, undefined, this.group, this.editorGroupService.count) : localize('editor', "Editor");
	}

	private onDidChangeFileSystemProvider(scheme: string): void {
		if (!this.input) {
			return;
		}

		if (this.getActiveResource()?.scheme === scheme) {
			this.updateReadonly(this.input);
		}
	}

	private onDidChangeInputCapabilities(input: EditorInput): void {
		if (this.input === input) {
			this.updateReadonly(input);
		}
	}

	protected updateReadonly(input: EditorInput): void {
		this.updateEditorControlOptions({ ...this.getReadonlyConfiguration(input.isReadonly()) });
	}

	protected getReadonlyConfiguration(isReadonly: boolean | IMarkdownString | undefined): { readOnly: boolean; readOnlyMessage: IMarkdownString | undefined } {
		return {
			readOnly: !!isReadonly,
			readOnlyMessage: typeof isReadonly !== 'boolean' ? isReadonly : undefined
		};
	}

	protected getConfigurationOverrides(configuration: IEditorConfiguration): ICodeEditorOptions {
		return {
			overviewRulerLanes: 3,
			lineNumbersMinChars: 3,
			fixedOverflowWidgets: true,
			...this.getReadonlyConfiguration(this.input?.isReadonly()),
			renderValidationDecorations: configuration.problems?.visibility !== false ? 'on' : 'off'
		};
	}

	protected createEditor(parent: HTMLElement): void {

		this.editorContainer = parent;
		this.createEditorControl(parent, this.computeConfiguration(this.textResourceConfigurationService.getValue<IEditorConfiguration>(this.getActiveResource())));

		this.registerCodeEditorListeners();
	}

	private registerCodeEditorListeners(): void {
		const mainControl = this.getMainControl();
		if (mainControl) {
			this._register(mainControl.onDidChangeModelLanguage(() => this.updateEditorConfiguration()));
			this._register(mainControl.onDidChangeModel(() => this.updateEditorConfiguration()));
			this._register(mainControl.onDidChangeCursorPosition(e => this._onDidChangeSelection.fire({ reason: this.toEditorPaneSelectionChangeReason(e) })));
			this._register(mainControl.onDidChangeModelContent(() => this._onDidChangeSelection.fire({ reason: EditorPaneSelectionChangeReason.EDIT })));
			this._register(mainControl.onDidScrollChange(() => this._onDidChangeScroll.fire()));
		}
	}

	private toEditorPaneSelectionChangeReason(e: ICursorPositionChangedEvent): EditorPaneSelectionChangeReason {
		switch (e.source) {
			case TextEditorSelectionSource.PROGRAMMATIC: return EditorPaneSelectionChangeReason.PROGRAMMATIC;
			case TextEditorSelectionSource.NAVIGATION: return EditorPaneSelectionChangeReason.NAVIGATION;
			case TextEditorSelectionSource.JUMP: return EditorPaneSelectionChangeReason.JUMP;
			default: return EditorPaneSelectionChangeReason.USER;
		}
	}

	getSelection(): IEditorPaneSelection | undefined {
		const mainControl = this.getMainControl();
		if (mainControl) {
			const selection = mainControl.getSelection();
			if (selection) {
				return new TextEditorPaneSelection(selection);
			}
		}

		return undefined;
	}

	protected abstract createEditorControl(parent: HTMLElement, initialOptions: ICodeEditorOptions): void;

	protected abstract updateEditorControlOptions(options: ICodeEditorOptions): void;

	protected abstract getMainControl(): ICodeEditor | undefined;

	override async setInput(input: EditorInput, options: ITextEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		this.inputListener.value = input.onDidChangeCapabilities(() => this.onDidChangeInputCapabilities(input));

		this.updateEditorConfiguration();

		const editorContainer = assertReturnsDefined(this.editorContainer);
		editorContainer.setAttribute('aria-label', this.computeAriaLabel());
	}

	override clearInput(): void {

		this.inputListener.clear();

		super.clearInput();
	}

	getScrollPosition(): IEditorPaneScrollPosition {
		const editor = this.getMainControl();
		if (!editor) {
			throw new Error('Control has not yet been initialized');
		}

		return {
			scrollTop: editor.getScrollTop() - editor.getTopForLineNumber(1),
			scrollLeft: editor.getScrollLeft(),
		};
	}

	setScrollPosition(scrollPosition: IEditorPaneScrollPosition): void {
		const editor = this.getMainControl();
		if (!editor) {
			throw new Error('Control has not yet been initialized');
		}

		editor.setScrollTop(scrollPosition.scrollTop);
		if (scrollPosition.scrollLeft) {
			editor.setScrollLeft(scrollPosition.scrollLeft);
		}
	}

	protected override setEditorVisible(visible: boolean): void {
		if (visible) {
			this.consumePendingConfigurationChangeEvent();
		}

		super.setEditorVisible(visible);
	}

	protected override toEditorViewStateResource(input: EditorInput): URI | undefined {
		return input.resource;
	}

	private updateEditorConfiguration(resource = this.getActiveResource()): void {
		let configuration: IEditorConfiguration | undefined = undefined;
		if (resource) {
			configuration = this.textResourceConfigurationService.getValue<IEditorConfiguration>(resource);
		}

		if (!configuration) {
			return;
		}

		const editorConfiguration = this.computeConfiguration(configuration);

		let editorSettingsToApply = editorConfiguration;
		if (this.lastAppliedEditorOptions) {
			editorSettingsToApply = distinct(this.lastAppliedEditorOptions, editorSettingsToApply);
		}

		if (Object.keys(editorSettingsToApply).length > 0) {
			this.lastAppliedEditorOptions = editorConfiguration;

			this.updateEditorControlOptions(editorSettingsToApply);
		}
	}

	private getActiveResource(): URI | undefined {
		const mainControl = this.getMainControl();
		if (mainControl) {
			const model = mainControl.getModel();
			if (model) {
				return model.uri;
			}
		}

		if (this.input) {
			return this.input.resource;
		}

		return undefined;
	}

	override dispose(): void {
		this.lastAppliedEditorOptions = undefined;

		super.dispose();
	}
}

export class TextEditorPaneSelection implements IEditorPaneSelection {

	private static readonly TEXT_EDITOR_SELECTION_THRESHOLD = 10;

	constructor(
		private readonly textSelection: Selection
	) { }

	compare(other: IEditorPaneSelection): EditorPaneSelectionCompareResult {
		if (!(other instanceof TextEditorPaneSelection)) {
			return EditorPaneSelectionCompareResult.DIFFERENT;
		}

		const thisLineNumber = Math.min(this.textSelection.selectionStartLineNumber, this.textSelection.positionLineNumber);
		const otherLineNumber = Math.min(other.textSelection.selectionStartLineNumber, other.textSelection.positionLineNumber);

		if (thisLineNumber === otherLineNumber) {
			return EditorPaneSelectionCompareResult.IDENTICAL;
		}

		if (Math.abs(thisLineNumber - otherLineNumber) < TextEditorPaneSelection.TEXT_EDITOR_SELECTION_THRESHOLD) {
			return EditorPaneSelectionCompareResult.SIMILAR;
		}

		return EditorPaneSelectionCompareResult.DIFFERENT;
	}

	restore(options: IEditorOptions): ITextEditorOptions {
		const textEditorOptions: ITextEditorOptions = {
			...options,
			selection: this.textSelection,
			selectionRevealType: TextEditorSelectionRevealType.CenterIfOutsideViewport
		};

		return textEditorOptions;
	}

	log(): string {
		return `line: ${this.textSelection.startLineNumber}-${this.textSelection.endLineNumber}, col:  ${this.textSelection.startColumn}-${this.textSelection.endColumn}`;
	}
}
