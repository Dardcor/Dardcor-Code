/**
 * Dardcor Code - Bottom Panel Navigation Tab Bar
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';
import { IPanelDescriptor } from './panel-registry';

export class PanelTabBar extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _tabs = new Map<string, HTMLElement>();
	private readonly _actionsContainer: HTMLElement;
	private _activeId: string | null = null;

	private readonly _onDidSelectPanel = this._register(new Emitter<IPanelDescriptor>());
	private readonly _onDidMaximize = this._register(new Emitter<void>());
	private readonly _onDidClosePanel = this._register(new Emitter<void>());

	readonly onDidSelectPanel: Event<IPanelDescriptor> = this._onDidSelectPanel.event;
	readonly onDidMaximize: Event<void> = this._onDidMaximize.event;
	readonly onDidClosePanel: Event<void> = this._onDidClosePanel.event;

	constructor(parent: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-panel-tab-bar');
		this._container.style.cssText = 'height:35px;background:#252526;display:flex;align-items:center;padding:0 8px;gap:2px;flex-shrink:0;border-bottom:1px solid #1e1e1e;user-select:none;';
		this._actionsContainer = $<HTMLElement>('div', 'dc-panel-tab-actions');
		this._actionsContainer.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:4px;';
		parent.appendChild(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}

	render(descriptors: IPanelDescriptor[], activeId: string | null): void {
		clearNode(this._container);
		this._tabs.clear();
		for (const descriptor of descriptors) {
			const tab = $<HTMLElement>('div', 'dc-panel-tab');
			tab.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 10px;height:100%;cursor:pointer;font-size:11px;font-weight:600;letter-spacing:0.5px;color:#858585;border-bottom:2px solid transparent;box-sizing:border-box;';
			const icon = $<HTMLElement>('span', 'dc-panel-tab-icon');
			icon.textContent = descriptor.icon;
			icon.style.cssText = 'font-size:13px;';
			const label = $<HTMLElement>('span', 'dc-panel-tab-label');
			label.textContent = descriptor.title.toUpperCase();
			tab.appendChild(icon);
			tab.appendChild(label);
			tab.addEventListener('click', () => this._onDidSelectPanel.fire(descriptor));
			this._tabs.set(descriptor.id, tab);
			this._container.appendChild(tab);
		}
		this._renderActions();
		this.setActive(activeId);
	}

	setActive(id: string | null): void {
		this._activeId = id;
		for (const [tabId, tab] of this._tabs) {
			const isActive = tabId === id;
			tab.style.color = isActive ? '#ffffff' : '#858585';
			tab.style.borderBottomColor = isActive ? '#007acc' : 'transparent';
		}
	}

	get activeId(): string | null {
		return this._activeId;
	}

	private _renderActions(): void {
		const actions: { icon: string; title: string; onClick: () => void }[] = [
			{ icon: '\u25b2', title: 'Maximize Panel', onClick: () => this._onDidMaximize.fire() },
			{ icon: '\u2715', title: 'Close Panel', onClick: () => this._onDidClosePanel.fire() },
		];
		for (const action of actions) {
			const btn = $<HTMLElement>('span', 'dc-panel-tab-action');
			btn.textContent = action.icon;
			btn.title = action.title;
			btn.style.cssText = 'cursor:pointer;color:#858585;font-size:11px;padding:3px 5px;border-radius:3px;';
			btn.addEventListener('click', () => action.onClick());
			this._actionsContainer.appendChild(btn);
		}
		this._container.appendChild(this._actionsContainer);
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}
