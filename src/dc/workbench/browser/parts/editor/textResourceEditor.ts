/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertReturnsDefined } from '../../../../base/common/types.js';
import { ICodeEditor, IPasteEvent } from '../../../../editor/browser/editorBrowser.js';
import { IEditorOpenContext, isTextEditorViewState } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { applyTextEditorOptions } from '../../../common/editor/editorOptions.js';
import { AbstractTextResourceEditorInput, TextResourceEditorInput } from '../../../common/editor/textResourceEditorInput.js';
import { BaseTextEditorModel } from '../../../common/editor/textEditorModel.js';
import { UntitledTextEditorInput } from '../../../services/untitled/common/untitledTextEditorInput.js';
import { AbstractTextCodeEditor } from './textCodeEditor.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ScrollType, ICodeEditorViewState } from '../../../../editor/common/editorCommon.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../editor/common/languages/modesRegistry.js';
import { EditorOption, IEditorOptions as ICodeEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { ModelConstants } from '../../../../editor/common/model.js';
import { ITextEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';

export abstract class AbstractTextResourceEditor extends AbstractTextCodeEditor<ICodeEditorViewState> {

	constructor(
		id: string,
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IFileService fileService: IFileService
	) {
		super(id, group, telemetryService, instantiationService, storageService, textResourceConfigurationService, themeService, editorService, editorGroupService, fileService);
	}

	override async setInput(input: AbstractTextResourceEditorInput, options: ITextEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {

		await super.setInput(input, options, context, token);
		const resolvedModel = await input.resolve();

		if (token.isCancellationRequested) {
			return undefined;
		}

		if (!(resolvedModel instanceof BaseTextEditorModel)) {
			throw new Error('Unable to open file as text');
		}

		const control = assertReturnsDefined(this.editorControl);
		const textEditorModel = resolvedModel.textEditorModel;
		control.setModel(textEditorModel);

		if (!isTextEditorViewState(options?.viewState)) {
			const editorViewState = this.loadEditorViewState(input, context);
			if (editorViewState) {
				if (options?.selection) {
					editorViewState.cursorState = [];
				}

				control.restoreViewState(editorViewState);
			}
		}

		if (options) {
			applyTextEditorOptions(options, control, ScrollType.Immediate);
		}

		control.updateOptions(this.getReadonlyConfiguration(resolvedModel.isReadonly()));
	}

	revealLastLine(): void {
		const control = this.editorControl;
		if (!control) {
			return;
		}

		const model = control.getModel();

		if (model) {
			const lastLine = model.getLineCount();
			control.revealPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) }, ScrollType.Smooth);
		}
	}

	override clearInput(): void {
		super.clearInput();

		this.editorControl?.setModel(null);
	}

	protected override tracksEditorViewState(input: EditorInput): boolean {
		return input instanceof UntitledTextEditorInput || input instanceof TextResourceEditorInput;
	}
}

export class TextResourceEditor extends AbstractTextResourceEditor {

	static readonly ID = 'workbench.editors.textResourceEditor';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IThemeService themeService: IThemeService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IFileService fileService: IFileService
	) {
		super(TextResourceEditor.ID, group, telemetryService, instantiationService, storageService, textResourceConfigurationService, themeService, editorGroupService, editorService, fileService);
	}

	protected override createEditorControl(parent: HTMLElement, configuration: ICodeEditorOptions): void {
		super.createEditorControl(parent, configuration);

		const control = this.editorControl;
		if (control) {
			this._register(control.onDidPaste(e => this.onDidEditorPaste(e, control)));
		}
	}

	private onDidEditorPaste(e: IPasteEvent, codeEditor: ICodeEditor): void {
		if (this.input instanceof UntitledTextEditorInput && this.input.hasLanguageSetExplicitly) {
			return;
		}

		if (e.range.startLineNumber !== 1 || e.range.startColumn !== 1) {
			return;
		}

		if (codeEditor.getOption(EditorOption.readOnly)) {
			return;
		}

		const textModel = codeEditor.getModel();
		if (!textModel) {
			return;
		}

		const pasteIsWholeContents = textModel.getLineCount() === e.range.endLineNumber && textModel.getLineMaxColumn(e.range.endLineNumber) === e.range.endColumn;
		if (!pasteIsWholeContents) {
			return;
		}

		const currentLanguageId = textModel.getLanguageId();
		if (currentLanguageId !== PLAINTEXT_LANGUAGE_ID) {
			return;
		}

		let candidateLanguage: { id: string; source: 'event' | 'guess' } | undefined = undefined;

		if (e.languageId) {
			candidateLanguage = { id: e.languageId, source: 'event' };
		}

		else {
			const guess = this.languageService.guessLanguageIdByFilepathOrFirstLine(textModel.uri, textModel.getLineContent(1).substr(0, ModelConstants.FIRST_LINE_DETECTION_LENGTH_LIMIT)) ?? undefined;
			if (guess) {
				candidateLanguage = { id: guess, source: 'guess' };
			}
		}

		if (candidateLanguage && candidateLanguage.id !== PLAINTEXT_LANGUAGE_ID) {
			if (this.input instanceof UntitledTextEditorInput && candidateLanguage.source === 'event') {
				this.input.setLanguageId(candidateLanguage.id);
			} else {
				textModel.setLanguage(this.languageService.createById(candidateLanguage.id));
			}

			const opts = this.modelService.getCreationOptions(textModel.getLanguageId(), textModel.uri, textModel.isForSimpleWidget);
			textModel.detectIndentation(opts.insertSpaces, opts.tabSize);
		}
	}
}
