/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { URI } from '../../../util/dardcor/base/common/uri';
import { Range } from '../../../util/dardcor/editor/common/core/range';

export enum TaskStatus {
	Started = 'started',
	Error = 'error',
	Finished = 'finished'
}

export type TaskResult = {
	status: TaskStatus;
	error?: Error;
};

export interface ITasksService {
	_serviceBrand: undefined;

	ensureTask(workspaceFolder: URI, definition: vscode.TaskDefinition, skipDefault?: boolean): Promise<void>;
	hasTask(workspaceFolder: URI, definition: vscode.TaskDefinition): boolean;
	getTaskConfigPosition(workspaceFolder: URI, def: vscode.TaskDefinition): Promise<{ uri: URI; range: Range } | undefined>;
	getTasks(): [URI, vscode.TaskDefinition[]][];
	getTasks(workspaceFolder: URI): vscode.TaskDefinition[];
	executeTask(definition: vscode.TaskDefinition, token: CancellationToken, workspaceFolder?: URI): Promise<TaskResult>;

	isTaskActive(definition: vscode.TaskDefinition): boolean;


	getTerminalForTask(task: vscode.TaskDefinition): vscode.Terminal | undefined;
}

export const ITasksService = createServiceIdentifier<ITasksService>('ITasksService');
