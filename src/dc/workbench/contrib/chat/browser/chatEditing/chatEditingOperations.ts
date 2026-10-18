/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringSHA1 } from '../../../../../base/common/hash.js';
import { URI } from '../../../../../base/common/uri.js';
import { TextEdit } from '../../../../../editor/common/languages.js';
import { ICellEditOperation } from '../../../notebook/common/notebookCommon.js';
import { IModifiedEntryTelemetryInfo } from '../../common/editing/chatEditingService.js';
import { LocalChatSessionUri } from '../../common/model/chatUri.js';

export enum FileOperationType {
	Create = 'create',
	Delete = 'delete',
	Rename = 'rename',
	TextEdit = 'textEdit',
	NotebookEdit = 'notebookEdit'
}

export interface IFileOperation {
	readonly type: FileOperationType;
	readonly uri: URI;
	readonly requestId: string;
	readonly epoch: number;
}

export interface IFileCreateOperation extends IFileOperation {
	readonly type: FileOperationType.Create;
	readonly initialContent: string;
	readonly notebookViewType?: string;
	readonly telemetryInfo: IModifiedEntryTelemetryInfo;
}

export interface IFileDeleteOperation extends IFileOperation {
	readonly type: FileOperationType.Delete;
	readonly finalContent: string;
}

export interface IFileRenameOperation extends IFileOperation {
	readonly type: FileOperationType.Rename;
	readonly oldUri: URI;
	readonly newUri: URI;
}

export interface ITextEditOperation extends IFileOperation {
	readonly type: FileOperationType.TextEdit;
	readonly edits: readonly TextEdit[];
	readonly cellIndex?: number;
}

export interface INotebookEditOperation extends IFileOperation {
	readonly type: FileOperationType.NotebookEdit;
	readonly cellEdits: readonly ICellEditOperation[];
}

export type FileOperation = IFileCreateOperation | IFileDeleteOperation | IFileRenameOperation | ITextEditOperation | INotebookEditOperation;

export interface IFileBaseline {
	readonly uri: URI;
	readonly requestId: string;
	readonly content: string;
	readonly epoch: number;
	readonly telemetryInfo: IModifiedEntryTelemetryInfo;
	readonly notebookViewType?: string;
}

export interface IReconstructedFileExistsState {
	readonly exists: true;
	readonly content: string;
	readonly uri: URI;
	readonly telemetryInfo: IModifiedEntryTelemetryInfo;
	readonly notebookViewType?: string;
}

export interface IReconstructedFileNotExistsState {
	readonly exists: false;
	readonly uri: URI;
}

export type IReconstructedFileState = IReconstructedFileNotExistsState | IReconstructedFileExistsState;

export interface ICheckpoint {
	readonly checkpointId: string;
	readonly requestId: string | undefined;
	readonly undoStopId: string | undefined;
	readonly epoch: number;
	readonly label: string;
	readonly description?: string;
}

export interface IChatEditingTimelineState {
	readonly checkpoints: readonly ICheckpoint[];
	readonly fileBaselines: [string, IFileBaseline][];
	readonly operations: readonly FileOperation[];
	readonly currentEpoch: number;
	readonly epochCounter: number;
}

export function getKeyForChatSessionResource(chatSessionResource: URI) {
	const sessionId = LocalChatSessionUri.parseLocalSessionId(chatSessionResource);
	if (sessionId) {
		return sessionId;
	}

	const sha = new StringSHA1();
	sha.update(chatSessionResource.toString());
	return sha.digest();
}
