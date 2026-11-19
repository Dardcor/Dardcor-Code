/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../util/dardcor/base/common/event';
import { Disposable } from '../../util/dardcor/base/common/lifecycle';

export type TodoStatus = 'not-started' | 'in-progress' | 'completed' | 'blocked';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
	readonly id: string | number;
	readonly content: string;
	status: TodoStatus;
	priority?: TodoPriority;
}

export class TodoManager extends Disposable {
	private _todos: TodoItem[] = [];
	private readonly _onDidChangeTodos = this._register(new Emitter<readonly TodoItem[]>());
	readonly onDidChangeTodos: Event<readonly TodoItem[]> = this._onDidChangeTodos.event;

	get todos(): readonly TodoItem[] {
		return this._todos;
	}

	setTodos(items: readonly TodoItem[]): void {
		this._todos = items.map(item => ({ ...item }));
		this._onDidChangeTodos.fire(this._todos);
	}

	updateStatus(id: string | number, status: TodoStatus): boolean {
		const target = this._todos.find(item => String(item.id) === String(id));
		if (!target) {
			return false;
		}
		target.status = status;
		this._onDidChangeTodos.fire(this._todos);
		return true;
	}

	clear(): void {
		this._todos = [];
		this._onDidChangeTodos.fire(this._todos);
	}
}
