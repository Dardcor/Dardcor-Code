import { Emitter, Event } from '../../core/events/emitter';

export interface ITerminalSelection {
	readonly startLine: number;
	readonly startColumn: number;
	readonly endLine: number;
	readonly endColumn: number;
	readonly text?: string;
}

export function isClipboardAvailable(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.clipboard !== 'undefined';
}

export function copyViaExecCommand(text: string): boolean {
	if (typeof document === 'undefined') {
		return false;
	}
	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.style.position = 'fixed';
	textarea.style.opacity = '0';
	textarea.style.pointerEvents = 'none';
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();
	let succeeded = false;
	try {
		succeeded = document.execCommand('copy');
	} catch {
		succeeded = false;
	}
	document.body.removeChild(textarea);
	return succeeded;
}

export class RemoteTerminalClipboard {
	private _lastSelection: ITerminalSelection | null = null;

	private readonly _onDidCopy = new Emitter<{ text: string; method: 'clipboard-api' | 'exec-command' | 'failed' }>();
	readonly onDidCopy: Event<{ text: string; method: 'clipboard-api' | 'exec-command' | 'failed' }> = this._onDidCopy.event;

	get lastSelection(): ITerminalSelection | null {
		return this._lastSelection ? { ...this._lastSelection } : null;
	}

	async copy(termData: string): Promise<'clipboard-api' | 'exec-command' | 'failed'> {
		if (isClipboardAvailable()) {
			try {
				await navigator.clipboard.writeText(termData);
				this._onDidCopy.fire({ text: termData, method: 'clipboard-api' });
				return 'clipboard-api';
			} catch {
				// fall through to execCommand
			}
		}
		if (copyViaExecCommand(termData)) {
			this._onDidCopy.fire({ text: termData, method: 'exec-command' });
			return 'exec-command';
		}
		this._onDidCopy.fire({ text: termData, method: 'failed' });
		return 'failed';
	}

	async paste(): Promise<string> {
		if (isClipboardAvailable()) {
			try {
				return await navigator.clipboard.readText();
			} catch {
				return '';
			}
		}
		return this._pasteViaExecCommand();
	}

	syncSelection(selection: ITerminalSelection | null): void {
		if (selection === null) {
			this._lastSelection = null;
			return;
		}
		this._lastSelection = {
			startLine: selection.startLine,
			startColumn: selection.startColumn,
			endLine: selection.endLine,
			endColumn: selection.endColumn,
			text: selection.text
		};
	}

	hasSelection(): boolean {
		return this._lastSelection !== null;
	}

	clearSelection(): void {
		this._lastSelection = null;
	}

	isSelectionEmpty(): boolean {
		if (!this._lastSelection) {
			return true;
		}
		const { startLine, startColumn, endLine, endColumn } = this._lastSelection;
		return startLine === endLine && startColumn === endColumn;
	}

	getSelectedText(): string | null {
		return this._lastSelection?.text ?? null;
	}

	private _pasteViaExecCommand(): string {
		if (typeof document === 'undefined') {
			return '';
		}
		const textarea = document.createElement('textarea');
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.focus();
		let result = '';
		try {
			if (document.execCommand('paste')) {
				result = textarea.value;
			}
		} catch {
			result = '';
		}
		document.body.removeChild(textarea);
		return result;
	}
}
