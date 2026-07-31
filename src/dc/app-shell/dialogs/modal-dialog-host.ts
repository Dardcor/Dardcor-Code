/**
 * Dardcor Code - Custom DOM Modal Overlay Manager
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $ } from '../../core/dom/element';

export interface IModalDialogHostOptions {
	clickOutsideToClose?: boolean;
	escapeToClose?: boolean;
	title?: string;
}

export class ModalDialogHost extends Disposable {
	private readonly _overlay: HTMLElement;
	private readonly _dialogFrame: HTMLElement;
	private _content: HTMLElement | null = null;
	private _options: IModalDialogHostOptions = {};
	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	constructor(private readonly _parent: HTMLElement = document.body) {
		super();
		this._overlay = $<HTMLElement>('div', 'dc-modal-overlay');
		this._overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:none;align-items:center;justify-content:center;z-index:2000;';
		this._dialogFrame = $<HTMLElement>('div', 'dc-modal-dialog');
		this._dialogFrame.style.cssText = 'background:#252526;border:1px solid #454545;box-shadow:0 8px 24px rgba(0,0,0,0.5);display:flex;flex-direction:column;max-width:90vw;max-height:90vh;overflow:hidden;';
		this._overlay.appendChild(this._dialogFrame);
		this._parent.appendChild(this._overlay);

		this._overlay.addEventListener('mousedown', (e: MouseEvent) => {
			if (e.target === this._overlay && this._options.clickOutsideToClose !== false) {
				this.close();
			}
		});
		this._overlay.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape' && this._options.escapeToClose !== false) {
				e.stopPropagation();
				this.close();
			}
		});
	}

	get isOpen(): boolean {
		return this._overlay.style.display !== 'none';
	}

	open(content: HTMLElement, options: IModalDialogHostOptions = {}): void {
		this._options = options;
		if (this._content && this._content !== content) {
			this._content.remove();
		}
		this._content = content;
		this._dialogFrame.textContent = '';
		if (options.title) {
			const title = $<HTMLElement>('div', 'dc-modal-dialog-title');
			title.textContent = options.title;
			title.style.cssText = 'padding:10px 14px;font-size:13px;font-weight:600;color:#cccccc;border-bottom:1px solid #333333;';
			this._dialogFrame.appendChild(title);
		}
		this._dialogFrame.appendChild(content);
		this._overlay.style.display = 'flex';
		content.style.display = '';
	}

	close(): void {
		if (!this.isOpen) {
			return;
		}
		this._overlay.style.display = 'none';
		if (this._content) {
			this._content.remove();
			this._content = null;
		}
		this._onDidClose.fire();
	}

	get content(): HTMLElement | null {
		return this._content;
	}

	dispose(): void {
		this._overlay.remove();
		super.dispose();
	}
}
