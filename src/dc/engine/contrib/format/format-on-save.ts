/**
 * Dardcor Code - Format Document Before Save Listener
 */

import { Disposable, IDisposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel } from "../../model/text-model.js";
import { FormatController, IFormattingOptions } from "./format-controller.js";

export interface ISaveRequestEvent {
	readonly model: ITextModel;
	cancel(): void;
}

export interface IFormatOnSaveHost {
	getModel(): ITextModel | null;
	onBeforeSave(callback: (event: ISaveRequestEvent) => void): IDisposable;
}

export interface IFormatOnSaveEvent {
	readonly model: ITextModel;
	readonly editCount: number;
	readonly hadChanges: boolean;
}

/**
 * Hooks the "before save" event of the editor and runs the registered format
 * providers on the document when formatting on save is enabled. Fires
 * `onDidFormat` so the UI can report the result.
 */
export class FormatOnSave extends Disposable {
	private readonly _host: IFormatOnSaveHost;
	private readonly _formatController: FormatController;
	private _isEnabled: boolean = true;
	private _formatOnSaveTimeoutMs: number = 750;

	private readonly _onDidFormat = this._register(new Emitter<IFormatOnSaveEvent>());
	readonly onDidFormat: Event<IFormatOnSaveEvent> = this._onDidFormat.event;

	private readonly _onDidChangeEnabled = this._register(new Emitter<boolean>());
	readonly onDidChangeEnabled: Event<boolean> = this._onDidChangeEnabled.event;

	constructor(host: IFormatOnSaveHost, formatController: FormatController) {
		super();
		this._host = host;
		this._formatController = formatController;
		this._register(this._host.onBeforeSave(event => this._handleBeforeSave(event)));
	}

	public setEnabled(enabled: boolean): void {
		if (this._isEnabled === enabled) {
			return;
		}
		this._isEnabled = enabled;
		this._onDidChangeEnabled.fire(enabled);
	}

	public isEnabled(): boolean {
		return this._isEnabled;
	}

	public setFormatOnSaveTimeout(ms: number): void {
		this._formatOnSaveTimeoutMs = Math.max(0, ms);
	}

	public getFormatOnSaveTimeout(): number {
		return this._formatOnSaveTimeoutMs;
	}

	private async _handleBeforeSave(event: ISaveRequestEvent): Promise<void> {
		if (!this._isEnabled) {
			return;
		}
		const options: IFormattingOptions = { tabSize: 4, insertSpaces: true };
		try {
			const hadChanges = await this._formatController.formatDocument(event.model, options);
			if (hadChanges) {
				this._onDidFormat.fire({
					model: event.model,
					editCount: this._lastEditCount,
					hadChanges: true
				});
			}
		} catch {
			// Formatting must never block the save.
		}
	}

	private _lastEditCount: number = 0;
}

export function shouldFormatOnSave(model: ITextModel, lastSavedVersion: number): boolean {
	return model.getLineCount() + model.getValue().length !== lastSavedVersion;
}
