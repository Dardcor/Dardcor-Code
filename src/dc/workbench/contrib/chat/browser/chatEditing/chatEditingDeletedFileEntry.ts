/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { constObservable, IObservable, ITransaction, observableValue, transaction } from '../../../../../base/common/observable.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { LineRange } from '../../../../../editor/common/core/ranges/lineRange.js';
import { IDocumentDiff } from '../../../../../editor/common/diff/documentDiffProvider.js';
import { DetailedLineRangeMapping } from '../../../../../editor/common/diff/rangeMapping.js';
import { TextEdit } from '../../../../../editor/common/languages.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { createTextBufferFactoryFromSnapshot } from '../../../../../editor/common/model/textModel.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType } from '../../../../../platform/undoRedo/common/undoRedo.js';
import { IEditorPane } from '../../../../common/editor.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { stringToSnapshot } from '../../../../services/textfile/common/textfiles.js';
import { IAiEditTelemetryService } from '../../../editTelemetry/browser/telemetry/aiEditTelemetry/aiEditTelemetryService.js';
import { ICellEditOperation } from '../../../notebook/common/notebookCommon.js';
import { IChatService } from '../../common/chatService/chatService.js';
import { ChatEditKind, IModifiedEntryTelemetryInfo, IModifiedFileEntry, IModifiedFileEntryEditorIntegration, ISnapshotEntry, ModifiedFileEntryState } from '../../common/editing/chatEditingService.js';
import { IChatResponseModel } from '../../common/model/chatModel.js';
import { AbstractChatEditingModifiedFileEntry } from './chatEditingModifiedFileEntry.js';
import { ChatEditingTextModelContentProvider } from './chatEditingTextModelContentProviders.js';

interface IMultiDiffEntryDelegate {
	collapse: (transaction: ITransaction | undefined) => void;
}

export class ChatEditingDeletedFileEntry extends AbstractChatEditingModifiedFileEntry implements IModifiedFileEntry {

	readonly initialContent: string;

	private readonly _originalContent: string;

	private _originalModel: ITextModel | undefined;

	private _modifiedModel: ITextModel | undefined;

	readonly originalURI: URI;

	readonly diffInfo: IObservable<IDocumentDiff>;
	readonly linesAdded: IObservable<number> = constObservable(0);
	readonly linesRemoved: IObservable<number>;

	private readonly _changesCount = observableValue<number>(this, 1);
	override readonly changesCount = this._changesCount;
	readonly isDeletion = true;

	constructor(
		resource: URI,
		originalContent: string,
		private readonly _multiDiffEntryDelegate: IMultiDiffEntryDelegate,
		telemetryInfo: IModifiedEntryTelemetryInfo,
		private readonly _languageId: string,
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IConfigurationService configService: IConfigurationService,
		@IFilesConfigurationService fileConfigService: IFilesConfigurationService,
		@IChatService chatService: IChatService,
		@IFileService fileService: IFileService,
		@IUndoRedoService undoRedoService: IUndoRedoService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAiEditTelemetryService aiEditTelemetryService: IAiEditTelemetryService,
	) {
		super(
			resource,
			telemetryInfo,
			ChatEditKind.Deleted,
			configService,
			fileConfigService,
			chatService,
			fileService,
			undoRedoService,
			instantiationService,
			aiEditTelemetryService,
		);

		this._originalContent = originalContent;
		this.initialContent = originalContent;
		this.originalURI = ChatEditingTextModelContentProvider.getFileURI(telemetryInfo.sessionResource, this.entryId, resource.path);
		this.diffInfo = constObservable(this._diffInfo());
		this.linesRemoved = constObservable(this._getOrCreateOriginalModel().getLineCount());
	}

	override dispose(): void {
		this._originalModel?.dispose();
		this._modifiedModel?.dispose();
		super.dispose();
	}

	private _getOrCreateOriginalModel(): ITextModel {
		if (!this._originalModel || this._originalModel.isDisposed()) {
			this._originalModel = this._modelService.createModel(
				createTextBufferFactoryFromSnapshot(stringToSnapshot(this._originalContent)),
				this._languageService.createById(this._languageId),
				this.originalURI,
				false
			);
		}
		return this._originalModel;
	}

	private _getOrCreateModifiedModel(): ITextModel {
		if (!this._modifiedModel || this._modifiedModel.isDisposed()) {
			this._modifiedModel = this._modelService.createModel(
				'',
				this._languageService.createById(this._languageId),
				this.modifiedURI.with({ scheme: 'deleted-file' }),
				false
			);
		}
		return this._modifiedModel;
	}

	private _diffInfo() {
		const originalModel = this._getOrCreateOriginalModel();
		this._getOrCreateModifiedModel();
		const originalLineCount = originalModel.getLineCount();

		return {
			changes: [new DetailedLineRangeMapping(
				new LineRange(1, originalLineCount + 1),
				new LineRange(1, 1),
				undefined
			)],
			quitEarly: false,
			identical: false,
			moves: []
		};
	}

	getDiffInfo(): Promise<IDocumentDiff> {
		return Promise.resolve(this._diffInfo());
	}

	equalsSnapshot(snapshot: ISnapshotEntry | undefined): boolean {
		return !!snapshot &&
			isEqual(this.modifiedURI, snapshot.resource) &&
			this._languageId === snapshot.languageId &&
			this._originalContent === snapshot.original &&
			snapshot.current === '' &&
			this.state.get() === snapshot.state;
	}

	createSnapshot(chatSessionResource: URI, requestId: string | undefined, undoStop: string | undefined): ISnapshotEntry {
		return {
			resource: this.modifiedURI,
			languageId: this._languageId,
			snapshotUri: this.originalURI,
			original: this._originalContent,
			current: '',
			state: this.state.get(),
			telemetryInfo: this._telemetryInfo,
			isDeleted: true,
		};
	}

	async restoreFromSnapshot(snapshot: ISnapshotEntry, restoreToDisk = true): Promise<void> {
		this._stateObs.set(snapshot.state, undefined);

		if (restoreToDisk && snapshot.current !== '') {
			await this._fileService.writeFile(this.modifiedURI, VSBuffer.fromString(snapshot.current));
		}
	}

	async resetToInitialContent(): Promise<void> {
		await this._fileService.writeFile(this.modifiedURI, VSBuffer.fromString(this._originalContent));
	}

	resetEditTrackerToInitialContent(): Promise<void> {
		return Promise.resolve();
	}

	protected override async _areOriginalAndModifiedIdentical(): Promise<boolean> {
		return this._originalContent === '';
	}

	protected override _createUndoRedoElement(response: IChatResponseModel): IUndoRedoElement {
		return {
			type: UndoRedoElementType.Resource,
			resource: this.modifiedURI,
			label: 'Chat File Deletion',
			code: 'chat.delete',
			undo: async () => {
				await this._fileService.writeFile(this.modifiedURI, VSBuffer.fromString(this._originalContent));
			},
			redo: async () => {
				await this._fileService.del(this.modifiedURI, { useTrash: false });
			}
		};
	}

	async acceptAgentEdits(_uri: URI, _edits: (TextEdit | ICellEditOperation)[], isLastEdits: boolean, _responseModel: IChatResponseModel | undefined): Promise<void> {
		transaction((tx) => {
			this._waitsForLastEdits.set(!isLastEdits, tx);
			this._stateObs.set(ModifiedFileEntryState.Modified, tx);

			if (isLastEdits) {
				this._resetEditsState(tx);
				this._rewriteRatioObs.set(1, tx);
			}
		});
	}

	protected override async _doAccept(): Promise<void> {
		this._multiDiffEntryDelegate.collapse(undefined);
	}

	protected override async _doReject(): Promise<void> {
		await this._fileService.writeFile(this.modifiedURI, VSBuffer.fromString(this._originalContent));
		this._multiDiffEntryDelegate.collapse(undefined);
	}

	protected _createEditorIntegration(_editor: IEditorPane): IModifiedFileEntryEditorIntegration {
		return {
			currentIndex: observableValue(this, 0),
			reveal: () => { },
			next: () => false,
			previous: () => false,
			enableAccessibleDiffView: () => { },
			acceptNearestChange: async () => { },
			rejectNearestChange: async () => { },
			toggleDiff: async () => { },
			dispose: () => { }
		};
	}

	async computeEditsFromSnapshots(_beforeSnapshot: string, _afterSnapshot: string): Promise<(TextEdit | ICellEditOperation)[]> {
		return [];
	}

	async save(): Promise<void> {
	}

	async revertToDisk(): Promise<void> {
	}
}
