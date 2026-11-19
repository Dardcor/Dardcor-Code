/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISaveOptions } from '../../../common/editor.js';
import { BaseTextEditorModel } from '../../../common/editor/textEditorModel.js';
import { URI } from '../../../../base/common/uri.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IWorkingCopyBackupService } from '../../workingCopy/common/workingCopyBackup.js';
import { ITextResourceConfigurationChangeEvent, ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { createTextBufferFactory, createTextBufferFactoryFromStream } from '../../../../editor/common/model/textModel.js';
import { ITextEditorModel } from '../../../../editor/common/services/resolverService.js';
import { IWorkingCopyService } from '../../workingCopy/common/workingCopyService.js';
import { IWorkingCopy, WorkingCopyCapabilities, IWorkingCopyBackup, NO_TYPE_ID, IWorkingCopySaveEvent } from '../../workingCopy/common/workingCopy.js';
import { IEncodingSupport, ILanguageSupport, ITextFileService } from '../../textfile/common/textfiles.js';
import { IModelContentChangedEvent } from '../../../../editor/common/textModelEvents.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ensureValidWordDefinition } from '../../../../editor/common/core/wordHelper.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { getCharContainingOffset } from '../../../../base/common/strings.js';
import { UTF8 } from '../../textfile/common/encoding.js';
import { bufferToReadable, bufferToStream, VSBuffer, VSBufferReadable, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { ILanguageDetectionService } from '../../languageDetection/common/languageDetectionWorkerService.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';

export interface IUntitledTextEditorModel extends ITextEditorModel, ILanguageSupport, IEncodingSupport, IWorkingCopy {

	readonly onDidChangeEncoding: Event<void>;

	readonly onDidChangeName: Event<void>;

	readonly onDidRevert: Event<void>;

	readonly hasAssociatedFilePath: boolean;

	readonly hasLanguageSetExplicitly: boolean;

	setEncoding(encoding: string): Promise<void>;

	resolve(): Promise<void>;

	isResolved(): this is IResolvedUntitledTextEditorModel;
}

export interface IResolvedUntitledTextEditorModel extends IUntitledTextEditorModel {

	readonly textEditorModel: ITextModel;
}

export class UntitledTextEditorModel extends BaseTextEditorModel implements IUntitledTextEditorModel {

	private static readonly FIRST_LINE_NAME_MAX_LENGTH = 40;
	private static readonly FIRST_LINE_NAME_CANDIDATE_MAX_LENGTH = this.FIRST_LINE_NAME_MAX_LENGTH * 10;

	private static readonly ACTIVE_EDITOR_LANGUAGE_ID = '${activeEditorLanguage}';


	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	private readonly _onDidChangeName = this._register(new Emitter<void>());
	readonly onDidChangeName = this._onDidChangeName.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidChangeEncoding = this._register(new Emitter<void>());
	readonly onDidChangeEncoding = this._onDidChangeEncoding.event;

	private readonly _onDidSave = this._register(new Emitter<IWorkingCopySaveEvent>());
	readonly onDidSave = this._onDidSave.event;

	private readonly _onDidRevert = this._register(new Emitter<void>());
	readonly onDidRevert = this._onDidRevert.event;


	readonly typeId = NO_TYPE_ID;

	readonly capabilities = WorkingCopyCapabilities.Untitled;


	private configuredLabelFormat: 'content' | 'name' = 'content';

	private cachedModelFirstLineWords: string | undefined = undefined;
	get name(): string {

		if (this.configuredLabelFormat === 'content' && !this.hasAssociatedFilePath && this.cachedModelFirstLineWords) {
			return this.cachedModelFirstLineWords;
		}

		return this.labelService.getUriBasenameLabel(this.resource);
	}


	constructor(
		readonly resource: URI,
		readonly hasAssociatedFilePath: boolean,
		private readonly initialValue: string | undefined,
		private preferredLanguageId: string | undefined,
		private preferredEncoding: string | undefined,
		@ILanguageService languageService: ILanguageService,
		@IModelService modelService: IModelService,
		@IWorkingCopyBackupService private readonly workingCopyBackupService: IWorkingCopyBackupService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IEditorService private readonly editorService: IEditorService,
		@ILanguageDetectionService languageDetectionService: ILanguageDetectionService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
	) {
		super(modelService, languageService, languageDetectionService, accessibilityService);

		this.dirty = this.hasAssociatedFilePath || !!this.initialValue;

		this._register(this.workingCopyService.registerWorkingCopy(this));

		if (preferredLanguageId) {
			this.setLanguageId(preferredLanguageId);
		}

		this.onConfigurationChange(undefined, false);

		this.registerListeners();
	}

	private registerListeners(): void {

		this._register(this.textResourceConfigurationService.onDidChangeConfiguration(e => this.onConfigurationChange(e, true)));
	}

	private onConfigurationChange(e: ITextResourceConfigurationChangeEvent | undefined, fromEvent: boolean): void {

		if (!e || e.affectsConfiguration(this.resource, 'files.encoding')) {
			const configuredEncoding = this.textResourceConfigurationService.getValue(this.resource, 'files.encoding');
			if (this.configuredEncoding !== configuredEncoding && typeof configuredEncoding === 'string') {
				this.configuredEncoding = configuredEncoding;

				if (fromEvent && !this.preferredEncoding) {
					this._onDidChangeEncoding.fire();
				}
			}
		}

		if (!e || e.affectsConfiguration(this.resource, 'workbench.editor.untitled.labelFormat')) {
			const configuredLabelFormat = this.textResourceConfigurationService.getValue(this.resource, 'workbench.editor.untitled.labelFormat');
			if (this.configuredLabelFormat !== configuredLabelFormat && (configuredLabelFormat === 'content' || configuredLabelFormat === 'name')) {
				this.configuredLabelFormat = configuredLabelFormat;

				if (fromEvent) {
					this._onDidChangeName.fire();
				}
			}
		}
	}


	override setLanguageId(languageId: string, source?: string): void {
		const actualLanguage: string | undefined = languageId === UntitledTextEditorModel.ACTIVE_EDITOR_LANGUAGE_ID
			? this.editorService.activeTextEditorLanguageId
			: languageId;
		this.preferredLanguageId = actualLanguage;

		if (actualLanguage) {
			super.setLanguageId(actualLanguage, source);
		}
	}

	override getLanguageId(): string | undefined {
		if (this.textEditorModel) {
			return this.textEditorModel.getLanguageId();
		}

		return this.preferredLanguageId;
	}



	private configuredEncoding: string | undefined;

	getEncoding(): string | undefined {
		return this.preferredEncoding || this.configuredEncoding;
	}

	async setEncoding(encoding: string): Promise<void> {
		const oldEncoding = this.getEncoding();
		this.preferredEncoding = encoding;

		if (oldEncoding !== this.preferredEncoding) {
			this._onDidChangeEncoding.fire();
		}
	}



	private dirty: boolean;

	isDirty(): boolean {
		return this.dirty;
	}

	isModified(): boolean {
		return this.isDirty();
	}

	private setDirty(dirty: boolean): void {
		if (this.dirty === dirty) {
			return;
		}

		this.dirty = dirty;
		this._onDidChangeDirty.fire();
	}



	async save(options?: ISaveOptions): Promise<boolean> {
		const target = await this.textFileService.save(this.resource, options);

		if (target) {
			this._onDidSave.fire({ reason: options?.reason, source: options?.source });
		}

		return !!target;
	}

	async revert(): Promise<void> {

		this.ignoreDirtyOnModelContentChange = true;
		try {
			this.updateTextEditorModel(createTextBufferFactory(''));
		} finally {
			this.ignoreDirtyOnModelContentChange = false;
		}

		this.setDirty(false);

		this._onDidRevert.fire();
	}

	async backup(token: CancellationToken): Promise<IWorkingCopyBackup> {
		let content: VSBufferReadable | undefined = undefined;

		if (this.isResolved()) {
			content = await this.textFileService.getEncodedReadable(this.resource, this.createSnapshot() ?? undefined, { encoding: UTF8 });
		} else if (typeof this.initialValue === 'string') {
			content = bufferToReadable(VSBuffer.fromString(this.initialValue));
		}

		return { content };
	}



	private ignoreDirtyOnModelContentChange = false;

	override async resolve(): Promise<void> {

		let createdUntitledModel = false;
		let hasBackup = false;
		if (!this.textEditorModel) {
			let untitledContents: VSBufferReadableStream;

			const backup = await this.workingCopyBackupService.resolve(this);
			if (backup) {
				untitledContents = backup.value;
				hasBackup = true;
			} else {
				untitledContents = bufferToStream(VSBuffer.fromString(this.initialValue || ''));
			}

			const untitledContentsFactory = await createTextBufferFactoryFromStream(await this.textFileService.getDecodedStream(this.resource, untitledContents, { encoding: UTF8 }));

			this.createTextEditorModel(untitledContentsFactory, this.resource, this.preferredLanguageId);
			createdUntitledModel = true;
		}

		else {
			this.updateTextEditorModel(undefined, this.preferredLanguageId);
		}

		const textEditorModel = assertReturnsDefined(this.textEditorModel);
		this.installModelListeners(textEditorModel);

		if (createdUntitledModel) {

			if (hasBackup || this.initialValue) {
				this.updateNameFromFirstLine(textEditorModel);
			}

			this.setDirty(this.hasAssociatedFilePath || !!hasBackup || !!this.initialValue);

			if (hasBackup || this.initialValue) {
				this._onDidChangeContent.fire();
			}
		}

		return super.resolve();
	}

	override isResolved(): this is IResolvedUntitledTextEditorModel {
		return !!this.textEditorModelHandle;
	}

	protected override installModelListeners(model: ITextModel): void {
		this._register(model.onDidChangeContent(e => this.onModelContentChanged(model, e)));
		this._register(model.onDidChangeLanguage(() => this.onConfigurationChange(undefined, true)));

		super.installModelListeners(model);
	}

	private onModelContentChanged(textEditorModel: ITextModel, e: IModelContentChangedEvent): void {
		if (!this.ignoreDirtyOnModelContentChange) {

			if (!this.hasAssociatedFilePath && textEditorModel.getLineCount() === 1 && textEditorModel.getLineLength(1) === 0) {
				this.setDirty(false);
			}

			else {
				this.setDirty(true);
			}
		}

		if (e.changes.some(change => (change.range.startLineNumber === 1 || change.range.endLineNumber === 1) && change.range.startColumn <= UntitledTextEditorModel.FIRST_LINE_NAME_CANDIDATE_MAX_LENGTH)) {
			this.updateNameFromFirstLine(textEditorModel);
		}

		this._onDidChangeContent.fire();

		this.autoDetectLanguage();
	}

	private updateNameFromFirstLine(textEditorModel: ITextModel): void {
		if (this.hasAssociatedFilePath) {
			return;
		}


		let modelFirstWordsCandidate: string | undefined = undefined;

		let firstLineText = textEditorModel
			.getValueInRange({
				startLineNumber: 1,
				endLineNumber: 1,
				startColumn: 1,
				endColumn: UntitledTextEditorModel.FIRST_LINE_NAME_CANDIDATE_MAX_LENGTH + 1
			})
			.trim().replace(/\s+/g, ' ')
			.replace(/\u202E/g, '');
		firstLineText = firstLineText.substr(0, getCharContainingOffset(
			firstLineText,
			UntitledTextEditorModel.FIRST_LINE_NAME_MAX_LENGTH)[0]
		);

		if (firstLineText && ensureValidWordDefinition().exec(firstLineText)) {
			modelFirstWordsCandidate = firstLineText;
		}

		if (modelFirstWordsCandidate !== this.cachedModelFirstLineWords) {
			this.cachedModelFirstLineWords = modelFirstWordsCandidate;
			this._onDidChangeName.fire();
		}
	}


	override isReadonly(): boolean {
		return false;
	}
}
