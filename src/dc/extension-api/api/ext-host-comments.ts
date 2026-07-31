import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { Range, Position } from './ext-host-api-impl.js';
import { TextDocument } from './ext-host-documents.js';

export interface ICommentAuthor {
	name: string;
	iconPath?: URI;
}

export interface Comment {
	readonly body: string;
	readonly author: ICommentAuthor;
	readonly label?: string;
	readonly contextValue?: string;
}

export interface CommentThread extends IDisposable {
	readonly id: string;
	readonly uri: URI;
	readonly range: Range;
	comments: Comment[];
	collapsibleState?: number;
	canReply?: boolean;
	contextValue?: string;
	dispose(): void;
}

export interface ICommentControllerHandler {
	provideCommentThreads?(document: TextDocument): CommentThread[] | Promise<CommentThread[] | undefined> | undefined;
}

export interface CommentController extends IDisposable {
	readonly id: string;
	readonly label: string;
	createCommentThread(uri: URI, range: Range, comments: Comment[]): CommentThread;
	dispose(): void;
}

export class CommentThreadImpl implements CommentThread {
	private _comments: Comment[];
	private _collapsibleState: number | undefined;
	private _canReply = true;
	private _contextValue: string | undefined;
	private _disposed = false;

	constructor(
		public readonly id: string,
		public readonly uri: URI,
		public readonly range: Range,
		comments: Comment[],
		private readonly _onDispose: () => void
	) {
		this._comments = comments.slice();
	}

	public get comments(): Comment[] {
		return this._comments.slice();
	}

	public set comments(value: Comment[]) {
		this._comments = value.slice();
	}

	public get collapsibleState(): number | undefined {
		return this._collapsibleState;
	}

	public set collapsibleState(value: number | undefined) {
		this._collapsibleState = value;
	}

	public get canReply(): boolean {
		return this._canReply;
	}

	public set canReply(value: boolean) {
		this._canReply = value;
	}

	public get contextValue(): string | undefined {
		return this._contextValue;
	}

	public set contextValue(value: string | undefined) {
		this._contextValue = value;
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._onDispose();
	}
}

export class CommentControllerImpl implements CommentController {
	private readonly _threads = new Map<string, CommentThread>();
	private _nextThreadId = 1;
	private _disposed = false;

	private readonly _onDidChangeThreads = new Emitter<CommentThread[]>();
	readonly onDidChangeThreads: Event<CommentThread[]> = this._onDidChangeThreads.event;

	constructor(
		public readonly id: string,
		public readonly label: string,
		public readonly handler: ICommentControllerHandler,
		private readonly _onDispose: () => void
	) {}

	public createCommentThread(uri: URI, range: Range, comments: Comment[]): CommentThread {
		if (this._disposed) {
			throw new Error('Comment controller sudah dibuang');
		}
		const threadId = `${this.id}:${this._nextThreadId++}`;
		const thread = new CommentThreadImpl(threadId, uri, range, comments, () => {
			this._threads.delete(threadId);
			this._onDidChangeThreads.fire(this.getThreads());
		});
		this._threads.set(threadId, thread);
		this._onDidChangeThreads.fire(this.getThreads());
		return thread;
	}

	public getThread(id: string): CommentThread | undefined {
		return this._threads.get(id);
	}

	public getThreads(): CommentThread[] {
		return [...this._threads.values()];
	}

	public getThreadsFor(uri: URI): CommentThread[] {
		return this.getThreads().filter(thread => thread.uri.toString() === uri.toString());
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		for (const thread of this._threads.values()) {
			thread.dispose();
		}
		this._threads.clear();
		this._onDidChangeThreads.dispose();
		this._onDispose();
	}
}

export class ExtHostComments extends Disposable {
	private readonly _controllers = new Map<string, CommentControllerImpl>();

	public registerCommentController(id: string, label: string, handler: ICommentControllerHandler): CommentController {
		if (this._controllers.has(id)) {
			throw new Error(`Comment controller '${id}' sudah terdaftar`);
		}
		const controller = new CommentControllerImpl(id, label, handler, () => {
			this._controllers.delete(id);
		});
		this._controllers.set(id, controller);
		return controller;
	}

	public getController(id: string): CommentController | undefined {
		return this._controllers.get(id);
	}

	public getControllers(): CommentController[] {
		return [...this._controllers.values()];
	}

	public async provideCommentThreads(document: TextDocument): Promise<CommentThread[]> {
		const threads: CommentThread[] = [];
		for (const controller of this._controllers.values()) {
			const provided = await controller.handler.provideCommentThreads?.(document);
			if (provided) {
				threads.push(...provided);
			}
		}
		return threads;
	}

	public override dispose(): void {
		for (const controller of this._controllers.values()) {
			controller.dispose();
		}
		this._controllers.clear();
		super.dispose();
	}
}

export function commentAtPosition(threads: CommentThread[], position: Position): CommentThread | undefined {
	for (const thread of threads) {
		const start = thread.range.start;
		const end = thread.range.end;
		if (!position.isBefore(start) && !position.isAfter(end)) {
			return thread;
		}
	}
	return undefined;
}

export function toDisposableThread(thread: CommentThread): IDisposable {
	return toDisposable(() => thread.dispose());
}
