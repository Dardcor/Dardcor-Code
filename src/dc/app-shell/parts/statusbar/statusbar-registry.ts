/**
 * Dardcor Code - Status Bar Item Contribution Locator
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';

export const enum StatusbarAlignment {
	LEFT = 0,
	RIGHT = 1,
}

export interface IStatusbarEntry {
	readonly id: string;
	readonly alignment: StatusbarAlignment;
	text: string;
	tooltip?: string;
	commandId?: string;
	color?: string;
	priority?: number;
}

export class StatusbarRegistry extends Disposable {
	private readonly _entries = new Map<string, IStatusbarEntry>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	register(entry: IStatusbarEntry): IDisposable {
		this._entries.set(entry.id, { ...entry, priority: entry.priority ?? 0 });
		this._onDidChange.fire();
		return {
			dispose: () => {
				this._entries.delete(entry.id);
				this._onDidChange.fire();
			}
		};
	}

	unregister(id: string): void {
		if (this._entries.delete(id)) {
			this._onDidChange.fire();
		}
	}

	getEntry(id: string): IStatusbarEntry | undefined {
		return this._entries.get(id);
	}

	getEntries(alignment?: StatusbarAlignment): IStatusbarEntry[] {
		const entries = Array.from(this._entries.values());
		const filtered = alignment === undefined ? entries : entries.filter(e => e.alignment === alignment);
		return filtered.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
	}

	static readonly instance = new StatusbarRegistry();
}
