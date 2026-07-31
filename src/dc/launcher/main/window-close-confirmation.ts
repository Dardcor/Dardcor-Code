import { BrowserWindow, dialog } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';

export type CloseChoice = 'save' | 'discard' | 'cancel';

export interface CloseConfirmationResult {
	choice: CloseChoice;
	checked: boolean;
}

export interface WindowCloseConfirmationOptions {
	title?: string;
	saveButtonLabel?: string;
	discardButtonLabel?: string;
	cancelButtonLabel?: string;
	detail?: (count: number) => string;
}

export class WindowCloseConfirmation extends Disposable {
	private _hasUnsaved: () => boolean = () => false;
	private readonly _options: WindowCloseConfirmationOptions;
	private readonly _confirmations = new Set<BrowserWindow>();

	constructor(options: WindowCloseConfirmationOptions = {}) {
		super();
		this._options = options;
	}

	public setHasUnsavedCallback(cb: () => boolean): void {
		this._hasUnsaved = cb;
	}

	public setHasUnsavedState(hasUnsaved: boolean): void {
		this._hasUnsaved = () => hasUnsaved;
	}

	public hasUnsaved(): boolean {
		return this._hasUnsaved();
	}

	public async confirmClose(window: BrowserWindow): Promise<CloseConfirmationResult> {
		if (!this._hasUnsaved()) {
			return { choice: 'discard', checked: false };
		}
		const result = await dialog.showMessageBox(window, {
			type: 'warning',
			title: this._options.title ?? 'Dardcor Code',
			message: 'Do you want to save the changes you made?',
			detail: this._options.detail?.(1) ?? 'Your changes will be lost if you don\'t save them.',
			buttons: [
				this._options.saveButtonLabel ?? 'Save',
				this._options.discardButtonLabel ?? 'Don\'t Save',
				this._options.cancelButtonLabel ?? 'Cancel'
			],
			defaultId: 0,
			cancelId: 2,
			noLink: true
		});
		const choice: CloseChoice = result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel';
		return { choice, checked: result.checkboxChecked };
	}

	public gateClose(window: BrowserWindow, onSave: () => void, onDiscard?: () => void): void {
		if (this._confirmations.has(window)) {
			return;
		}
		this._confirmations.add(window);
		const handler = (event: Electron.Event): void => {
			if (!this._hasUnsaved() || this._isForceClosing(window)) {
				return;
			}
			event.preventDefault();
			this._handleCloseRequest(window, event, onSave, onDiscard);
		};
		window.on('close', handler);
		this._register(toDisposable(() => {
			window.removeListener('close', handler);
			this._confirmations.delete(window);
		}));
	}

	public ungateClose(window: BrowserWindow): void {
		window.removeAllListeners('close');
		this._confirmations.delete(window);
	}

	public forceClose(window: BrowserWindow): void {
		this._markForceClosing(window);
		window.close();
	}

	public closeAll(onSave: (window: BrowserWindow) => void = () => {}): void {
		for (const window of BrowserWindow.getAllWindows()) {
			if (this._hasUnsaved()) {
				onSave(window);
			}
			this.forceClose(window);
		}
	}

	public override dispose(): void {
		this._confirmations.clear();
		super.dispose();
	}

	private async _handleCloseRequest(
		window: BrowserWindow,
		event: Electron.Event,
		onSave: () => void,
		onDiscard?: () => void
	): Promise<void> {
		if (!this._hasUnsaved()) {
			return;
		}
		window.setEnabled(false);
		try {
			const result = await this.confirmClose(window);
			if (result.choice === 'cancel') {
				this._markForceClosing(window);
				this._cancelClose(window);
				return;
			}
			if (result.choice === 'save') {
				onSave();
				if (this._hasUnsaved()) {
					this._cancelClose(window);
					return;
				}
			}
			this._markForceClosing(window);
			onDiscard?.();
			window.close();
		} finally {
			if (!window.isDestroyed()) {
				window.setEnabled(true);
			}
		}
	}

	private _cancelClose(window: BrowserWindow): void {
		if (window.isDestroyed()) {
			return;
		}
		window.setEnabled(true);
		window.focus();
	}

	private _forceClosing = new WeakSet<BrowserWindow>();

	private _isForceClosing(window: BrowserWindow): boolean {
		return this._forceClosing.has(window);
	}

	private _markForceClosing(window: BrowserWindow): void {
		this._forceClosing.add(window);
	}
}

export function createWindowCloseConfirmation(options?: WindowCloseConfirmationOptions): WindowCloseConfirmation {
	return new WindowCloseConfirmation(options);
}
