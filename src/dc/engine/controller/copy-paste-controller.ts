import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $ } from '../../core/dom/element.js';
import { ITextModel } from '../model/text-model.js';
import { Selection } from '../model/selection.js';

export class CopyPasteController extends Disposable {
	private readonly _onDidPaste = this._register(new Emitter<string>());
	readonly onDidPaste: Event<string> = this._onDidPaste.event;

	private readonly _onDidCut = this._register(new Emitter<string>());
	readonly onDidCut: Event<string> = this._onDidCut.event;

	private readonly _onDidCopy = this._register(new Emitter<string>());
	readonly onDidCopy: Event<string> = this._onDidCopy.event;

	public copy(text: string): void {
		this._writeClipboard(text);
		this._onDidCopy.fire(text);
	}

	public cut(text: string): void {
		this._writeClipboard(text);
		this._onDidCut.fire(text);
	}

	public paste(text: string): void {
		this._onDidPaste.fire(text);
	}

	public getTextToCopy(selections: readonly Selection[], model: ITextModel): string {
		const parts: string[] = [];
		for (const selection of selections) {
			parts.push(this._getTextInRange(model, selection.start, selection.end));
		}
		return parts.join('\n');
	}

	public async readClipboard(): Promise<string> {
		try {
			if (navigator.clipboard && navigator.clipboard.readText) {
				return await navigator.clipboard.readText();
			}
		} catch {
			return '';
		}
		return '';
	}

	public supportsClipboardRead(): boolean {
		return !!(navigator.clipboard && navigator.clipboard.readText);
	}

	public supportsClipboardWrite(): boolean {
		return !!(navigator.clipboard && navigator.clipboard.writeText) || typeof document.execCommand === 'function';
	}

	public copySelections(model: ITextModel, selections: readonly Selection[]): string {
		const text = this.getTextToCopy(selections, model);
		this.copy(text);
		return text;
	}

	public cutSelections(model: ITextModel, selections: readonly Selection[]): string {
		const text = this.getTextToCopy(selections, model);
		this.cut(text);
		return text;
	}

	public getTextInRange(model: ITextModel, start: { lineNumber: number; column: number }, end: { lineNumber: number; column: number }): string {
		const lines = model.getValue().split('\n');
		if (start.lineNumber === end.lineNumber) {
			const line = lines[start.lineNumber - 1] ?? '';
			return line.substring(start.column - 1, end.column - 1);
		}
		const parts: string[] = [];
		for (let line = start.lineNumber; line <= end.lineNumber; line++) {
			const content = lines[line - 1] ?? '';
			if (line === start.lineNumber) {
				parts.push(content.substring(start.column - 1));
			} else if (line === end.lineNumber) {
				parts.push(content.substring(0, end.column - 1));
			} else {
				parts.push(content);
			}
		}
		return parts.join('\n');
	}

	private _writeClipboard(text: string): void {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).catch(() => this._fallbackWrite(text));
		} else {
			this._fallbackWrite(text);
		}
	}

	private _fallbackWrite(text: string): void {
		const helper = $<HTMLTextAreaElement>('textarea');
		helper.value = text;
		helper.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
		document.body.appendChild(helper);
		helper.focus();
		helper.select();
		try {
			document.execCommand('copy');
		} catch {
			// clipboard write failed
		}
		document.body.removeChild(helper);
	}
}
