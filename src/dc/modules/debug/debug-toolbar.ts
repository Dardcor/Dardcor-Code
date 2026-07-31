/**
 * Dardcor Code - Floating Debug Controls Bar
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { DebugSession, DebugState } from './debug-session.js';

export interface IDebugToolbarButton {
	readonly id: string;
	readonly label: string;
	readonly title: string;
	readonly enabled: boolean;
	readonly onClick: () => void;
}

export class DebugToolbar extends Disposable {
	private readonly _onDidClickButton = this._register(new Emitter<string>());
	readonly onDidClickButton: Event<string> = this._onDidClickButton.event;

	private readonly _container: HTMLElement;
	private readonly _buttons = new Map<string, HTMLButtonElement>();

	constructor(parentDom: HTMLElement, private readonly _session: DebugSession) {
		super();
		this._container = $<HTMLElement>('div', 'dc-debug-toolbar');
		this._container.style.cssText = 'position:fixed;z-index:5000;display:flex;gap:2px;padding:4px 8px;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
		parentDom.appendChild(this._container);
		this._renderButtons();
		this._register(this._session.onDidChangeState(() => this._updateState()));
		this._updateState();
	}

	public show(x: number, y: number): void {
		this._container.style.display = 'flex';
		this._container.style.left = `${x}px`;
		this._container.style.top = `${y}px`;
	}

	public hide(): void {
		this._container.style.display = 'none';
	}

	private _addButton(id: string, label: string, title: string, onClick: () => void): void {
		const button = $<HTMLButtonElement>('button', `dc-debug-${id}`);
		button.textContent = label;
		button.title = title;
		button.style.cssText = 'background:transparent;border:none;color:#cccccc;font-size:16px;width:28px;height:28px;border-radius:3px;cursor:pointer;';
		button.addEventListener('mouseenter', () => {
			button.style.background = '#2a2d2e';
		});
		button.addEventListener('mouseleave', () => {
			button.style.background = 'transparent';
		});
		this._register(addDisposableListener(button, 'click', () => {
			this._onDidClickButton.fire(id);
			onClick();
		}));
		this._container.appendChild(button);
		this._buttons.set(id, button);
	}

	private _renderButtons(): void {
		this._addButton('continue', '\u25B6', 'Continue (F5)', () => {
			void this._session.continue();
		});
		this._addButton('step-over', '\u21E3', 'Step Over (F10)', () => {
			void this._session.next();
		});
		this._addButton('step-into', '\u2937', 'Step Into (F11)', () => {
			void this._session.stepIn();
		});
		this._addButton('step-out', '\u2935', 'Step Out (Shift+F11)', () => {
			void this._session.stepOut();
		});
		this._addButton('restart', '\u21BB', 'Restart', () => {
			void this._session.restart();
		});
		this._addButton('stop', '\u25A0', 'Stop', () => {
			void this._session.stop();
		});
	}

	private _updateState(): void {
		const state = this._session.state;
		const isActive = state === DebugState.Running || state === DebugState.Stopped || state === DebugState.Paused || state === DebugState.Initializing;
		const isStopped = state === DebugState.Stopped || state === DebugState.Paused;

		this._setEnabled('continue', isStopped);
		this._setEnabled('step-over', isStopped);
		this._setEnabled('step-into', isStopped);
		this._setEnabled('step-out', isStopped);
		this._setEnabled('restart', isActive);
		this._setEnabled('stop', isActive);
	}

	private _setEnabled(id: string, enabled: boolean): void {
		const button = this._buttons.get(id);
		if (!button) {
			return;
		}
		button.disabled = !enabled;
		button.style.opacity = enabled ? '1' : '0.4';
		button.style.cursor = enabled ? 'pointer' : 'default';
	}

	public clear(): void {
		clearNode(this._container);
		this._buttons.clear();
	}
}
