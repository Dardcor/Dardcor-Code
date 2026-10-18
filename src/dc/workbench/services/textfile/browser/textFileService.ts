/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { IEncodingSupport, ITextFileService, ITextFileStreamContent, ITextFileContent, IResourceEncodings, IReadTextFileOptions, IWriteTextFileOptions, toBufferOrReadable, TextFileOperationError, TextFileOperationResult, ITextFileSaveOptions, ITextFileEditorModelManager, IResourceEncoding, stringToSnapshot, ITextFileSaveAsOptions, IReadTextFileEncodingOptions, TextFileEditorModelState, IResolvedTextFileEditorModel } from '../common/textfiles.js';
import { IRevertOptions, SaveSourceRegistry } from '../../../common/editor.js';
import { ILifecycleService } from '../../lifecycle/common/lifecycle.js';
import { IFileService, FileOperationError, FileOperationResult, IFileStatWithMetadata, ICreateFileOptions, IFileStreamContent } from '../../../../platform/files/common/files.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { extname as pathExtname } from '../../../../base/common/path.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { IUntitledTextEditorService, IUntitledTextEditorModelManager } from '../../untitled/common/untitledTextEditorService.js';
import { IResolvedUntitledTextEditorModel, UntitledTextEditorModel } from '../../untitled/common/untitledTextEditorModel.js';
import { TextFileEditorModelManager } from '../common/textFileEditorModelManager.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Schemas } from '../../../../base/common/network.js';
import { createTextBufferFactoryFromSnapshot, createTextBufferFactoryFromStream } from '../../../../editor/common/model/textModel.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { joinPath, dirname, basename, toLocalResource, extname, isEqual } from '../../../../base/common/resources.js';
import { IDialogService, IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { VSBuffer, VSBufferReadable, bufferToStream, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { ITextSnapshot, ITextModel } from '../../../../editor/common/model.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../editor/common/languages/modesRegistry.js';
import { IFilesConfigurationService } from '../../filesConfiguration/common/filesConfigurationService.js';
import { IResolvedTextEditorModel } from '../../../../editor/common/services/resolverService.js';
import { BaseTextEditorModel } from '../../../common/editor/textEditorModel.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IPathService } from '../../path/common/pathService.js';
import { IWorkingCopyFileService, IFileOperationUndoRedoInfo, ICreateFileOperation } from '../../workingCopy/common/workingCopyFileService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService, WORKSPACE_EXTENSION } from '../../../../platform/workspace/common/workspace.js';
import { UTF8, UTF8_with_bom, UTF16be, UTF16le, encodingExists, toEncodeReadable, toDecodeStream, IDecodeStreamResult, DecodeStreamError, DecodeStreamErrorKind } from '../common/encoding.js';
import { consumeStream, ReadableStream } from '../../../../base/common/stream.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IElevatedFileService } from '../../files/common/elevatedFileService.js';
import { IDecorationData, IDecorationsProvider, IDecorationsService } from '../../decorations/common/decorations.js';
import { Emitter } from '../../../../base/common/event.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { listErrorForeground } from '../../../../platform/theme/common/colorRegistry.js';

export abstract class AbstractTextFileService extends Disposable implements ITextFileService {

	declare readonly _serviceBrand: undefined;

	private static readonly TEXTFILE_SAVE_CREATE_SOURCE = SaveSourceRegistry.registerSource('textFileCreate.source', localize('textFileCreate.source', "File Created"));
	private static readonly TEXTFILE_SAVE_REPLACE_SOURCE = SaveSourceRegistry.registerSource('textFileOverwrite.source', localize('textFileOverwrite.source', "File Replaced"));

	readonly files: ITextFileEditorModelManager;

	readonly untitled: IUntitledTextEditorModelManager;

	constructor(
		@IFileService protected readonly fileService: IFileService,
		@IUntitledTextEditorService untitledTextEditorService: IUntitledTextEditorModelManager,
		@ILifecycleService protected readonly lifecycleService: ILifecycleService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IModelService private readonly modelService: IModelService,
		@IWorkbenchEnvironmentService protected readonly environmentService: IWorkbenchEnvironmentService,
		@IDialogService private readonly dialogService: IDialogService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@ITextResourceConfigurationService protected readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@IFilesConfigurationService protected readonly filesConfigurationService: IFilesConfigurationService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IPathService private readonly pathService: IPathService,
		@IWorkingCopyFileService private readonly workingCopyFileService: IWorkingCopyFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ILogService protected readonly logService: ILogService,
		@IElevatedFileService private readonly elevatedFileService: IElevatedFileService,
		@IDecorationsService private readonly decorationsService: IDecorationsService
	) {
		super();

		this.files = this._register(this.instantiationService.createInstance(TextFileEditorModelManager));
		this.untitled = untitledTextEditorService;

		this.provideDecorations();
	}


	private provideDecorations(): void {

		const provider = this._register(new class extends Disposable implements IDecorationsProvider {

			readonly label = localize('textFileModelDecorations', "Text File Model Decorations");

			private readonly _onDidChange = this._register(new Emitter<URI[]>());
			readonly onDidChange = this._onDidChange.event;

			constructor(private readonly files: ITextFileEditorModelManager) {
				super();

				this.registerListeners();
			}

			private registerListeners(): void {

				this._register(this.files.onDidResolve(({ model }) => {
					if (model.isReadonly() || model.hasState(TextFileEditorModelState.ORPHAN)) {
						this._onDidChange.fire([model.resource]);
					}
				}));

				this._register(this.files.onDidRemove(modelUri => this._onDidChange.fire([modelUri])));

				this._register(this.files.onDidChangeReadonly(model => this._onDidChange.fire([model.resource])));
				this._register(this.files.onDidChangeOrphaned(model => this._onDidChange.fire([model.resource])));
			}

			provideDecorations(uri: URI): IDecorationData | undefined {
				const model = this.files.get(uri);
				if (!model || model.isDisposed()) {
					return undefined;
				}

				const isReadonly = model.isReadonly();
				const isOrphaned = model.hasState(TextFileEditorModelState.ORPHAN);

				if (isReadonly && isOrphaned) {
					return {
						color: listErrorForeground,
						letter: Codicon.lockSmall,
						strikethrough: true,
						tooltip: localize('readonlyAndDeleted', "Deleted, Read-only"),
					};
				}

				else if (isReadonly) {
					return {
						letter: Codicon.lockSmall,
						tooltip: localize('readonly', "Read-only"),
					};
				}

				else if (isOrphaned) {
					return {
						color: listErrorForeground,
						strikethrough: true,
						tooltip: localize('deleted', "Deleted"),
					};
				}

				return undefined;
			}
		}(this.files));

		this._register(this.decorationsService.registerDecorationsProvider(provider));
	}



	private _encoding: EncodingOracle | undefined;

	get encoding(): EncodingOracle {
		if (!this._encoding) {
			this._encoding = this._register(this.instantiationService.createInstance(EncodingOracle));
		}

		return this._encoding;
	}

	async read(resource: URI, options?: IReadTextFileOptions): Promise<ITextFileContent> {
		const [bufferStream, decoder] = await this.doRead(resource, {
			...options,
			preferUnbuffered: true
		});

		return {
			...bufferStream,
			encoding: decoder.detected.encoding || UTF8,
			value: await consumeStream(decoder.stream, strings => strings.join(''))
		};
	}

	async readStream(resource: URI, options?: IReadTextFileOptions): Promise<ITextFileStreamContent> {
		const [bufferStream, decoder] = await this.doRead(resource, options);

		return {
			...bufferStream,
			encoding: decoder.detected.encoding || UTF8,
			value: await createTextBufferFactoryFromStream(decoder.stream)
		};
	}

	private async doRead(resource: URI, options?: IReadTextFileOptions & { preferUnbuffered?: boolean }): Promise<[IFileStreamContent, IDecodeStreamResult]> {
		const cts = new CancellationTokenSource();

		let bufferStream: IFileStreamContent;
		if (options?.preferUnbuffered) {
			const content = await this.fileService.readFile(resource, options, cts.token);
			bufferStream = {
				...content,
				value: bufferToStream(content.value)
			};
		} else {
			bufferStream = await this.fileService.readFileStream(resource, options, cts.token);
		}

		try {
			const decoder = await this.doGetDecodedStream(resource, bufferStream.value, options);

			return [bufferStream, decoder];
		} catch (error) {

			cts.dispose(true);

			if ((<DecodeStreamError>error).decodeStreamErrorKind === DecodeStreamErrorKind.STREAM_IS_BINARY) {
				throw new TextFileOperationError(localize('fileBinaryError', "File seems to be binary and cannot be opened as text"), TextFileOperationResult.FILE_IS_BINARY, options);
			}

			else {
				throw error;
			}
		}
	}

	async create(operations: { resource: URI; value?: string | ITextSnapshot; options?: ICreateFileOptions }[], undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]> {
		const operationsWithContents: ICreateFileOperation[] = await Promise.all(operations.map(async operation => {
			const contents = await this.getEncodedReadable(operation.resource, operation.value);
			return {
				resource: operation.resource,
				contents,
				overwrite: operation.options?.overwrite
			};
		}));

		return this.workingCopyFileService.create(operationsWithContents, CancellationToken.None, undoInfo);
	}

	async write(resource: URI, value: string | ITextSnapshot, options?: IWriteTextFileOptions): Promise<IFileStatWithMetadata> {
		const readable = await this.getEncodedReadable(resource, value, options);

		if (options?.writeElevated && this.elevatedFileService.isSupported(resource)) {
			return this.elevatedFileService.writeFileElevated(resource, readable, options);
		}

		return this.fileService.writeFile(resource, readable, options);
	}

	async getEncodedReadable(resource: URI | undefined, value: ITextSnapshot): Promise<VSBufferReadable>;
	async getEncodedReadable(resource: URI | undefined, value: string): Promise<VSBuffer | VSBufferReadable>;
	async getEncodedReadable(resource: URI | undefined, value?: ITextSnapshot): Promise<VSBufferReadable | undefined>;
	async getEncodedReadable(resource: URI | undefined, value?: string): Promise<VSBuffer | VSBufferReadable | undefined>;
	async getEncodedReadable(resource: URI | undefined, value?: string | ITextSnapshot): Promise<VSBuffer | VSBufferReadable | undefined>;
	async getEncodedReadable(resource: URI | undefined, value: string | ITextSnapshot, options?: IWriteTextFileOptions): Promise<VSBuffer | VSBufferReadable>;
	async getEncodedReadable(resource: URI | undefined, value?: string | ITextSnapshot, options?: IWriteTextFileOptions): Promise<VSBuffer | VSBufferReadable | undefined> {

		const { encoding, addBOM } = await this.encoding.getWriteEncoding(resource, options);

		if (encoding === UTF8 && !addBOM) {
			return typeof value === 'undefined'
				? undefined
				: toBufferOrReadable(value);
		}

		value = value || '';
		const snapshot = typeof value === 'string' ? stringToSnapshot(value) : value;
		return toEncodeReadable(snapshot, encoding, { addBOM });
	}

	async getDecodedStream(resource: URI | undefined, value: VSBufferReadableStream, options?: IReadTextFileEncodingOptions): Promise<ReadableStream<string>> {
		return (await this.doGetDecodedStream(resource, value, options)).stream;
	}

	private doGetDecodedStream(resource: URI | undefined, stream: VSBufferReadableStream, options?: IReadTextFileEncodingOptions): Promise<IDecodeStreamResult> {

		return toDecodeStream(stream, {
			acceptTextOnly: options?.acceptTextOnly ?? false,
			guessEncoding:
				options?.autoGuessEncoding ||
				this.textResourceConfigurationService.getValue(resource, 'files.autoGuessEncoding'),
			candidateGuessEncodings:
				options?.candidateGuessEncodings ||
				this.textResourceConfigurationService.getValue(resource, 'files.candidateGuessEncodings'),
			overwriteEncoding: async detectedEncoding => this.validateDetectedEncoding(resource, detectedEncoding ?? undefined, options)
		});
	}

	getEncoding(resource: URI): string {
		const model = resource.scheme === Schemas.untitled ? this.untitled.get(resource) : this.files.get(resource);
		return model?.getEncoding() ?? this.encoding.getUnvalidatedEncodingForResource(resource);
	}

	async resolveDecoding(resource: URI | undefined, options?: IReadTextFileEncodingOptions): Promise<{ preferredEncoding: string; guessEncoding: boolean; candidateGuessEncodings: string[] }> {
		return {
			preferredEncoding: (await this.encoding.getPreferredReadEncoding(resource, options, undefined)).encoding,
			guessEncoding:
				options?.autoGuessEncoding ||
				this.textResourceConfigurationService.getValue(resource, 'files.autoGuessEncoding'),
			candidateGuessEncodings:
				options?.candidateGuessEncodings ||
				this.textResourceConfigurationService.getValue(resource, 'files.candidateGuessEncodings'),
		};
	}

	async validateDetectedEncoding(resource: URI | undefined, detectedEncoding: string | undefined, options?: IReadTextFileEncodingOptions): Promise<string> {
		const { encoding } = await this.encoding.getPreferredReadEncoding(resource, options, detectedEncoding);

		return encoding;
	}

	resolveEncoding(resource: URI | undefined, options?: IWriteTextFileOptions): Promise<{ encoding: string; addBOM: boolean }> {
		return this.encoding.getWriteEncoding(resource, options);
	}




	async save(resource: URI, options?: ITextFileSaveOptions): Promise<URI | undefined> {

		if (resource.scheme === Schemas.untitled) {
			const model = this.untitled.get(resource);
			if (model) {
				let targetUri: URI | undefined;

				if (model.hasAssociatedFilePath) {
					targetUri = await this.suggestSavePath(resource);
				}

				else {
					targetUri = await this.fileDialogService.pickFileToSave(await this.suggestSavePath(resource), options?.availableFileSystems);
				}

				if (targetUri) {
					return this.saveAs(resource, targetUri, options);
				}
			}
		}

		else {
			const model = this.files.get(resource);
			if (model) {
				return await model.save(options) ? resource : undefined;
			}
		}

		return undefined;
	}

	async saveAs(source: URI, target?: URI, options?: ITextFileSaveAsOptions): Promise<URI | undefined> {

		if (!target) {
			target = await this.fileDialogService.pickFileToSave(await this.suggestSavePath(options?.suggestedTarget ?? source), options?.availableFileSystems);
		}

		if (!target) {
			return;
		}

		if (this.filesConfigurationService.isReadonly(target)) {
			const confirmed = await this.confirmMakeWriteable(target);
			if (!confirmed) {
				return;
			} else {
				this.filesConfigurationService.updateReadonly(target, false);
			}
		}

		if (isEqual(source, target)) {
			return this.save(source, { ...options, force: true });
		}

		if (this.fileService.hasProvider(source) && this.uriIdentityService.extUri.isEqual(source, target) && (await this.fileService.exists(source))) {
			await this.workingCopyFileService.move([{ file: { source, target } }], CancellationToken.None);

			const success = await this.save(source, options);
			if (!success) {
				await this.save(target, options);
			}

			return target;
		}

		return this.doSaveAs(source, target, options);
	}

	private async doSaveAs(source: URI, target: URI, options?: ITextFileSaveOptions): Promise<URI | undefined> {
		let success = false;

		let resolvedTextModel: IResolvedTextFileEditorModel | IResolvedUntitledTextEditorModel | undefined;
		if (source.scheme !== Schemas.untitled) {
			const textFileModel = this.files.get(source);
			if (textFileModel?.isResolved()) {
				resolvedTextModel = textFileModel;
			}
		} else {
			const untitledTextModel = this.untitled.get(source);
			if (untitledTextModel?.isResolved()) {
				resolvedTextModel = untitledTextModel;
			}
		}

		if (resolvedTextModel) {
			success = await this.doSaveAsTextFile(resolvedTextModel, source, target, options);
		}

		else if (this.fileService.hasProvider(source)) {
			await this.fileService.copy(source, target, true);

			success = true;
		}

		else {
			const textModel = this.modelService.getModel(source);
			if (textModel) {
				success = await this.doSaveAsTextFile(textModel, source, target, options);
			}
		}

		if (!success) {
			return undefined;
		}

		try {
			await this.revert(source);
		} catch (error) {


			this.logService.error(error);
		}

		if (source.scheme === Schemas.untitled) {
			this.untitled.notifyDidSave(source, target);
		}

		return target;
	}

	private async doSaveAsTextFile(sourceModel: IResolvedTextEditorModel | IResolvedUntitledTextEditorModel | ITextModel, source: URI, target: URI, options?: ITextFileSaveOptions): Promise<boolean> {

		let sourceModelEncoding: string | undefined = undefined;
		const sourceModelWithEncodingSupport = (sourceModel as unknown as IEncodingSupport);
		if (typeof sourceModelWithEncodingSupport.getEncoding === 'function') {
			sourceModelEncoding = sourceModelWithEncodingSupport.getEncoding();
		}

		let targetExists = false;
		let targetModel = this.files.get(target);
		if (targetModel?.isResolved()) {
			targetExists = true;
		}

		else {
			targetExists = await this.fileService.exists(target);

			if (!targetExists) {
				await this.create([{ resource: target, value: '' }]);
			}

			try {
				targetModel = await this.files.resolve(target, { encoding: sourceModelEncoding });
			} catch (error) {
				if (targetExists) {
					if (
						(<TextFileOperationError>error).textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY ||
						(<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_TOO_LARGE
					) {
						await this.fileService.del(target);

						return this.doSaveAsTextFile(sourceModel, source, target, options);
					}
				}

				throw error;
			}
		}

		let write: boolean;
		if (sourceModel instanceof UntitledTextEditorModel && sourceModel.hasAssociatedFilePath && targetExists && this.uriIdentityService.extUri.isEqual(target, toLocalResource(sourceModel.resource, this.environmentService.remoteAuthority, this.pathService.defaultUriScheme))) {
			write = await this.confirmOverwrite(target);
		} else {
			write = true;
		}

		if (!write) {
			return false;
		}

		let sourceTextModel: ITextModel | undefined = undefined;
		if (sourceModel instanceof BaseTextEditorModel) {
			if (sourceModel.isResolved()) {
				sourceTextModel = sourceModel.textEditorModel ?? undefined;
			}
		} else {
			sourceTextModel = sourceModel as ITextModel;
		}

		let targetTextModel: ITextModel | undefined = undefined;
		if (targetModel.isResolved()) {
			targetTextModel = targetModel.textEditorModel;
		}

		if (sourceTextModel && targetTextModel) {

			targetModel.updatePreferredEncoding(sourceModelEncoding);

			this.modelService.updateModel(targetTextModel, createTextBufferFactoryFromSnapshot(sourceTextModel.createSnapshot()));

			const sourceLanguageId = sourceTextModel.getLanguageId();
			const targetLanguageId = targetTextModel.getLanguageId();
			if (sourceLanguageId !== PLAINTEXT_LANGUAGE_ID && targetLanguageId === PLAINTEXT_LANGUAGE_ID) {
				targetTextModel.setLanguage(sourceLanguageId);
			}

			const sourceOptions = sourceTextModel.getOptions();
			targetTextModel.updateOptions({
				tabSize: sourceOptions.tabSize,
				indentSize: sourceOptions.indentSize,
				insertSpaces: sourceOptions.insertSpaces
			});

			const sourceEOL = sourceTextModel.getEndOfLineSequence();
			targetTextModel.setEOL(sourceEOL);

			const sourceTransientProperties = this.codeEditorService.getTransientModelProperties(sourceTextModel);
			if (sourceTransientProperties) {
				for (const [key, value] of sourceTransientProperties) {
					this.codeEditorService.setTransientModelProperty(targetTextModel, key, value);
				}
			}
		}

		if (!options?.source) {
			options = {
				...options,
				source: targetExists ? AbstractTextFileService.TEXTFILE_SAVE_REPLACE_SOURCE : AbstractTextFileService.TEXTFILE_SAVE_CREATE_SOURCE
			};
		}

		return targetModel.save({
			...options,
			from: source
		});
	}

	private async confirmOverwrite(resource: URI): Promise<boolean> {
		const { confirmed } = await this.dialogService.confirm({
			type: 'warning',
			message: localize('confirmOverwrite', "'{0}' already exists. Do you want to replace it?", basename(resource)),
			detail: localize('overwriteIrreversible', "A file or folder with the name '{0}' already exists in the folder '{1}'. Replacing it will overwrite its current contents.", basename(resource), basename(dirname(resource))),
			primaryButton: localize({ key: 'replaceButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Replace"),
		});

		return confirmed;
	}

	private async confirmMakeWriteable(resource: URI): Promise<boolean> {
		const { confirmed } = await this.dialogService.confirm({
			type: 'warning',
			message: localize('confirmMakeWriteable', "'{0}' is marked as read-only. Do you want to save anyway?", basename(resource)),
			detail: localize('confirmMakeWriteableDetail', "Paths can be configured as read-only via settings."),
			primaryButton: localize({ key: 'makeWriteableButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Save Anyway")
		});

		return confirmed;
	}

	private async suggestSavePath(resource: URI): Promise<URI> {

		if (this.fileService.hasProvider(resource)) {
			return resource;
		}

		const remoteAuthority = this.environmentService.remoteAuthority;
		const defaultFilePath = await this.fileDialogService.defaultFilePath();

		let suggestedFilename: string | undefined = undefined;
		if (resource.scheme === Schemas.untitled) {
			const model = this.untitled.get(resource);
			if (model) {

				if (model.hasAssociatedFilePath) {
					return toLocalResource(resource, remoteAuthority, this.pathService.defaultUriScheme);
				}


				let nameCandidate: string;
				if (await this.pathService.hasValidBasename(joinPath(defaultFilePath, model.name), model.name)) {
					nameCandidate = model.name;
				} else {
					nameCandidate = basename(resource);
				}

				const languageId = model.getLanguageId();
				if (languageId && languageId !== PLAINTEXT_LANGUAGE_ID) {
					suggestedFilename = this.suggestFilename(languageId, nameCandidate);
				} else {
					suggestedFilename = nameCandidate;
				}
			}
		}

		if (!suggestedFilename) {
			suggestedFilename = basename(resource);
		}

		return joinPath(defaultFilePath, suggestedFilename);
	}

	suggestFilename(languageId: string, untitledName: string) {
		const languageName = this.languageService.getLanguageName(languageId);
		if (!languageName) {
			return untitledName;
		}

		const untitledExtension = pathExtname(untitledName);

		const extensions = this.languageService.getExtensions(languageId);
		if (extensions.includes(untitledExtension)) {
			return untitledName;
		}

		const primaryExtension = extensions.at(0);
		if (primaryExtension) {
			if (untitledExtension) {
				return `${untitledName.substring(0, untitledName.indexOf(untitledExtension))}${primaryExtension}`;
			}

			return `${untitledName}${primaryExtension}`;
		}

		const filenames = this.languageService.getFilenames(languageId);
		if (filenames.includes(untitledName)) {
			return untitledName;
		}

		return filenames.at(0) ?? untitledName;
	}



	async revert(resource: URI, options?: IRevertOptions): Promise<void> {

		if (resource.scheme === Schemas.untitled) {
			const model = this.untitled.get(resource);
			if (model) {
				return model.revert(options);
			}
		}

		else {
			const model = this.files.get(resource);
			if (model && (model.isDirty() || options?.force)) {
				return model.revert(options);
			}
		}
	}



	isDirty(resource: URI): boolean {
		const model = resource.scheme === Schemas.untitled ? this.untitled.get(resource) : this.files.get(resource);
		if (model) {
			return model.isDirty();
		}

		return false;
	}

}

export interface IEncodingOverride {
	parent?: URI;
	extension?: string;
	encoding: string;
}

export class EncodingOracle extends Disposable implements IResourceEncodings {

	private _encodingOverrides: IEncodingOverride[];
	protected get encodingOverrides(): IEncodingOverride[] { return this._encodingOverrides; }
	protected set encodingOverrides(value: IEncodingOverride[]) { this._encodingOverrides = value; }

	constructor(
		@ITextResourceConfigurationService private textResourceConfigurationService: ITextResourceConfigurationService,
		@IWorkbenchEnvironmentService private environmentService: IWorkbenchEnvironmentService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super();

		this._encodingOverrides = this.getDefaultEncodingOverrides();

		this.registerListeners();
	}

	private registerListeners(): void {

		this._register(this.contextService.onDidChangeWorkspaceFolders(() => this.encodingOverrides = this.getDefaultEncodingOverrides()));
	}

	private getDefaultEncodingOverrides(): IEncodingOverride[] {
		const defaultEncodingOverrides: IEncodingOverride[] = [];

		defaultEncodingOverrides.push({ parent: this.environmentService.userRoamingDataHome, encoding: UTF8 });

		defaultEncodingOverrides.push({ extension: WORKSPACE_EXTENSION, encoding: UTF8 });
		defaultEncodingOverrides.push({ parent: this.environmentService.untitledWorkspacesHome, encoding: UTF8 });

		this.contextService.getWorkspace().folders.forEach(folder => {
			defaultEncodingOverrides.push({ parent: joinPath(folder.uri, '.vscode'), encoding: UTF8 });
		});

		return defaultEncodingOverrides;
	}

	async getWriteEncoding(resource: URI | undefined, options?: IWriteTextFileOptions): Promise<{ encoding: string; addBOM: boolean }> {
		const { encoding, hasBOM } = await this.getPreferredWriteEncoding(resource, options ? options.encoding : undefined);

		return { encoding, addBOM: hasBOM };
	}

	async getPreferredWriteEncoding(resource: URI | undefined, preferredEncoding?: string): Promise<IResourceEncoding> {
		const resourceEncoding = await this.getValidatedEncodingForResource(resource, preferredEncoding);

		return {
			encoding: resourceEncoding,
			hasBOM: resourceEncoding === UTF16be || resourceEncoding === UTF16le || resourceEncoding === UTF8_with_bom
		};
	}

	async getPreferredReadEncoding(resource: URI | undefined, options?: IReadTextFileEncodingOptions, detectedEncoding?: string): Promise<IResourceEncoding> {
		let preferredEncoding: string | undefined;

		if (options?.encoding) {
			if (detectedEncoding === UTF8_with_bom && options.encoding === UTF8) {
				preferredEncoding = UTF8_with_bom;
			} else {
				preferredEncoding = options.encoding;
			}
		}

		else if (typeof detectedEncoding === 'string') {
			preferredEncoding = detectedEncoding;
		}

		else if (this.textResourceConfigurationService.getValue(resource, 'files.encoding') === UTF8_with_bom) {
			preferredEncoding = UTF8;
		}

		const encoding = await this.getValidatedEncodingForResource(resource, preferredEncoding);

		return {
			encoding,
			hasBOM: encoding === UTF16be || encoding === UTF16le || encoding === UTF8_with_bom
		};
	}

	getUnvalidatedEncodingForResource(resource: URI | undefined, preferredEncoding?: string): string {
		let fileEncoding: string;

		const override = this.getEncodingOverride(resource);
		if (override) {
			fileEncoding = override;
		} else if (preferredEncoding) {
			fileEncoding = preferredEncoding;
		} else {
			fileEncoding = this.textResourceConfigurationService.getValue(resource, 'files.encoding');
		}

		return fileEncoding || UTF8;
	}

	private async getValidatedEncodingForResource(resource: URI | undefined, preferredEncoding?: string): Promise<string> {
		let fileEncoding = this.getUnvalidatedEncodingForResource(resource, preferredEncoding);
		if (fileEncoding !== UTF8 && !(await encodingExists(fileEncoding))) {
			fileEncoding = UTF8;
		}

		return fileEncoding;
	}

	private getEncodingOverride(resource: URI | undefined): string | undefined {
		if (resource && this.encodingOverrides?.length) {
			for (const override of this.encodingOverrides) {

				if (override.parent && this.uriIdentityService.extUri.isEqualOrParent(resource, override.parent)) {
					return override.encoding;
				}

				if (override.extension && extname(resource) === `.${override.extension}`) {
					return override.encoding;
				}
			}
		}

		return undefined;
	}
}
