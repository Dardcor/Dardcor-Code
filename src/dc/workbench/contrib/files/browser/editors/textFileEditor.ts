/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { mark } from '../../../../../base/common/performance.js';
import { assertReturnsDefined } from '../../../../../base/common/types.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { IAction, toAction } from '../../../../../base/common/actions.js';
import { VIEWLET_ID, TEXT_FILE_EDITOR_ID, BINARY_TEXT_FILE_MODE } from '../../common/files.js';
import { ITextFileService, TextFileOperationError, TextFileOperationResult } from '../../../../services/textfile/common/textfiles.js';
import { AbstractTextCodeEditor } from '../../../../browser/parts/editor/textCodeEditor.js';
import { IEditorOpenContext, isTextEditorViewState, DEFAULT_EDITOR_ASSOCIATION, createEditorOpenError, IFileEditorInputOptions, createTooLargeFileError } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { applyTextEditorOptions } from '../../../../common/editor/editorOptions.js';
import { BinaryEditorModel } from '../../../../common/editor/binaryEditorModel.js';
import { FileEditorInput } from './fileEditorInput.js';
import { FileOperationError, FileOperationResult, FileChangesEvent, IFileService, FileOperationEvent, FileOperation, ByteSize, TooLargeFileOperationError } from '../../../../../platform/files/common/files.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITextResourceConfigurationService } from '../../../../../editor/common/services/textResourceConfiguration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { ICodeEditorViewState, ScrollType } from '../../../../../editor/common/editorCommon.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { EditorActivation, ITextEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IExplorerService } from '../files.js';
import { IPaneCompositePartService } from '../../../../services/panecomposite/browser/panecomposite.js';
import { ViewContainerLocation } from '../../../../common/views.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IEditorOptions as ICodeEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';

export class TextFileEditor extends AbstractTextCodeEditor<ICodeEditorViewState> {

	static readonly ID = TEXT_FILE_EDITOR_ID;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IFileService fileService: IFileService,
		@IPaneCompositePartService private readonly paneCompositeService: IPaneCompositePartService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IEditorService editorService: IEditorService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IPathService private readonly pathService: IPathService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IPreferencesService protected readonly preferencesService: IPreferencesService,
		@IHostService private readonly hostService: IHostService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService
	) {
		super(TextFileEditor.ID, group, telemetryService, instantiationService, storageService, textResourceConfigurationService, themeService, editorService, editorGroupService, fileService);

		this._register(this.fileService.onDidFilesChange(e => this.onDidFilesChange(e)));

		this._register(this.fileService.onDidRunOperation(e => this.onDidRunOperation(e)));
	}

	private onDidFilesChange(e: FileChangesEvent): void {
		for (const resource of e.rawDeleted) {
			this.clearEditorViewState(resource);
		}
	}

	private onDidRunOperation(e: FileOperationEvent): void {
		if (e.operation === FileOperation.MOVE && e.target) {
			this.moveEditorViewState(e.resource, e.target.resource, this.uriIdentityService.extUri);
		}
	}

	override getTitle(): string {
		if (this.input) {
			return this.input.getName();
		}

		return localize('textFileEditor', "Text File Editor");
	}

	override get input(): FileEditorInput | undefined {
		return this._input as FileEditorInput;
	}

	override async setInput(input: FileEditorInput, options: IFileEditorInputOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		mark('code/willSetInputToTextFileEditor');

		await super.setInput(input, options, context, token);
		try {
			const resolvedModel = await input.resolve(options);

			if (token.isCancellationRequested) {
				return;
			}


			if (resolvedModel instanceof BinaryEditorModel) {
				return this.openAsBinary(input, options);
			}

			const textFileModel = resolvedModel;

			const control = assertReturnsDefined(this.editorControl);
			control.setModel(textFileModel.textEditorModel);

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

			control.updateOptions(this.getReadonlyConfiguration(textFileModel.isReadonly()));

			if (control.handleInitialized) {
				control.handleInitialized();
			}
		} catch (error) {
			await this.handleSetInputError(error, input, options);
		}

		mark('code/didSetInputToTextFileEditor');
	}

	protected async handleSetInputError(error: Error, input: FileEditorInput, options: ITextEditorOptions | undefined): Promise<void> {

		if ((<TextFileOperationError>error).textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			return this.openAsBinary(input, options);
		}

		if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_IS_DIRECTORY) {
			const actions: IAction[] = [];

			actions.push(toAction({
				id: 'workbench.files.action.openFolder', label: localize('openFolder', "Open Folder"), run: async () => {
					return this.hostService.openWindow([{ folderUri: input.resource }], { forceNewWindow: true });
				}
			}));

			if (this.contextService.isInsideWorkspace(input.preferredResource)) {
				actions.push(toAction({
					id: 'workbench.files.action.reveal', label: localize('reveal', "Reveal Folder"), run: async () => {
						await this.paneCompositeService.openPaneComposite(VIEWLET_ID, ViewContainerLocation.Sidebar, true);

						return this.explorerService.select(input.preferredResource, true);
					}
				}));
			}

			throw createEditorOpenError(localize('fileIsDirectory', "The file is not displayed in the text editor because it is a directory."), actions, { forceMessage: true });
		}

		if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_TOO_LARGE) {
			let message: string;
			if (error instanceof TooLargeFileOperationError) {
				message = localize('fileTooLargeForHeapErrorWithSize', "The file is not displayed in the text editor because it is very large ({0}).", ByteSize.formatSize(error.size));
			} else {
				message = localize('fileTooLargeForHeapErrorWithoutSize', "The file is not displayed in the text editor because it is very large.");
			}

			throw createTooLargeFileError(this.group, input, options, message, this.preferencesService);
		}

		if (
			(<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_NOT_FOUND &&
			!this.filesConfigurationService.isReadonly(input.preferredResource) &&
			await this.pathService.hasValidBasename(input.preferredResource)
		) {
			const fileNotFoundError = createEditorOpenError(new FileOperationError(localize('unavailableResourceErrorEditorText', "The editor could not be opened because the file was not found."), FileOperationResult.FILE_NOT_FOUND), [
				toAction({
					id: 'workbench.files.action.createMissingFile', label: localize('createFile', "Create File"), run: async () => {
						await this.textFileService.create([{ resource: input.preferredResource }]);

						return this.editorService.openEditor({
							resource: input.preferredResource,
							options: {
								pinned: true
							}
						});
					}
				})
			], {


				allowDialog: true
			});

			throw fileNotFoundError;
		}

		throw error;
	}

	private openAsBinary(input: FileEditorInput, options: ITextEditorOptions | undefined): void {
		const defaultBinaryEditor = this.configurationService.getValue<string | undefined>('workbench.editor.defaultBinaryEditor');

		const editorOptions = {
			...options,
			activation: EditorActivation.PRESERVE
		};


		if (defaultBinaryEditor && defaultBinaryEditor !== '' && defaultBinaryEditor !== DEFAULT_EDITOR_ASSOCIATION.id) {
			this.doOpenAsBinaryInDifferentEditor(this.group, defaultBinaryEditor, input, editorOptions);
		} else {
			this.doOpenAsBinaryInSameEditor(this.group, defaultBinaryEditor, input, editorOptions);
		}
	}

	private doOpenAsBinaryInDifferentEditor(group: IEditorGroup, editorId: string | undefined, editor: FileEditorInput, editorOptions: ITextEditorOptions): void {
		this.editorService.replaceEditors([{
			editor,
			replacement: { resource: editor.resource, options: { ...editorOptions, override: editorId } }
		}], group);
	}

	private doOpenAsBinaryInSameEditor(group: IEditorGroup, editorId: string | undefined, editor: FileEditorInput, editorOptions: ITextEditorOptions): void {

		if (editorId === DEFAULT_EDITOR_ASSOCIATION.id) {
			editor.setForceOpenAsText();
			editor.setPreferredLanguageId(BINARY_TEXT_FILE_MODE);

			editorOptions = { ...editorOptions, forceReload: true };
		}

		else {
			editor.setForceOpenAsBinary();
		}

		group.openEditor(editor, editorOptions);
	}

	override clearInput(): void {
		super.clearInput();

		this.editorControl?.setModel(null);
	}

	protected override createEditorControl(parent: HTMLElement, initialOptions: ICodeEditorOptions): void {
		mark('code/willCreateTextFileEditorControl');

		super.createEditorControl(parent, initialOptions);

		mark('code/didCreateTextFileEditorControl');
	}

	protected override tracksEditorViewState(input: EditorInput): boolean {
		return input instanceof FileEditorInput;
	}

	protected override tracksDisposedEditorViewState(): boolean {
		return true;
	}
}
