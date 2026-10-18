/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileEditorInput, Verbosity, GroupIdentifier, IMoveResult, EditorInputCapabilities, IEditorDescriptor, IEditorPane, IUntypedEditorInput, DEFAULT_EDITOR_ASSOCIATION, IUntypedFileEditorInput, findViewStateForEditor, isResourceEditorInput, IFileEditorInputOptions } from '../../../../common/editor.js';
import { EditorInput, IUntypedEditorOptions } from '../../../../common/editor/editorInput.js';
import { AbstractTextResourceEditorInput } from '../../../../common/editor/textResourceEditorInput.js';
import { ITextResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { BinaryEditorModel } from '../../../../common/editor/binaryEditorModel.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ITextFileService, TextFileEditorModelState, TextFileResolveReason, TextFileOperationError, TextFileOperationResult, ITextFileEditorModel, EncodingMode } from '../../../../services/textfile/common/textfiles.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IReference, dispose, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { FILE_EDITOR_INPUT_ID, TEXT_FILE_EDITOR_ID, BINARY_FILE_EDITOR_ID } from '../../common/files.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { Event } from '../../../../../base/common/event.js';
import { Schemas } from '../../../../../base/common/network.js';
import { createTextBufferFactory } from '../../../../../editor/common/model/textModel.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { ITextResourceConfigurationService } from '../../../../../editor/common/services/textResourceConfiguration.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { ICustomEditorLabelService } from '../../../../services/editor/common/customEditorLabelService.js';

const enum ForceOpenAs {
	None,
	Text,
	Binary
}

export class FileEditorInput extends AbstractTextResourceEditorInput implements IFileEditorInput {

	override get typeId(): string {
		return FILE_EDITOR_INPUT_ID;
	}

	override get editorId(): string | undefined {
		return DEFAULT_EDITOR_ASSOCIATION.id;
	}

	override get capabilities(): EditorInputCapabilities {
		let capabilities = EditorInputCapabilities.CanSplitInGroup;

		if (this.model) {
			if (this.model.isReadonly()) {
				capabilities |= EditorInputCapabilities.Readonly;
			}
		} else {
			if (this.fileService.hasProvider(this.resource)) {
				if (this.filesConfigurationService.isReadonly(this.resource)) {
					capabilities |= EditorInputCapabilities.Readonly;
				}
			} else {
				capabilities |= EditorInputCapabilities.Untitled;
			}
		}

		if (!(capabilities & EditorInputCapabilities.Readonly)) {
			capabilities |= EditorInputCapabilities.CanDropIntoEditor;
		}

		return capabilities;
	}

	private preferredName: string | undefined;
	private preferredDescription: string | undefined;
	private preferredEncoding: string | undefined;
	private preferredLanguageId: string | undefined;
	private preferredContents: string | undefined;

	private forceOpenAs: ForceOpenAs = ForceOpenAs.None;

	private model: ITextFileEditorModel | undefined = undefined;
	private cachedTextFileModelReference: IReference<ITextFileEditorModel> | undefined = undefined;

	private readonly modelListeners = this._register(new DisposableStore());

	constructor(
		resource: URI,
		preferredResource: URI | undefined,
		preferredName: string | undefined,
		preferredDescription: string | undefined,
		preferredEncoding: string | undefined,
		preferredLanguageId: string | undefined,
		preferredContents: string | undefined,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextFileService textFileService: ITextFileService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ILabelService labelService: ILabelService,
		@IFileService fileService: IFileService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@IEditorService editorService: IEditorService,
		@IPathService private readonly pathService: IPathService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@ICustomEditorLabelService customEditorLabelService: ICustomEditorLabelService
	) {
		super(resource, preferredResource, editorService, textFileService, labelService, fileService, filesConfigurationService, textResourceConfigurationService, customEditorLabelService);

		this.model = this.textFileService.files.get(resource);

		if (preferredName) {
			this.setPreferredName(preferredName);
		}

		if (preferredDescription) {
			this.setPreferredDescription(preferredDescription);
		}

		if (preferredEncoding) {
			this.setPreferredEncoding(preferredEncoding);
		}

		if (preferredLanguageId) {
			this.setPreferredLanguageId(preferredLanguageId);
		}

		if (typeof preferredContents === 'string') {
			this.setPreferredContents(preferredContents);
		}

		this._register(this.textFileService.files.onDidCreate(model => this.onDidCreateTextFileModel(model)));

		if (this.model) {
			this.registerModelListeners(this.model);
		}
	}

	private onDidCreateTextFileModel(model: ITextFileEditorModel): void {

		if (isEqual(model.resource, this.resource)) {
			this.model = model;

			this.registerModelListeners(model);
		}
	}

	private registerModelListeners(model: ITextFileEditorModel): void {

		this.modelListeners.clear();

		this.modelListeners.add(model.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
		this.modelListeners.add(model.onDidChangeReadonly(() => this._onDidChangeCapabilities.fire()));

		this.modelListeners.add(model.onDidSaveError(() => this._onDidChangeDirty.fire()));

		this.modelListeners.add(Event.once(model.onWillDispose)(() => {
			this.modelListeners.clear();
			this.model = undefined;
		}));
	}

	override getName(): string {
		return this.preferredName || super.getName();
	}

	setPreferredName(name: string): void {
		if (!this.allowLabelOverride()) {
			return;
		}

		if (this.preferredName !== name) {
			this.preferredName = name;

			this._onDidChangeLabel.fire();
		}
	}

	private allowLabelOverride(): boolean {
		return this.resource.scheme !== this.pathService.defaultUriScheme &&
			this.resource.scheme !== Schemas.vscodeUserData &&
			this.resource.scheme !== Schemas.file &&
			this.resource.scheme !== Schemas.vscodeRemote;
	}

	getPreferredName(): string | undefined {
		return this.preferredName;
	}

	override isReadonly(): boolean | IMarkdownString {
		return this.model ? this.model.isReadonly() : this.filesConfigurationService.isReadonly(this.resource);
	}

	override getDescription(verbosity?: Verbosity): string | undefined {
		return this.preferredDescription || super.getDescription(verbosity);
	}

	setPreferredDescription(description: string): void {
		if (!this.allowLabelOverride()) {
			return;
		}

		if (this.preferredDescription !== description) {
			this.preferredDescription = description;

			this._onDidChangeLabel.fire();
		}
	}

	getPreferredDescription(): string | undefined {
		return this.preferredDescription;
	}

	override getTitle(verbosity?: Verbosity): string {
		let title = super.getTitle(verbosity);

		const preferredTitle = this.getPreferredTitle();
		if (preferredTitle) {
			title = `${preferredTitle} (${title})`;
		}

		return title;
	}

	protected getPreferredTitle(): string | undefined {
		if (this.preferredName && this.preferredDescription) {
			return `${this.preferredName} ${this.preferredDescription}`;
		}

		if (this.preferredName || this.preferredDescription) {
			return this.preferredName ?? this.preferredDescription;
		}

		return undefined;
	}

	getEncoding(): string | undefined {
		if (this.model) {
			return this.model.getEncoding();
		}

		return this.preferredEncoding;
	}

	getPreferredEncoding(): string | undefined {
		return this.preferredEncoding;
	}

	async setEncoding(encoding: string, mode: EncodingMode): Promise<void> {
		this.setPreferredEncoding(encoding);

		return this.model?.setEncoding(encoding, mode);
	}

	setPreferredEncoding(encoding: string): void {
		this.preferredEncoding = encoding;

		this.setForceOpenAsText();
	}

	getLanguageId(): string | undefined {
		if (this.model) {
			return this.model.getLanguageId();
		}

		return this.preferredLanguageId;
	}

	getPreferredLanguageId(): string | undefined {
		return this.preferredLanguageId;
	}

	setLanguageId(languageId: string, source?: string): void {
		this.setPreferredLanguageId(languageId);

		this.model?.setLanguageId(languageId, source);
	}

	setPreferredLanguageId(languageId: string): void {
		this.preferredLanguageId = languageId;

		this.setForceOpenAsText();
	}

	setPreferredContents(contents: string): void {
		this.preferredContents = contents;

		this.setForceOpenAsText();
	}

	setForceOpenAsText(): void {
		this.forceOpenAs = ForceOpenAs.Text;
	}

	setForceOpenAsBinary(): void {
		this.forceOpenAs = ForceOpenAs.Binary;
	}

	override isDirty(): boolean {
		return !!(this.model?.isDirty());
	}

	override isSaving(): boolean {
		if (this.model?.hasState(TextFileEditorModelState.SAVED) || this.model?.hasState(TextFileEditorModelState.CONFLICT) || this.model?.hasState(TextFileEditorModelState.ERROR)) {
			return false;
		}


		if (this.filesConfigurationService.hasShortAutoSaveDelay(this)) {
			return true;
		}

		return super.isSaving();
	}

	override prefersEditorPane<T extends IEditorDescriptor<IEditorPane>>(editorPanes: T[]): T | undefined {
		if (this.forceOpenAs === ForceOpenAs.Binary) {
			return editorPanes.find(editorPane => editorPane.typeId === BINARY_FILE_EDITOR_ID);
		}

		return editorPanes.find(editorPane => editorPane.typeId === TEXT_FILE_EDITOR_ID);
	}

	override resolve(options?: IFileEditorInputOptions): Promise<ITextFileEditorModel | BinaryEditorModel> {

		if (this.forceOpenAs === ForceOpenAs.Binary) {
			return this.doResolveAsBinary();
		}

		return this.doResolveAsText(options);
	}

	private async doResolveAsText(options?: IFileEditorInputOptions): Promise<ITextFileEditorModel | BinaryEditorModel> {
		try {

			const preferredContents = this.preferredContents;
			this.preferredContents = undefined;

			await this.textFileService.files.resolve(this.resource, {
				languageId: this.preferredLanguageId,
				encoding: this.preferredEncoding,
				contents: typeof preferredContents === 'string' ? createTextBufferFactory(preferredContents) : undefined,
				reload: { async: true },
				allowBinary: this.forceOpenAs === ForceOpenAs.Text,
				reason: TextFileResolveReason.EDITOR,
				limits: this.ensureLimits(options)
			});

			if (!this.cachedTextFileModelReference) {
				this.cachedTextFileModelReference = await this.textModelService.createModelReference(this.resource) as IReference<ITextFileEditorModel>;
			}

			const model = this.cachedTextFileModelReference.object;

			if (this.isDisposed()) {
				this.disposeModelReference();
			}

			return model;
		} catch (error) {

			if ((<TextFileOperationError>error).textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
				return this.doResolveAsBinary();
			}

			throw error;
		}
	}

	private async doResolveAsBinary(): Promise<BinaryEditorModel> {
		const model = this.instantiationService.createInstance(BinaryEditorModel, this.preferredResource, this.getName());
		await model.resolve();

		return model;
	}

	isResolved(): boolean {
		return !!this.model;
	}

	override async rename(group: GroupIdentifier, target: URI): Promise<IMoveResult> {
		return {
			editor: {
				resource: target,
				encoding: this.getEncoding(),
				options: {
					viewState: findViewStateForEditor(this, group, this.editorService)
				}
			}
		};
	}

	override toUntyped(options?: IUntypedEditorOptions): ITextResourceEditorInput {
		const untypedInput: IUntypedFileEditorInput = {
			resource: this.preferredResource,
			forceFile: true,
			options: {
				override: this.editorId
			}
		};

		if (typeof options?.preserveViewState === 'number') {
			untypedInput.encoding = this.getEncoding();
			untypedInput.languageId = this.getLanguageId();
			untypedInput.contents = (() => {
				const model = this.textFileService.files.get(this.resource);
				if (model?.isDirty() && !model.textEditorModel.isTooLargeForHeapOperation()) {
					return model.textEditorModel.getValue();
				}

				return undefined;
			})();

			untypedInput.options = {
				...untypedInput.options,
				viewState: findViewStateForEditor(this, options.preserveViewState, this.editorService)
			};
		}

		return untypedInput;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		if (this === otherInput) {
			return true;
		}

		if (otherInput instanceof FileEditorInput) {
			return isEqual(otherInput.resource, this.resource);
		}

		if (isResourceEditorInput(otherInput)) {
			return super.matches(otherInput);
		}

		return false;
	}

	override dispose(): void {

		this.model = undefined;

		this.disposeModelReference();

		super.dispose();
	}

	private disposeModelReference(): void {
		dispose(this.cachedTextFileModelReference);
		this.cachedTextFileModelReference = undefined;
	}
}
