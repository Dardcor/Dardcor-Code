/**
 * Dardcor Code - Typed Editor Configuration & Options Validator (Task 225)
 * Mirrors: vs/editor/common/config/editorOptions.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { ITextModel, Position, Range } from '../model/text-model';

export type LineNumberRenderType = 'on' | 'off' | 'relative' | 'interval';
export type WhitespaceRenderMode = 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
export type CursorStyle = 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin';
export type CursorBlinking = 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';

export interface IMinimapOptions {
	readonly enabled: boolean;
	readonly maxColumn: number;
	readonly renderCharacters: boolean;
	readonly side: 'right' | 'left';
}

export interface IEditorOptions {
	readonly tabSize: number;
	readonly insertSpaces: boolean;
	readonly lineNumbers: LineNumberRenderType;
	readonly lineNumbersMinChars: number;
	readonly wordWrap: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
	readonly wordWrapColumn: number;
	readonly glyphMargin: boolean;
	readonly folding: boolean;
	readonly renderWhitespace: WhitespaceRenderMode;
	readonly renderIndentGuides: boolean;
	readonly highlightActiveIndentGuide: boolean;
	readonly cursorStyle: CursorStyle;
	readonly cursorBlinking: CursorBlinking;
	readonly cursorWidth: number;
	readonly fontSize: number;
	readonly fontFamily: string;
	readonly lineHeight: number;
	readonly readOnly: boolean;
	readonly roundedSelection: boolean;
	readonly padding?: { readonly top: number; readonly bottom: number };
	readonly minimap: IMinimapOptions;
	readonly theme?: string;
}

export interface IRenderContext {
	readonly layout: {
		getVerticalOffsetForLineNumber(lineNumber: number): number;
		getVerticalOffsetForLineNumberInViewport?(lineNumber: number): number;
		getScrollHeight?(): number;
	};
	readonly viewport: {
		readonly startLineNumber: number;
		readonly endLineNumber: number;
		readonly top?: number;
		readonly height?: number;
	};
	readonly scrollTop?: number;
	readonly scrollLeft?: number;
	readonly options: IEditorOptions;

	readonly charWidth: number;
	readonly lineHeight: number;
	readonly model: ITextModel;
	readonly viewModel?: any;
	readonly getLineTokens?: (lineNumber: number) => any;
	readonly decorations?: any[];
	readonly selections?: any[];
	readonly cursors?: any[];
}


export type IEditorOptionsUpdate = Partial<IEditorOptions>;

export class EditorOptions extends Disposable {
	private _options: IEditorOptions;

	private readonly _onDidChangeOptions = this._register(new Emitter<IEditorOptions>());
	readonly onDidChangeOptions: Event<IEditorOptions> = this._onDidChangeOptions.event;

	constructor(initialOptions: IEditorOptionsUpdate = {}) {
		super();
		this._options = EditorOptions.validateOptions({
			...EditorOptions.getDefaultOptions(),
			...initialOptions,
		});
	}

	public get options(): IEditorOptions {
		return this._options;
	}

	public getOption<K extends keyof IEditorOptions>(key: K): IEditorOptions[K] {
		return this._options[key];
	}

	public updateOptions(newOptions: IEditorOptionsUpdate): void {
		const validated = EditorOptions.validateOptions({
			...this._options,
			...newOptions,
		});
		this._options = validated;
		this._onDidChangeOptions.fire(this._options);
	}

	public get(id: string): any {
		return (this._options as any)[id];
	}

	public set(id: string, value: any): void {
		this.updateOptions({ [id]: value } as any);
	}

	public getAll(): IEditorOptions {
		return this._options;
	}

	public get onDidChange(): Event<IEditorOptions> {
		return this.onDidChangeOptions;
	}

	public getCharacterWidth(): number {
		return Math.round(this._options.fontSize * 0.602);
	}

	public getEffectiveLineHeight(): number {
		return this._options.lineHeight > 0 ? this._options.lineHeight : Math.round(this._options.fontSize * 1.5);
	}

	public static getDefaultOptions(): IEditorOptions {

		return {
			tabSize: 4,
			insertSpaces: true,
			lineNumbers: 'on',
			lineNumbersMinChars: 3,
			wordWrap: 'off',
			wordWrapColumn: 80,
			glyphMargin: true,
			folding: true,
			renderWhitespace: 'selection',
			renderIndentGuides: true,
			highlightActiveIndentGuide: true,
			cursorStyle: 'line',
			cursorBlinking: 'blink',
			cursorWidth: 2,
			fontSize: 14,
			fontFamily: 'Consolas, "Courier New", monospace',
			lineHeight: 20,
			readOnly: false,
			roundedSelection: true,
			minimap: {
				enabled: true,
				maxColumn: 120,
				renderCharacters: true,
				side: 'right',
			},
		};
	}

	public static validateOptions(options: IEditorOptions): IEditorOptions {
		const fontSize = Math.max(8, Math.min(100, options.fontSize || 14));
		const lineHeight = Math.max(fontSize, Math.min(150, options.lineHeight || Math.round(fontSize * 1.5)));
		const tabSize = Math.max(1, Math.min(32, options.tabSize || 4));

		return {
			...options,
			fontSize,
			lineHeight,
			tabSize,
		};
	}
}
