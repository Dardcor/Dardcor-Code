import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerDragAndDropData {
	readonly type: 'text' | 'files' | 'urls';
	readonly data: string | string[];
}

export interface IServerDragAndDropTarget {
	readonly id: string;
	canDrop(data: IServerDragAndDropData): boolean;
	drop(data: IServerDragAndDropData): Promise<void>;
}

export interface IServerDragAndDropService {
	readonly onDidDrop: Event<{ targetId: string; data: IServerDragAndDropData }>;
	registerTarget(target: IServerDragAndDropTarget): IDisposable;
	getTargets(): IServerDragAndDropTarget[];
	simulateDrop(targetId: string, data: IServerDragAndDropData): Promise<void>;
}

export class ServerDragAndDropCommon implements IServerDragAndDropService {
	private readonly _targets = new Map<string, IServerDragAndDropTarget>();

	private readonly _onDidDrop = new Emitter<{ targetId: string; data: IServerDragAndDropData }>();
	readonly onDidDrop = this._onDidDrop.event;

	registerTarget(target: IServerDragAndDropTarget): IDisposable {
		this._targets.set(target.id, target);
		return { dispose: () => { this._targets.delete(target.id); } };
	}

	getTargets(): IServerDragAndDropTarget[] {
		return Array.from(this._targets.values());
	}

	async simulateDrop(targetId: string, data: IServerDragAndDropData): Promise<void> {
		const target = this._targets.get(targetId);
		if (target && target.canDrop(data)) {
			await target.drop(data);
			this._onDidDrop.fire({ targetId, data });
		}
	}
}
