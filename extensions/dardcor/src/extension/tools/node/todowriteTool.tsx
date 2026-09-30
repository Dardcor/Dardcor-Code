/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { IToolsService } from '../common/toolsService';

export interface ITodoWriteItem {
	readonly content: string;
	readonly status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'not-started';
	readonly priority?: 'high' | 'medium' | 'low';
}

export interface ITodoWriteParams {
	readonly todos: readonly ITodoWriteItem[];
}

function normalizeStatus(status: string): 'not-started' | 'in-progress' | 'completed' {
	switch (status) {
		case 'completed':
		case 'done':
			return 'completed';
		case 'in_progress':
		case 'in-progress':
			return 'in-progress';
		case 'pending':
		case 'blocked':
		case 'not-started':
		default:
			return 'not-started';
	}
}

export class TodoWriteTool implements ICopilotTool<ITodoWriteParams> {
	public static readonly toolName = ToolName.TodoWrite;
	public static readonly nonDeferred = true;

	constructor(@IToolsService private readonly _toolsService: IToolsService) {}

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ITodoWriteParams>,
		token: CancellationToken
	): Promise<vscode.LanguageModelToolResult> {
		const rawTodos = options.input?.todos ?? [];
		const normalizedTodos = rawTodos.map((todo, idx) => ({
			id: idx + 1,
			title: todo.content,
			description: todo.priority ? `Priority: ${todo.priority}` : '',
			status: normalizeStatus(todo.status),
		}));

		try {
			// Synchronize with the workbench-level todo manager and UI widget
			await this._toolsService.invokeTool(
				ToolName.CoreManageTodoList,
				{
					input: {
						operation: 'write',
						todoList: normalizedTodos,
					},
					toolInvocationToken: options.toolInvocationToken,
				},
				token
			);
		} catch {
			// Continue execution even if the workbench UI widget is not registered
		}

		const summary = {
			total: normalizedTodos.length,
			completed: normalizedTodos.filter(t => t.status === 'completed').length,
			inProgress: normalizedTodos.filter(t => t.status === 'in-progress').length,
			notStarted: normalizedTodos.filter(t => t.status === 'not-started').length,
			todos: normalizedTodos,
		};

		return new LanguageModelToolResult([
			new LanguageModelTextPart(JSON.stringify(summary, null, 2)),
		]);
	}
}

ToolRegistry.registerTool(TodoWriteTool);
