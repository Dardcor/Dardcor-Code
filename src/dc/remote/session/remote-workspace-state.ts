/**
 * Dardcor Code - Remote Open Files & Cursor State Snapshot Sync (Task 820)
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { IRemoteChannelClient } from '../transport/connection-multiplexer.js';

export interface IEditorPosition {
	readonly line: number;
	readonly character: number;
}

export interface IOpenFileState {
	resource: string;
	cursor: IEditorPosition;
	selections: IEditorPosition[];
	dirty: boolean;
	lastOpenedAt: number;
}

export interface IWorkspaceSnapshot {
	openFiles: IOpenFileState[];
	activeFile?: string;
	scrollPositions: Record<string, number>;
	timestamp: number;
}

export function createEmptySnapshot(): IWorkspaceSnapshot {
	return { openFiles: [], scrollPositions: {}, timestamp: Date.now() };
}

export class RemoteWorkspaceState extends Disposable {
	private _snapshot: IWorkspaceSnapshot = createEmptySnapshot();

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidReceiveSnapshot = this._register(new Emitter<IWorkspaceSnapshot>());
	readonly onDidReceiveSnapshot: Event<IWorkspaceSnapshot> = this._onDidReceiveSnapshot.event;

	private _channel: IRemoteChannelClient | null = null;
	private _lastPushedAt = 0;

	get snapshot(): IWorkspaceSnapshot {
		return this._snapshot;
	}

	get openFileCount(): number {
		return this._snapshot.openFiles.length;
	}

	openFile(resource: string, cursor: IEditorPosition = { line: 0, character: 0 }): void {
		const existing = this._snapshot.openFiles.find(f => f.resource === resource);
		const state: IOpenFileState = {
			resource,
			cursor,
			selections: existing ? existing.selections : [cursor],
			dirty: existing ? existing.dirty : false,
			lastOpenedAt: Date.now()
		};
		this._snapshot.openFiles = [...this._snapshot.openFiles.filter(f => f.resource !== resource), state];
		this._snapshot.activeFile = resource;
		this._touch();
	}

	closeFile(resource: string): void {
		this._snapshot.openFiles = this._snapshot.openFiles.filter(f => f.resource !== resource);
		if (this._snapshot.activeFile === resource) {
			this._snapshot.activeFile = this._snapshot.openFiles.at(-1)?.resource;
		}
		this._touch();
	}

	updateCursor(resource: string, cursor: IEditorPosition, selections?: IEditorPosition[]): void {
		const file = this._snapshot.openFiles.find(f => f.resource === resource);
		if (!file) {
			return;
		}
		file.cursor = cursor;
		if (selections) {
			file.selections = selections;
		}
		this._touch();
	}

	setDirty(resource: string, dirty: boolean): void {
		const file = this._snapshot.openFiles.find(f => f.resource === resource);
		if (!file || file.dirty === dirty) {
			return;
		}
		file.dirty = dirty;
		this._touch();
	}

	updateScroll(resource: string, position: number): void {
		this._snapshot.scrollPositions[resource] = position;
		this._touch();
	}

	setActiveFile(resource: string | undefined): void {
		this._snapshot.activeFile = resource;
		this._touch();
	}

	toJson(): string {
		return JSON.stringify(this._snapshot);
	}

	fromJson(json: string): boolean {
		try {
			const parsed = JSON.parse(json) as Partial<IWorkspaceSnapshot>;
			if (!parsed || !Array.isArray(parsed.openFiles)) {
				return false;
			}
			this._snapshot = {
				openFiles: parsed.openFiles,
				activeFile: parsed.activeFile,
				scrollPositions: parsed.scrollPositions ?? {},
				timestamp: parsed.timestamp ?? Date.now()
			};
			this._onDidReceiveSnapshot.fire(this._snapshot);
			this._onDidChange.fire();
			return true;
		} catch {
			return false;
		}
	}

	applySnapshot(snapshot: IWorkspaceSnapshot): void {
		this._snapshot = {
			openFiles: [...snapshot.openFiles],
			activeFile: snapshot.activeFile,
			scrollPositions: { ...snapshot.scrollPositions },
			timestamp: snapshot.timestamp
		};
		this._onDidReceiveSnapshot.fire(this._snapshot);
		this._onDidChange.fire();
	}

	bindChannel(channel: IRemoteChannelClient): void {
		this._channel = channel;
		this._register(channel.onEvent(payload => {
			if (payload && payload.kind === 'snapshot') {
				this.fromJson(payload.snapshot);
			}
		}));
		this.push();
	}

	push(): void {
		if (!this._channel) {
			return;
		}
		this._lastPushedAt = Date.now();
		this._channel.fire({ kind: 'snapshot', snapshot: this.toJson() });
	}

	pushThrottled(minIntervalMs = 250): void {
		if (!this._channel) {
			return;
		}
		const now = Date.now();
		if (now - this._lastPushedAt < minIntervalMs) {
			return;
		}
		this.push();
	}

	private _touch(): void {
		this._snapshot.timestamp = Date.now();
		this._onDidChange.fire();
		if (this._channel) {
			this.pushThrottled();
		}
	}
}
