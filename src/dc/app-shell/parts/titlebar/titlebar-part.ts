/**
 * Dardcor Code - Custom Window Titlebar With Drag Region & Menu Bar
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $ } from '../../../core/dom/element.js';
import { MenubarPart } from '../menubar/menubar-part.js';

export type WindowControlAction = 'minimize' | 'maximize' | 'close';

function setAppRegion(el: HTMLElement, region: 'drag' | 'no-drag'): void {
	(el.style as unknown as { webkitAppRegion: string }).webkitAppRegion = region;
}

export class TitlebarPart extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _menubarPart: MenubarPart;
	private readonly _titleEl: HTMLElement;
	private readonly _windowControls: HTMLElement;
	private readonly _onDidClickWindowControl = this._register(new Emitter<WindowControlAction>());
	readonly onDidClickWindowControl: Event<WindowControlAction> = this._onDidClickWindowControl.event;

	constructor(container: HTMLElement) {
		super();
		this._container = container;
		container.style.cssText = 'height:32px;background:#323233;display:flex;align-items:center;padding:0 8px;font-size:12px;user-select:none;border-bottom:1px solid #2b2b2b;flex-shrink:0;';
		setAppRegion(container, 'drag');

		const logo = $<HTMLElement>('div', 'dc-titlebar-logo');
		logo.textContent = '\u2731';
		logo.style.cssText = 'width:20px;height:20px;border-radius:4px;background:#007acc;color:#ffffff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;margin-right:8px;flex-shrink:0;';
		container.appendChild(logo);

		this._menubarPart = new MenubarPart(container);
		this._register(this._menubarPart);

		this._titleEl = $<HTMLElement>('div', 'dc-titlebar-title');
		this._titleEl.textContent = 'Dardcor Code';
		this._titleEl.style.cssText = 'flex:1;text-align:center;color:#bbbbbb;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;';
		container.appendChild(this._titleEl);

		this._windowControls = $<HTMLElement>('div', 'dc-titlebar-window-controls');
		this._windowControls.style.cssText = 'display:flex;align-items:center;margin-left:auto;flex-shrink:0;';
		setAppRegion(this._windowControls, 'no-drag');
		const controls: { icon: string; title: string; action: WindowControlAction; hover?: string }[] = [
			{ icon: '\u2013', title: 'Minimize', action: 'minimize' },
			{ icon: '\u25a1', title: 'Maximize', action: 'maximize' },
			{ icon: '\u2715', title: 'Close', action: 'close', hover: '#e81123' },
		];
		for (const control of controls) {
			const btn = $<HTMLElement>('div', 'dc-titlebar-window-control');
			btn.textContent = control.icon;
			btn.title = control.title;
			btn.style.cssText = 'width:40px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;color:#cccccc;';
			btn.addEventListener('mouseenter', () => {
				btn.style.background = control.hover ?? '#4a4a4a';
			});
			btn.addEventListener('mouseleave', () => {
				btn.style.background = 'transparent';
			});
			btn.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this._onDidClickWindowControl.fire(control.action);
			});
			this._windowControls.appendChild(btn);
		}
		container.appendChild(this._windowControls);
	}

	get menubarPart(): MenubarPart {
		return this._menubarPart;
	}

	get element(): HTMLElement {
		return this._container;
	}

	setTitle(title: string): void {
		this._titleEl.textContent = title;
	}

	setMenubarVisible(visible: boolean): void {
		this._menubarPart.setVisible(visible);
	}

	dispose(): void {
		setAppRegion(this._container, 'no-drag');
		super.dispose();
	}
}
