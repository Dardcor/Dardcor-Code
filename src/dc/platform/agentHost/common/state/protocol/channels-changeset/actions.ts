/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ActionType } from '../common/actions.js';
import type { ErrorInfo } from '../common/state.js';
import { ChangesetStatus, type ChangesetFile, type ChangesetOperation, type ChangesetOperationStatus } from './state.js';


export interface ChangesetStatusChangedAction {
	type: ActionType.ChangesetStatusChanged;
	status: ChangesetStatus;
	error?: ErrorInfo;
}

export interface ChangesetFileSetAction {
	type: ActionType.ChangesetFileSet;
	file: ChangesetFile;
}

export interface ChangesetFileRemovedAction {
	type: ActionType.ChangesetFileRemoved;
	fileId: string;
}

export interface ChangesetFilesReviewChangedAction {
	type: ActionType.ChangesetFilesReviewChanged;
	files: string[];
	reviewed: boolean;
}

export interface ChangesetContentChangedAction {
	type: ActionType.ChangesetContentChanged;
	files: ChangesetFile[];
	operations?: ChangesetOperation[];
}

export interface ChangesetOperationsChangedAction {
	type: ActionType.ChangesetOperationsChanged;
	operations: ChangesetOperation[] | undefined;
}

export interface ChangesetOperationStatusChangedAction {
	type: ActionType.ChangesetOperationStatusChanged;
	operationId: string;
	status: ChangesetOperationStatus;
	error?: ErrorInfo;
}

export interface ChangesetClearedAction {
	type: ActionType.ChangesetCleared;
}
