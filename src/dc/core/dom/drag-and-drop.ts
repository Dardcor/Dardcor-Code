/**
 * Dardcor Code - Drag and Drop Helper Utilities
 */

import { addDisposableListener } from './element.js';
import { IDisposable } from '../lifecycle/disposable.js';

export interface IDragAndDropCallbacks {
	onDragStart?: (e: DragEvent) => void;
	onDragOver?: (e: DragEvent) => void;
	onDragLeave?: (e: DragEvent) => void;
	onDrop?: (e: DragEvent) => void;
}

export function setupDragAndDrop(element: HTMLElement, callbacks: IDragAndDropCallbacks): IDisposable {
	const disposables: IDisposable[] = [];

	if (callbacks.onDragStart) {
		disposables.push(addDisposableListener(element, 'dragstart', e => callbacks.onDragStart!(e as DragEvent)));
	}
	if (callbacks.onDragOver) {
		disposables.push(addDisposableListener(element, 'dragover', e => {
			e.preventDefault();
			callbacks.onDragOver!(e as DragEvent);
		}));
	}
	if (callbacks.onDragLeave) {
		disposables.push(addDisposableListener(element, 'dragleave', e => callbacks.onDragLeave!(e as DragEvent)));
	}
	if (callbacks.onDrop) {
		disposables.push(addDisposableListener(element, 'drop', e => {
			e.preventDefault();
			callbacks.onDrop!(e as DragEvent);
		}));
	}

	return {
		dispose() {
			for (const d of disposables) {
				d.dispose();
			}
		}
	};
}
