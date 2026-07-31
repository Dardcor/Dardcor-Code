/**
 * Dardcor Code - Panel Maximize & Position Command Actions
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';
import { CommandRegistry } from '../../../services/commands/command-service';

export type PanelPosition = 'bottom' | 'right' | 'left';

export interface IPanelActionBarEvent {
	readonly id: string;
}

export interface IPanelActionSpec {
	readonly id: string;
	readonly icon: string;
	readonly title: string;
}

const MAXIMIZE_ICON = '\u25b2';
const RESTORE_ICON = '\u25bc';
const MOVE_RIGHT_ICON = '\u21e8';
const MOVE_BOTTOM_ICON = '\u21e9';
const CLOSE_ICON = '\u2715';

export class PanelActionBar extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _buttons = new Map<string, HTMLElement>();
	private _maximized = false;
	private _position: PanelPosition = 'bottom';

	private readonly _onDidAction = this._register(new Emitter<string>());
	readonly onDidAction: Event<string> = this._onDidAction.event;

	constructor(
		parent: HTMLElement,
		private readonly _options: { maximize?: boolean; position?: boolean; close?: boolean } = {}
	) {
		super();
		this._container = $<HTMLElement>('div', 'dc-panel-actions');
		this._container.style.cssText = 'display:flex;align-items:center;gap:2px;margin-left:auto;';
		parent.appendChild(this._container);
		this._build();
	}

	get element(): HTMLElement {
		return this._container;
	}

	get isMaximized(): boolean {
		return this._maximized;
	}

	get position(): PanelPosition {
		return this._position;
	}

	setMaximized(maximized: boolean): void {
		this._maximized = maximized;
		const btn = this._buttons.get('toggleMaximized');
		if (btn) {
			btn.textContent = maximized ? RESTORE_ICON : MAXIMIZE_ICON;
			btn.title = maximized ? 'Restore Panel' : 'Maximize Panel';
		}
	}

	setPosition(position: PanelPosition): void {
		this._position = position;
		const btn = this._buttons.get('movePosition');
		if (btn) {
			if (position === 'bottom') {
				btn.textContent = MOVE_RIGHT_ICON;
				btn.title = 'Move Panel To Right';
			} else if (position === 'right') {
				btn.textContent = MOVE_BOTTOM_ICON;
				btn.title = 'Move Panel To Bottom';
			} else {
				btn.textContent = MOVE_BOTTOM_ICON;
				btn.title = 'Move Panel To Bottom';
			}
		}
	}

	setVisible(visible: boolean): void {
		this._container.style.display = visible ? 'flex' : 'none';
	}

	private _build(): void {
		const specs: IPanelActionSpec[] = [];
		if (this._options.maximize !== false) {
			specs.push({ id: 'toggleMaximized', icon: MAXIMIZE_ICON, title: 'Maximize Panel' });
		}
		if (this._options.position !== false) {
			specs.push({ id: 'movePosition', icon: MOVE_RIGHT_ICON, title: 'Move Panel To Right' });
		}
		if (this._options.close !== false) {
			specs.push({ id: 'closePanel', icon: CLOSE_ICON, title: 'Close Panel' });
		}
		for (const spec of specs) {
			const btn = $<HTMLElement>('span', 'dc-panel-action');
			btn.textContent = spec.icon;
			btn.title = spec.title;
			btn.style.cssText = 'cursor:pointer;color:#858585;font-size:11px;padding:3px 5px;border-radius:3px;';
			btn.addEventListener('mouseenter', () => {
				btn.style.background = '#3c3c3c';
			});
			btn.addEventListener('mouseleave', () => {
				btn.style.background = 'transparent';
			});
			btn.addEventListener('click', () => this._onDidAction.fire(spec.id));
			this._buttons.set(spec.id, btn);
			this._container.appendChild(btn);
		}
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}

export namespace PanelActionCommands {
	const _onDidInvoke = new Emitter<string>();
	export const onDidInvoke: Event<string> = _onDidInvoke.event;

	export function register(): { dispose(): void }[] {
		const disposables = [
			CommandRegistry.registerCommand({
				id: 'workbench.action.toggleMaximizedPanel',
				handler: () => _onDidInvoke.fire('toggleMaximized'),
			}),
			CommandRegistry.registerCommand({
				id: 'workbench.action.togglePanelPosition',
				handler: () => _onDidInvoke.fire('movePosition'),
			}),
			CommandRegistry.registerCommand({
				id: 'workbench.action.closePanel',
				handler: () => _onDidInvoke.fire('closePanel'),
			}),
		];
		return disposables;
	}
}
