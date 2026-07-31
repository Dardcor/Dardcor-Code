import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { $ } from '../../core/dom/element';

export interface IReconnectDialogOptions {
	readonly title?: string;
	readonly retryLabel?: string;
	readonly cancelLabel?: string;
}

export const DEFAULT_DIALOG_TITLE = 'Connection Lost';
export const DEFAULT_RETRY_LABEL = 'Retry Now';
export const DEFAULT_CANCEL_LABEL = 'Cancel';

export function formatAttemptLabel(attempt: number, maxAttempts: number): string {
	if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
		return `Attempt ${attempt}`;
	}
	return `Attempt ${attempt} of ${maxAttempts}`;
}

export class ReconnectDialogWidget extends Disposable {
	private _element: HTMLElement | null = null;
	private _overlay: HTMLElement | null = null;
	private _messageEl: HTMLElement | null = null;
	private _attemptEl: HTMLElement | null = null;
	private _retryButton: HTMLButtonElement | null = null;
	private _cancelButton: HTMLButtonElement | null = null;
	private _visible = false;

	private readonly _onRetry = this._register(new Emitter<void>());
	readonly onRetry: Event<void> = this._onRetry.event;

	private readonly _onCancel = this._register(new Emitter<void>());
	readonly onCancel: Event<void> = this._onCancel.event;

	constructor(private readonly _options: IReconnectDialogOptions = {}) {
		super();
	}

	get isVisible(): boolean {
		return this._visible;
	}

	create(container: HTMLElement): HTMLElement {
		if (this._element) {
			return this._element;
		}
		if (typeof document === 'undefined') {
			throw new Error('ReconnectDialogWidget requires a DOM environment');
		}
		const overlay = $<HTMLElement>('div', 'dc-reconnect-overlay');
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:10000;';
		const dialog = ReconnectDialogWidget.buildElement();
		overlay.appendChild(dialog);
		container.appendChild(overlay);
		this._overlay = overlay;
		this._element = dialog;
		this._messageEl = dialog.querySelector<HTMLElement>('.dc-reconnect-message');
		this._attemptEl = dialog.querySelector<HTMLElement>('.dc-reconnect-attempt');
		this._retryButton = dialog.querySelector<HTMLButtonElement>('.dc-reconnect-retry');
		this._cancelButton = dialog.querySelector<HTMLButtonElement>('.dc-reconnect-cancel');
		this._retryButton?.addEventListener('click', () => {
			this._onRetry.fire();
		});
		this._cancelButton?.addEventListener('click', () => {
			this._onCancel.fire();
		});
		overlay.addEventListener('click', event => {
			if (event.target === overlay) {
				this._onCancel.fire();
			}
		});
		this._applyOptions();
		return dialog;
	}

	show(attempt: number, maxAttempts: number): void {
		this.create(document.body);
		if (!this._overlay) {
			return;
		}
		if (this._attemptEl) {
			this._attemptEl.textContent = formatAttemptLabel(attempt, maxAttempts);
		}
		this._overlay.style.display = 'flex';
		this._visible = true;
	}

	hide(): void {
		if (this._overlay) {
			this._overlay.style.display = 'none';
		}
		this._visible = false;
	}

	setMessage(text: string): void {
		if (this._messageEl) {
			this._messageEl.textContent = text;
		}
	}

	setAttempt(attempt: number, maxAttempts: number): void {
		if (this._attemptEl) {
			this._attemptEl.textContent = formatAttemptLabel(attempt, maxAttempts);
		}
	}

	showWithMessage(attempt: number, maxAttempts: number, message: string): void {
		this.show(attempt, maxAttempts);
		this.setMessage(message);
	}

	updateOptions(options: IReconnectDialogOptions): void {
		(this._options as any).title = options.title ?? this._options.title;
		(this._options as any).retryLabel = options.retryLabel ?? this._options.retryLabel;
		(this._options as any).cancelLabel = options.cancelLabel ?? this._options.cancelLabel;
		if (this._element) {
			this._applyOptions();
		}
	}

	static buildElement(): HTMLElement {
		if (typeof document === 'undefined') {
			throw new Error('buildElement requires a DOM environment');
		}
		const dialog = $<HTMLElement>('div', 'dc-reconnect-dialog');
		dialog.style.cssText = 'background:#252526;border:1px solid #3c3c3c;border-radius:6px;padding:24px 28px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:system-ui, sans-serif;color:#d4d4d4;';
		const title = $<HTMLElement>('div', 'dc-reconnect-title');
		title.style.cssText = 'font-size:16px;font-weight:600;margin-bottom:8px;';
		title.textContent = DEFAULT_DIALOG_TITLE;
		const message = $<HTMLElement>('div', 'dc-reconnect-message');
		message.style.cssText = 'font-size:13px;line-height:1.5;margin-bottom:12px;color:#a0a0a0;';
		message.textContent = 'The connection to the remote server was lost. Attempting to reconnect...';
		const attempt = $<HTMLElement>('div', 'dc-reconnect-attempt');
		attempt.style.cssText = 'font-size:12px;color:#007acc;margin-bottom:16px;';
		const actions = $<HTMLElement>('div', 'dc-reconnect-actions');
		actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';
		const cancel = $<HTMLButtonElement>('button', 'dc-reconnect-cancel');
		cancel.type = 'button';
		cancel.textContent = DEFAULT_CANCEL_LABEL;
		cancel.style.cssText = 'padding:6px 14px;border:1px solid #3c3c3c;border-radius:4px;background:transparent;color:#d4d4d4;cursor:pointer;font-size:13px;';
		const retry = $<HTMLButtonElement>('button', 'dc-reconnect-retry');
		retry.type = 'button';
		retry.textContent = DEFAULT_RETRY_LABEL;
		retry.style.cssText = 'padding:6px 14px;border:none;border-radius:4px;background:#007acc;color:#fff;cursor:pointer;font-size:13px;';
		actions.append(cancel, retry);
		dialog.append(title, message, attempt, actions);
		return dialog;
	}

	override dispose(): void {
		this._overlay?.remove();
		this._element = null;
		this._overlay = null;
		super.dispose();
	}

	private _applyOptions(): void {
		const dialog = this._element;
		if (!dialog) {
			return;
		}
		const title = dialog.querySelector<HTMLElement>('.dc-reconnect-title');
		if (title && this._options.title) {
			title.textContent = this._options.title;
		}
		if (this._retryButton && this._options.retryLabel) {
			this._retryButton.textContent = this._options.retryLabel;
		}
		if (this._cancelButton && this._options.cancelLabel) {
			this._cancelButton.textContent = this._options.cancelLabel;
		}
	}
}
