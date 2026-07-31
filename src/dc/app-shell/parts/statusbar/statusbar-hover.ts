/**
 * Dardcor Code - Tooltip Details Popover For Status Bar Items
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';

export interface IStatusbarHoverContent {
	readonly title: string;
	readonly description?: string;
	readonly commandLabel?: string;
	readonly extraLines?: string[];
}

export interface IStatusbarHoverOptions {
	readonly delay?: number;
	readonly maxWidth?: number;
	readonly showCommandHint?: boolean;
}

export class StatusbarHover extends Disposable {
	private readonly _popover: HTMLElement;
	private _showTimer: ReturnType<typeof setTimeout> | null = null;
	private _target: HTMLElement | null = null;
	private _visible = false;
	private readonly _delay: number;
	private readonly _maxWidth: number;

	private readonly _onDidHide = this._register(new Emitter<void>());
	readonly onDidHide: Event<void> = this._onDidHide.event;

	constructor(
		options: IStatusbarHoverOptions = {}
	) {
		super();
		this._delay = options.delay ?? 300;
		this._maxWidth = options.maxWidth ?? 280;

		this._popover = $<HTMLElement>('div', 'dc-statusbar-hover');
		this._popover.style.cssText = 'position:fixed;z-index:2200;display:none;background:#252526;border:1px solid #454545;box-shadow:0 6px 16px rgba(0,0,0,0.4);padding:10px 12px;font-family:Segoe UI, sans-serif;font-size:12px;color:#cccccc;pointer-events:none;';
		document.body.appendChild(this._popover);
	}

	get isVisible(): boolean {
		return this._visible;
	}

	attach(target: HTMLElement, content: IStatusbarHoverContent, options: IStatusbarHoverOptions = {}): void {
		const onEnter = () => this._scheduleShow(target, content, options);
		const onLeave = () => this._scheduleHide();
		target.addEventListener('mouseenter', onEnter);
		target.addEventListener('mouseleave', onLeave);
		target.addEventListener('mousedown', onLeave);
		this._register({
			dispose: () => {
				target.removeEventListener('mouseenter', onEnter);
				target.removeEventListener('mouseleave', onLeave);
				target.removeEventListener('mousedown', onLeave);
			}
		});
	}

	show(target: HTMLElement, content: IStatusbarHoverContent, options: IStatusbarHoverOptions = {}): void {
		if (this._showTimer) {
			clearTimeout(this._showTimer);
			this._showTimer = null;
		}
		this._render(content, options);
		this._position(target);
		this._popover.style.display = 'block';
		this._visible = true;
	}

	hide(): void {
		this._scheduleHide();
	}

	hideNow(): void {
		if (this._showTimer) {
			clearTimeout(this._showTimer);
			this._showTimer = null;
		}
		this._popover.style.display = 'none';
		if (this._visible) {
			this._visible = false;
			this._onDidHide.fire();
		}
	}

	private _scheduleShow(target: HTMLElement, content: IStatusbarHoverContent, options: IStatusbarHoverOptions): void {
		if (this._visible) {
			return;
		}
		if (this._showTimer) {
			clearTimeout(this._showTimer);
		}
		this._showTimer = setTimeout(() => {
			this._showTimer = null;
			this._target = target;
			this.show(target, content, options);
		}, options.delay ?? this._delay);
	}

	private _scheduleHide(): void {
		if (this._showTimer) {
			clearTimeout(this._showTimer);
			this._showTimer = null;
		}
		this.hideNow();
	}

	private _render(content: IStatusbarHoverContent, options: IStatusbarHoverOptions): void {
		clearNode(this._popover);

		const title = $<HTMLElement>('div', 'dc-statusbar-hover-title');
		title.textContent = content.title;
		title.style.cssText = 'font-weight:600;color:#ffffff;margin-bottom:4px;overflow-wrap:break-word;';
		this._popover.appendChild(title);

		if (content.description) {
			const desc = $<HTMLElement>('div', 'dc-statusbar-hover-description');
			desc.textContent = content.description;
			desc.style.cssText = 'color:#cccccc;line-height:1.4;margin-bottom:4px;overflow-wrap:break-word;';
			this._popover.appendChild(desc);
		}

		for (const line of content.extraLines ?? []) {
			const extra = $<HTMLElement>('div', 'dc-statusbar-hover-extra');
			extra.textContent = line;
			extra.style.cssText = 'color:#9d9d9d;line-height:1.4;';
			this._popover.appendChild(extra);
		}

		if (content.commandLabel && options.showCommandHint !== false) {
			const hint = $<HTMLElement>('div', 'dc-statusbar-hover-command');
			hint.textContent = content.commandLabel;
			hint.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid #3c3c3c;color:#858585;font-size:11px;';
			this._popover.appendChild(hint);
		}
		this._popover.style.maxWidth = `${options.maxWidth ?? this._maxWidth}px`;
	}

	private _position(target: HTMLElement): void {
		const rect = target.getBoundingClientRect();
		const popoverRect = this._popover.getBoundingClientRect();
		const statusbarHeight = 22;
		const margin = 6;
		let left = rect.left + rect.width / 2 - popoverRect.width / 2;
		left = Math.max(margin, Math.min(left, window.innerWidth - popoverRect.width - margin));
		const top = rect.top - statusbarHeight - popoverRect.height - margin;
		this._popover.style.left = `${left}px`;
		this._popover.style.top = `${Math.max(margin, top)}px`;
	}

	dispose(): void {
		this.hideNow();
		this._popover.remove();
		super.dispose();
	}
}

let _instance: StatusbarHover | null = null;

export function getStatusbarHover(): StatusbarHover {
	if (!_instance) {
		_instance = new StatusbarHover();
	}
	return _instance;
}
