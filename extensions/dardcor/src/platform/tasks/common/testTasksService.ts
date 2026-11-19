/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type * as vscode from 'vscode';
import { URI } from '../../../util/dardcor/base/common/uri';
import { ITasksService, TaskResult, TaskStatus } from './tasksService';

export class TestTasksService implements ITasksService {
	_serviceBrand: undefined;

	async ensureTask(): Promise<void> {
	}

	hasTask(): boolean {
		return false;
	}

	getTasks(): [] {
		return [];
	}

	getTaskConfigPosition() {
		return Promise.resolve(undefined);
	}

	async executeTask(def: vscode.TaskDefinition, token: vscode.CancellationToken, workspaceFolder?: URI): Promise<TaskResult> {
		return {
			status: TaskStatus.Error,
			error: new Error(`Task not found: ${def.type}:${def.label}`)
		};
	}

	isTaskActive(def: vscode.TaskDefinition): boolean {
		return false;
	}

	getTerminalForTask(task: vscode.TaskDefinition): vscode.Terminal | undefined {
		return {
			name: task.label || 'mock-terminal',
			processId: Promise.resolve(12345),
		} as unknown as vscode.Terminal;
	}
}
