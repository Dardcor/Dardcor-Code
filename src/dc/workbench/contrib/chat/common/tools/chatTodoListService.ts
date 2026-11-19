/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { Memento } from '../../../../common/memento.js';

export interface IChatTodo {
	id: number;
	title: string;
	status: 'not-started' | 'in-progress' | 'completed';
}

export interface IChatTodoListStorage {
	getTodoList(sessionResource: URI): IChatTodo[];
	setTodoList(sessionResource: URI, todoList: IChatTodo[]): void;
	migrateTodoList(oldSessionResource: URI, newSessionResource: URI): void;
}

export const IChatTodoListService = createDecorator<IChatTodoListService>('chatTodoListService');

export interface IChatTodoListService {
	readonly _serviceBrand: undefined;
	readonly onDidUpdateTodos: Event<URI>;
	getTodos(sessionResource: URI): IChatTodo[];
	setTodos(sessionResource: URI, todos: IChatTodo[]): void;
	migrateTodos(oldSessionResource: URI, newSessionResource: URI): void;
}

export class ChatTodoListStorage implements IChatTodoListStorage {
	private memento: Memento<Record<string, IChatTodo[]>>;

	constructor(@IStorageService storageService: IStorageService) {
		this.memento = new Memento('chat-todo-list', storageService);
	}

	private getSessionData(sessionResource: URI): IChatTodo[] {
		const storage = this.memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const raw = storage[this.toKey(sessionResource)] || [];
		return raw.map(item => ({ ...item }));
	}

	private setSessionData(sessionResource: URI, todoList: IChatTodo[]): void {
		const storage = this.memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage[this.toKey(sessionResource)] = todoList;
		this.memento.saveMemento();
	}

	getTodoList(sessionResource: URI): IChatTodo[] {
		return this.getSessionData(sessionResource);
	}

	setTodoList(sessionResource: URI, todoList: IChatTodo[]): void {
		this.setSessionData(sessionResource, todoList);
	}

	migrateTodoList(oldSessionResource: URI, newSessionResource: URI): void {
		const todos = this.getSessionData(oldSessionResource);
		if (todos.length > 0) {
			this.setSessionData(newSessionResource, todos);
			const storage = this.memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
			delete storage[this.toKey(oldSessionResource)];
			this.memento.saveMemento();
		}
	}

	private toKey(sessionResource: URI): string {
		const pathParts = sessionResource.path.split('/');
		if (sessionResource.scheme === Schemas.vscodeLocalChatSession && sessionResource.authority && pathParts.length === 2) {
			const sessionId = decodeBase64(pathParts[1]);
			return new TextDecoder().decode(sessionId.buffer);
		}
		return sessionResource.toString();
	}
}

export class ChatTodoListService extends Disposable implements IChatTodoListService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidUpdateTodos = this._register(new Emitter<URI>());
	readonly onDidUpdateTodos = this._onDidUpdateTodos.event;

	private todoListStorage: IChatTodoListStorage;

	constructor(@IStorageService storageService: IStorageService) {
		super();
		this.todoListStorage = new ChatTodoListStorage(storageService);
	}

	getTodos(sessionResource: URI): IChatTodo[] {
		return this.todoListStorage.getTodoList(sessionResource);
	}

	setTodos(sessionResource: URI, todos: IChatTodo[]): void {
		this.todoListStorage.setTodoList(sessionResource, todos);
		this._onDidUpdateTodos.fire(sessionResource);
	}

	migrateTodos(oldSessionResource: URI, newSessionResource: URI): void {
		this.todoListStorage.migrateTodoList(oldSessionResource, newSessionResource);
		this._onDidUpdateTodos.fire(newSessionResource);
	}
}

export type TodoStatus = 'not-started' | 'in-progress' | 'completed';

export interface INormalizedTodoItem {
	id: number;
	title: string;
	status: TodoStatus;
}

export interface INormalizedTodoListResult {
	operation: 'read' | 'write';
	items: INormalizedTodoItem[];
	rawCount: number;
}

export function normalizeTodoStatus(rawStatus: unknown): TodoStatus {
	if (typeof rawStatus === 'boolean') {
		return rawStatus ? 'completed' : 'not-started';
	}
	if (typeof rawStatus === 'number') {
		return rawStatus === 1 ? 'completed' : 'not-started';
	}
	if (typeof rawStatus !== 'string') {
		return 'not-started';
	}

	const cleaned = rawStatus.trim().toLowerCase().replace(/^[\[\]]+/g, '').replace(/[\s_-]+/g, '-');

	switch (cleaned) {
		case 'completed':
		case 'complete':
		case 'done':
		case 'finished':
		case 'finish':
		case 'closed':
		case 'success':
		case 'resolved':
		case 'solved':
		case 'passed':
		case 'pass':
		case 'fixed':
		case 'verified':
		case 'x':
		case 'checked':
		case 'true':
			return 'completed';

		case 'in-progress':
		case 'inprogress':
		case 'in-prog':
		case 'progress':
		case 'doing':
		case 'working':
		case 'ongoing':
		case 'started':
		case 'start':
		case 'current':
		case 'active':
		case 'running':
		case 'processing':
		case 'wip':
		case 'work-in-progress':
		case 'underway':
		case '-':
		case '~':
		case '*':
			return 'in-progress';

		case 'not-started':
		case 'notstarted':
		case 'unstarted':
		case 'todo':
		case 'to-do':
		case 'pending':
		case 'queued':
		case 'queue':
		case 'waiting':
		case 'open':
		case 'backlog':
		case 'blocked':
		case 'new':
		case 'idle':
		case 'paused':
		case 'ready':
		case 'false':
		case ' ':
		case '':
		default:
			return 'not-started';
	}
}

function parseTodoFromString(text: string, fallbackId: number): INormalizedTodoItem | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}

	let status: TodoStatus = 'not-started';
	let title = trimmed;
	let id = fallbackId;

	const checkMatch = title.match(/^[-*+]\s*\[([\sxX\-~*])\]\s*(.*)$/);
	if (checkMatch) {
		const checkChar = checkMatch[1].toLowerCase();
		if (checkChar === 'x') {
			status = 'completed';
		} else if (checkChar === '-' || checkChar === '~' || checkChar === '*') {
			status = 'in-progress';
		} else {
			status = 'not-started';
		}
		title = checkMatch[2].trim();
	} else {
		title = title.replace(/^[-*+]\s+/, '').trim();
	}

	const numMatch = title.match(/^(?:#|\b)?(\d+)[\.\)\:\-]\s*(.*)$/);
	if (numMatch) {
		const parsedNum = parseInt(numMatch[1], 10);
		if (!isNaN(parsedNum) && parsedNum > 0) {
			id = parsedNum;
		}
		title = numMatch[2].trim();
	}

	const endStatusMatch = title.match(/[\(\[]\s*(completed|complete|done|in-progress|in_progress|pending|todo|not-started)\s*[\)\]]\s*$/i);
	if (endStatusMatch) {
		status = normalizeTodoStatus(endStatusMatch[1]);
		title = title.slice(0, endStatusMatch.index).trim();
	}

	return { id, title: title || `Task ${id}`, status };
}

function parseTodoFromObject(rawItem: any, fallbackId: number): INormalizedTodoItem | undefined {
	if (!rawItem || typeof rawItem !== 'object') {
		return undefined;
	}

	const rawTitle = rawItem.title
		?? rawItem.text
		?? rawItem.task
		?? rawItem.content
		?? rawItem.description
		?? rawItem.desc
		?? rawItem.name
		?? rawItem.label
		?? rawItem.summary
		?? rawItem.todo
		?? rawItem.value
		?? rawItem.message;

	let title = typeof rawTitle === 'string' ? rawTitle.trim() : (typeof rawTitle === 'number' ? String(rawTitle) : '');

	let id = fallbackId;
	const rawId = rawItem.id ?? rawItem.index ?? rawItem.key ?? rawItem.step ?? rawItem.stepNumber ?? rawItem.number;
	if (typeof rawId === 'number' && Number.isFinite(rawId) && rawId > 0) {
		id = Math.floor(rawId);
	} else if (typeof rawId === 'string') {
		const match = rawId.match(/\d+/);
		if (match) {
			const parsed = parseInt(match[0], 10);
			if (!isNaN(parsed) && parsed > 0) {
				id = parsed;
			}
		}
	}

	if (!title) {
		if (typeof rawItem.step === 'string') {
			title = rawItem.step.trim();
		} else {
			title = `Task ${id}`;
		}
	}

	const leadingCheck = title.match(/^\[([\sxX\-~*])\]\s*(.*)$/);
	let statusFromTitle: TodoStatus | undefined;
	if (leadingCheck) {
		const c = leadingCheck[1].toLowerCase();
		statusFromTitle = (c === 'x') ? 'completed' : (c === '-' || c === '~' || c === '*') ? 'in-progress' : 'not-started';
		title = leadingCheck[2].trim();
	}
	title = title.replace(/^[-*+]\s+/, '').replace(/^\d+[\.\)\:\-]\s*/, '').trim();

	const rawStatus = rawItem.status ?? rawItem.state ?? rawItem.done ?? rawItem.completed;
	let status: TodoStatus = statusFromTitle ?? normalizeTodoStatus(rawStatus);

	if (rawItem.done === true || rawItem.completed === true) {
		status = 'completed';
	} else if (rawItem.active === true || rawItem.inProgress === true) {
		status = 'in-progress';
	}

	return { id, title: title || `Task ${id}`, status };
}

export function normalizeTodoListArgs(rawArgs: any): INormalizedTodoListResult {
	if (rawArgs === null || rawArgs === undefined) {
		return { operation: 'read', items: [], rawCount: 0 };
	}

	let current: any = rawArgs;

	if (typeof current === 'string') {
		const trimmed = current.trim();
		if (!trimmed) {
			return { operation: 'read', items: [], rawCount: 0 };
		}

		const codeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
		const jsonCandidate = codeFenceMatch ? codeFenceMatch[1].trim() : trimmed;

		try {
			const parsed = JSON.parse(jsonCandidate);
			current = parsed;
			if (typeof current === 'string') {
				try {
					current = JSON.parse(current);
				} catch { }
			}
		} catch {
			const lines = jsonCandidate.split('\n').map(l => l.trim()).filter(Boolean);
			const parsedLines: INormalizedTodoItem[] = [];
			let counter = 1;
			for (const line of lines) {
				const item = parseTodoFromString(line, counter);
				if (item) {
					parsedLines.push({ ...item, id: counter++ });
				}
			}
			if (parsedLines.length > 0) {
				return postProcessNormalizedResult('write', parsedLines);
			}
			return { operation: 'read', items: [], rawCount: 0 };
		}
	}

	for (let depth = 0; depth < 3; depth++) {
		if (current && typeof current === 'object' && !Array.isArray(current)) {
			if (current.parameters && typeof current.parameters === 'object') {
				current = current.parameters;
				continue;
			}
			if (current.params && typeof current.params === 'object') {
				current = current.params;
				continue;
			}
			if (current.args && typeof current.args === 'object') {
				current = current.args;
				continue;
			}
			if (current.input && typeof current.input === 'object') {
				current = current.input;
				continue;
			}
			if (current.body && typeof current.body === 'object') {
				current = current.body;
				continue;
			}
			if (current.payload && typeof current.payload === 'object') {
				current = current.payload;
				continue;
			}
		}
		break;
	}

	const opCandidate = String(current?.operation ?? current?.action ?? current?.type ?? current?.method ?? current?.command ?? '').trim().toLowerCase();
	const isExplicitRead = opCandidate === 'read' || opCandidate === 'get' || opCandidate === 'view' || opCandidate === 'list' || opCandidate === 'query';

	let rawItems: any[] | undefined;

	if (Array.isArray(current)) {
		rawItems = current;
	} else if (current && typeof current === 'object') {
		const candidateKeys = [
			'todoList', 'todo_list', 'todos', 'tasks', 'items', 'checklist',
			'list', 'plan', 'steps', 'elements', 'allTodos', 'todolist',
			'actions', 'data'
		];

		for (const key of candidateKeys) {
			if (Array.isArray(current[key])) {
				rawItems = current[key];
				break;
			}
		}

		if (!rawItems) {
			const singleKeys = ['todo', 'task', 'item', 'step'];
			for (const key of singleKeys) {
				if (current[key] && typeof current[key] === 'object' && !Array.isArray(current[key])) {
					rawItems = [current[key]];
					break;
				}
			}
		}

		if (!rawItems && (current.title || current.task || current.text || current.content) && (current.status || current.state || current.id !== undefined)) {
			rawItems = [current];
		}
	}

	if (!rawItems || rawItems.length === 0) {
		return { operation: isExplicitRead ? 'read' : 'write', items: [], rawCount: 0 };
	}

	const items: INormalizedTodoItem[] = [];
	let nextId = 1;

	for (const rawItem of rawItems) {
		if (typeof rawItem === 'string') {
			const parsed = parseTodoFromString(rawItem, nextId);
			if (parsed) {
				items.push(parsed);
				nextId++;
			}
		} else if (rawItem && typeof rawItem === 'object') {
			const parsed = parseTodoFromObject(rawItem, nextId);
			if (parsed) {
				items.push(parsed);
				nextId++;
			}
		}
	}

	const operation = isExplicitRead ? 'read' : 'write';
	return postProcessNormalizedResult(operation, items);
}

function postProcessNormalizedResult(operation: 'read' | 'write', items: INormalizedTodoItem[]): INormalizedTodoListResult {
	if (items.length === 0) {
		return { operation, items: [], rawCount: 0 };
	}

	const normalizedItems: INormalizedTodoItem[] = items.map((item, idx) => ({
		id: idx + 1,
		title: item.title,
		status: item.status
	}));

	let hasActiveInProgress = false;
	for (const item of normalizedItems) {
		if (item.status === 'in-progress') {
			if (!hasActiveInProgress) {
				hasActiveInProgress = true;
			} else {
				item.status = 'not-started';
			}
		}
	}

	return {
		operation,
		items: normalizedItems,
		rawCount: items.length
	};
}
