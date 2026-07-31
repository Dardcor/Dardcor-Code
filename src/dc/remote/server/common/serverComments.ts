import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerComment {
	readonly uniqueIdInThread: number;
	readonly body: string;
	readonly userName: string;
	readonly userIconPath?: string;
	readonly timestamp?: number;
	readonly contextValue?: string;
	readonly mode: 'preview' | 'editing';
	readonly label?: string;
}

export interface IServerCommentThread {
	readonly threadId: string;
	readonly uri: string;
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly comments: IServerComment[];
	readonly collapsibleState: 'collapsed' | 'expanded';
	readonly label?: string;
	readonly contextValue?: string;
	readonly canReply: boolean;
}

export interface IServerCommentController {
	readonly id: string;
	readonly label: string;
	createCommentThread(uri: string, range: any, comments: IServerComment[]): IServerCommentThread;
	deleteCommentThread(threadId: string): void;
	getCommentThreads(uri: string): IServerCommentThread[];
}

export interface IServerCommentsService {
	readonly onDidChangeCommentThreads: Event<{ uri: string; added: IServerCommentThread[]; removed: string[]; changed: IServerCommentThread[] }>;
	readonly onDidChangeActiveCommentThread: Event<IServerCommentThread | undefined>;
	registerCommentController(controller: IServerCommentController): IDisposable;
	getCommentControllers(): IServerCommentController[];
	getCommentThreads(uri: string): IServerCommentThread[];
	createCommentThread(controllerId: string, uri: string, range: any, comments: IServerComment[]): IServerCommentThread | undefined;
	deleteCommentThread(controllerId: string, threadId: string): void;
	setActiveCommentThread(thread: IServerCommentThread | undefined): void;
	getActiveCommentThread(): IServerCommentThread | undefined;
}

export class ServerCommentsCommon implements IServerCommentsService {
	private readonly _controllers = new Map<string, IServerCommentController>();
	private _activeThread: IServerCommentThread | undefined;

	private readonly _onDidChangeCommentThreads = new Emitter<{ uri: string; added: IServerCommentThread[]; removed: string[]; changed: IServerCommentThread[] }>();
	readonly onDidChangeCommentThreads = this._onDidChangeCommentThreads.event;

	private readonly _onDidChangeActiveCommentThread = new Emitter<IServerCommentThread | undefined>();
	readonly onDidChangeActiveCommentThread = this._onDidChangeActiveCommentThread.event;

	registerCommentController(controller: IServerCommentController): IDisposable {
		this._controllers.set(controller.id, controller);
		return { dispose: () => { this._controllers.delete(controller.id); } };
	}

	getCommentControllers(): IServerCommentController[] {
		return Array.from(this._controllers.values());
	}

	getCommentThreads(uri: string): IServerCommentThread[] {
		const result: IServerCommentThread[] = [];
		for (const c of this._controllers.values()) {
			result.push(...c.getCommentThreads(uri));
		}
		return result;
	}

	createCommentThread(controllerId: string, uri: string, range: any, comments: IServerComment[]): IServerCommentThread | undefined {
		const controller = this._controllers.get(controllerId);
		if (controller) {
			const thread = controller.createCommentThread(uri, range, comments);
			this._onDidChangeCommentThreads.fire({ uri, added: [thread], removed: [], changed: [] });
			return thread;
		}
		return undefined;
	}

	deleteCommentThread(controllerId: string, threadId: string): void {
		const controller = this._controllers.get(controllerId);
		if (controller) {
			controller.deleteCommentThread(threadId);
		}
	}

	setActiveCommentThread(thread: IServerCommentThread | undefined): void {
		this._activeThread = thread;
		this._onDidChangeActiveCommentThread.fire(thread);
	}

	getActiveCommentThread(): IServerCommentThread | undefined {
		return this._activeThread;
	}
}
