import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostStatusBar {
	private _nextId = 1;

	createStatusBarItem(idOrAlignment?: string | number, alignmentOrPriority?: number | number, priority?: number): any {
		const id = typeof idOrAlignment === 'string' ? idOrAlignment : `statusbar-${this._nextId++}`;
		const alignment = typeof idOrAlignment === 'number' ? idOrAlignment : alignmentOrPriority || 1; // 1 = Left, 2 = Right
		const prio = typeof alignmentOrPriority === 'number' && typeof idOrAlignment === 'string' ? alignmentOrPriority : priority || 0;

		return {
			id,
			alignment,
			priority: prio,
			text: '',
			tooltip: undefined,
			color: undefined,
			backgroundColor: undefined,
			command: undefined,
			accessibilityInformation: undefined,
			name: undefined,
			show: () => {
				console.log(`Showing StatusBarItem ${id}`);
			},
			hide: () => {
				console.log(`Hiding StatusBarItem ${id}`);
			},
			dispose: () => {
				console.log(`Disposing StatusBarItem ${id}`);
			}
		};
	}
}
