/**
 * Dardcor Code - Shared Layout Configuration Holder (Task 262)
 * Mirrors: vs/editor/browser/editorBrowser.ts (ViewContext) & common/config/editorOptions.ts
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export interface IFontInfo {
	readonly fontFamily: string;
	readonly fontSize: number;
	readonly lineHeight: number;
	readonly charWidth: number;
}

export interface IViewConfiguration {
	readonly fontInfo: IFontInfo;
	readonly tabSize: number;
	readonly lineNumbersMinChars: number;
	readonly glyphMargin: boolean;
	readonly folding: boolean;
	readonly renderWhitespace: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
	readonly renderControlCharacters: boolean;
	readonly minimap: boolean;
	readonly rulers: readonly number[];
	readonly scrollBeyondLastLine: boolean;
	readonly wordWrap: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
	readonly wordWrapColumn: number;
	readonly autoClosingBrackets: 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';
}

export const DEFAULT_VIEW_CONFIGURATION: IViewConfiguration = {
	fontInfo: {
		fontFamily: 'Consolas, monospace',
		fontSize: 14,
		lineHeight: 19,
		charWidth: 7.5,
	},
	tabSize: 4,
	lineNumbersMinChars: 3,
	glyphMargin: true,
	folding: true,
	renderWhitespace: 'none',
	renderControlCharacters: false,
	minimap: true,
	rulers: [],
	scrollBeyondLastLine: true,
	wordWrap: 'off',
	wordWrapColumn: 80,
	autoClosingBrackets: 'languageDefined',
};

export class ViewContext extends Disposable {
	private _configuration: IViewConfiguration;

	private readonly _onDidChangeConfiguration = this._register(new Emitter<IViewConfiguration>());
	readonly onDidChangeConfiguration: Event<IViewConfiguration> = this._onDidChangeConfiguration.event;

	constructor(configuration: Partial<IViewConfiguration> = {}) {
		super();
		this._configuration = { ...DEFAULT_VIEW_CONFIGURATION, ...configuration };
	}

	public getConfiguration(): IViewConfiguration {
		return this._configuration;
	}

	public setConfiguration(configuration: Partial<IViewConfiguration>): void {
		this._configuration = { ...this._configuration, ...configuration };
		this._onDidChangeConfiguration.fire(this._configuration);
	}

	public getFontInfo(): IFontInfo {
		return this._configuration.fontInfo;
	}

	public getLineHeight(): number {
		return this._configuration.fontInfo.lineHeight;
	}

	public getCharWidth(): number {
		return this._configuration.fontInfo.charWidth;
	}

	public getTabSize(): number {
		return Math.max(1, this._configuration.tabSize);
	}

	public isDark(): boolean {
		return true;
	}
}
