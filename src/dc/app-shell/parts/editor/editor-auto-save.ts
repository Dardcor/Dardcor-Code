/**
 * Dardcor Code - Auto-Save Trigger Manager (AfterDelay, OnFocusChange, OnWindowChange)
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { Debouncer } from '../../../core/async/debouncer.js';
import { EditorPart } from './editor-part.js';
import { EditorInput } from './editor-input.js';

export const enum AutoSaveMode {
	OFF = 'off',
	AFTER_DELAY = 'afterDelay',
	ON_FOCUS_CHANGE = 'onFocusChange',
	ON_WINDOW_CHANGE = 'onWindowChange',
}

export const AUTO_SAVE_DEFAULT_DELAY = 1000;
export const AUTO_SAVE_MAX_DELAY = 10000;

export interface IEditorAutoSaveOptions {
	readonly mode?: AutoSaveMode;
	readonly delay?: number;
	readonly window?: Window;
}

export interface IAutoSaveEvent {
	readonly input: EditorInput;
	readonly reason: AutoSaveMode | 'manual';
	readonly saved: boolean;
}

export type AutoSaveHandler = (input: EditorInput, reason: AutoSaveMode | 'manual') => boolean | Promise<boolean>;

export class EditorAutoSave extends Disposable {
	private readonly _window: Window;
	private _mode: AutoSaveMode;
	private _delay: number;
	private _saveHandler: AutoSaveHandler | null = null;
	private _activeInput: EditorInput | null = null;
	private _dirtyTracking = false;

	private readonly _debouncer: Debouncer;
	private readonly _saveInFlight = new Set<string>();

	private readonly _onDidSave = this._register(new Emitter<IAutoSaveEvent>());
	readonly onDidSave: Event<IAutoSaveEvent> = this._onDidSave.event;

	private readonly _onDidChangeMode = this._register(new Emitter<AutoSaveMode>());
	readonly onDidChangeMode: Event<AutoSaveMode> = this._onDidChangeMode.event;

	constructor(
		private readonly _editorPart: EditorPart,
		options: IEditorAutoSaveOptions = {}
	) {
		super();
		this._window = options.window ?? window;
		this._mode = options.mode ?? AutoSaveMode.OFF;
		this._delay = options.delay ?? AUTO_SAVE_DEFAULT_DELAY;

		this._debouncer = new Debouncer(() => this._triggerSave(AutoSaveMode.AFTER_DELAY), this._delay);
		this._register(this._debouncer);

		this._register(this._editorPart.onDidChangeActiveEditor(e => this._onActiveEditorChanged(e?.input ?? null)));

		const onBlur = () => this._onWindowBlur();
		const onFocus = () => this._onWindowFocused();
		this._window.addEventListener('blur', onBlur);
		this._window.addEventListener('focus', onFocus);
		this._register({
			dispose: () => {
				this._window.removeEventListener('blur', onBlur);
				this._window.removeEventListener('focus', onFocus);
			},
		});
	}

	public get mode(): AutoSaveMode {
		return this._mode;
	}

	public set mode(mode: AutoSaveMode) {
		if (this._mode === mode) {
			return;
		}
		this._mode = mode;
		this._onDidChangeMode.fire(mode);
	}

	public get delay(): number {
		return this._delay;
	}

	public set delay(delay: number) {
		if (this._delay === delay) {
			return;
		}
		this._delay = Math.max(100, Math.min(AUTO_SAVE_MAX_DELAY, delay));
	}

	public setSaveHandler(handler: AutoSaveHandler): void {
		this._saveHandler = handler;
	}

	public async triggerImmediateSave(input?: EditorInput): Promise<boolean> {
		const target = input ?? this._activeInput;
		if (!target || !target.isDirty) {
			return false;
		}
		const previousActive = this._activeInput;
		this._activeInput = target;
		await this._triggerSave('manual');
		if (previousActive && previousActive !== target) {
			this._activeInput = previousActive;
		}
		return !target.isDirty;
	}

	private _onActiveEditorChanged(input: EditorInput | null): void {
		this._activeInput = input;
	}

	private _onDirtyChanged(input: EditorInput): void {
		if (!input.isDirty) {
			return;
		}
		if (this._mode === AutoSaveMode.AFTER_DELAY) {
			this._debouncer.debounce();
		}
	}

	private _onWindowBlur(): void {
		if (this._mode === AutoSaveMode.ON_FOCUS_CHANGE && this._activeInput?.isDirty) {
			this._triggerSave(AutoSaveMode.ON_FOCUS_CHANGE);
		}
	}

	private _onWindowFocused(): void {
		if (this._mode === AutoSaveMode.ON_WINDOW_CHANGE) {
			this._triggerSave(AutoSaveMode.ON_WINDOW_CHANGE);
		}
	}


	private async _triggerSave(reason: AutoSaveMode | 'manual'): Promise<void> {
		const input = this._activeInput;
		if (!input || !input.isDirty) {
			return;
		}
		const key = input.toKey();
		if (this._saveInFlight.has(key)) {
			return;
		}
		this._saveInFlight.add(key);
		try {
			let saved = false;
			if (this._saveHandler) {
				saved = await this._saveHandler(input, reason);
			} else {
				saved = this._defaultSave(input);
			}
			if (saved) {
				input.setDirty(false);
			}
			this._onDidSave.fire({ input, reason, saved });
		} finally {
			this._saveInFlight.delete(key);
		}
	}

	private _defaultSave(input: EditorInput): boolean {
		const model = input.getTextModel();
		if (!model) {
			return false;
		}
		return true;
	}

	dispose(): void {
		this._debouncer.cancel();
		super.dispose();
	}
}
