/**
 * Dardcor Code - Keybinding Recorder & Capture Widget
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, addDisposableListener } from '../../core/dom/element';
import { isMacintosh } from '../../core/environment/platform';

export interface IKeybindingRecordResult {
	readonly chord: string[];
	readonly display: string;
	readonly cancelled: boolean;
}

export class KeybindingRecordWidget extends Disposable {
	private readonly _onDidRecord = this._register(new Emitter<IKeybindingRecordResult>());
	readonly onDidRecord: Event<IKeybindingRecordResult> = this._onDidRecord.event;

	private readonly _container: HTMLElement;
	private readonly _display: HTMLElement;
	private _recording = false;
	private _captured: string[] = [];
	private _downKeys = new Set<string>();
	private _lastKeyTime = 0;

	constructor(parentDom: HTMLElement) {
		super();

		this._container = $<HTMLElement>('div', 'dc-keybinding-record-widget');
		this._container.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px dashed #3c3c3c;border-radius:2px;background:#1e1e1e;user-select:none;';

		const label = $<HTMLElement>('span');
		label.textContent = 'Rekam';
		label.style.cssText = 'font-size:11px;color:#8a8a8a;';

		this._display = $<HTMLElement>('span');
		this._display.textContent = 'Klik "Mulai" lalu tekan kombinasi\u2026';
		this._display.style.cssText = 'font-size:13px;color:#cccccc;flex:1;font-family:Consolas,monospace;';

		const startBtn = $<HTMLButtonElement>('button');
		startBtn.textContent = 'Mulai';
		const clearBtn = $<HTMLButtonElement>('button');
		clearBtn.textContent = 'Bersihkan';
		for (const btn of [startBtn, clearBtn]) {
			btn.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;padding:3px 12px;font-size:12px;cursor:pointer;';
		}
		clearBtn.style.background = '#3c3c3c';

		this._container.appendChild(label);
		this._container.appendChild(this._display);
		this._container.appendChild(startBtn);
		this._container.appendChild(clearBtn);
		parentDom.appendChild(this._container);

		this._register(addDisposableListener(startBtn, 'click', () => {
			this.start();
		}));
		this._register(addDisposableListener(clearBtn, 'click', () => {
			this.clear();
		}));
		this._register(addDisposableListener(document, 'keydown', (e) => {
			if (!this._recording) {
				return;
			}
			const ev = e as KeyboardEvent;
			this._captureKey(ev);
		}));
		this._register(addDisposableListener(document, 'keyup', (e) => {
			const ev = e as KeyboardEvent;
			this._downKeys.delete(ev.key);
		}));
		this._register(addDisposableListener(document, 'blur', () => {
			if (this._recording) {
				this.finish(true);
			}
		}));
	}

	get isRecording(): boolean {
		return this._recording;
	}

	public start(): void {
		this._recording = true;
		this._captured = [];
		this._downKeys.clear();
		this._display.textContent = 'Tekan kombinasi\u2026 (Esc untuk batal)';
		this._container.style.borderColor = '#4ec9b0';
		this._container.focus();
	}

	public stop(): void {
		if (this._recording) {
			this.finish(false);
		}
	}

	public clear(): void {
		this._captured = [];
		this._display.textContent = 'Belum ada kombinasi';
	}

	private _captureKey(ev: KeyboardEvent): void {
		if (ev.key === 'Escape') {
			ev.preventDefault();
			this.finish(true);
			return;
		}
		const key = KeybindingRecordWidget.normalizeKey(ev.key);
		if (this._downKeys.has(key)) {
			return;
		}
		this._downKeys.add(key);
		const now = Date.now();
		if (this._captured.length > 0 && now - this._lastKeyTime > 700) {
			this.finish(false);
			return;
		}
		const parts: string[] = [];
		if (ev.ctrlKey || ev.metaKey) {
			parts.push(isMacintosh ? 'Cmd' : 'Ctrl');
		}
		if (ev.altKey) {
			parts.push('Alt');
		}
		if (ev.shiftKey && !KeybindingRecordWidget.isModifier(key)) {
			parts.push('Shift');
		}
		if (!KeybindingRecordWidget.isModifier(key)) {
			parts.push(key);
		}
		if (parts.length === 0) {
			return;
		}
		const chord = parts.join('+');
		if (!this._captured.includes(chord)) {
			this._captured.push(chord);
		}
		this._lastKeyTime = now;
		this._display.textContent = this._captured.join(', ');
		ev.preventDefault();
	}

	private finish(cancelled: boolean): void {
		this._recording = false;
		this._container.style.borderColor = '#3c3c3c';
		const result: IKeybindingRecordResult = {
			chord: [...this._captured],
			display: this._captured.join(', '),
			cancelled
		};
		if (cancelled) {
			this._display.textContent = 'Perekaman dibatalkan';
		}
		this._onDidRecord.fire(result);
	}

	public static normalizeKey(key: string): string {
		const map: Record<string, string> = {
			' ': 'Space',
			'ArrowUp': 'Up',
			'ArrowDown': 'Down',
			'ArrowLeft': 'Left',
			'ArrowRight': 'Right',
			'Escape': 'Escape',
			'Enter': 'Enter',
			'Tab': 'Tab',
			'Backspace': 'Backspace',
			'Delete': 'Delete',
			'Home': 'Home',
			'End': 'End',
			'PageUp': 'PageUp',
			'PageDown': 'PageDown'
		};
		if (map[key]) {
			return map[key];
		}
		if (key.length === 1) {
			return key.toUpperCase();
		}
		return key;
	}

	public static isModifier(key: string): boolean {
		return key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta';
	}

	public static chordToDisplay(chord: string[]): string {
		return chord.join(', ');
	}
}
