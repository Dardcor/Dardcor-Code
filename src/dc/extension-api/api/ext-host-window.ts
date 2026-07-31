/**
 * Dardcor Code - dc.window API Bridge (Task 607)
 * Mirrors: vs/workbench/api/common/extHostWindow.ts
 */

import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { RPCProtocol } from '../host/rpc-protocol.js';
import { generateUuid } from '../../core/types/uuid.js';
import { TextEditor } from './ext-host-text-editor.js';
import { ExtHostEditors } from './ext-host-editors.js';
import { ExtHostTerminal, Terminal } from './ext-host-terminal.js';
import { ExtHostWebview, WebviewPanel } from './ext-host-webview.js';
import { CustomEditorHost, ICustomEditorProvider } from '../sandbox/custom-editor-host.js';
import { URI } from '../../core/types/uri.js';
import { ITextEditorData } from './ext-host-text-editor.js';

export enum StatusBarAlignment {
	Left = 1,
	Right = 2
}

export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
	Two = 2,
	Three = 3
}

export enum MessageSeverity {
	Information = 0,
	Warning = 1,
	Error = 2
}

export interface IShowTextDocumentResult {
	editor: ITextEditorData;
	document?: { uri: string; languageId: string; version: number; text: string; eol: 'lf' | 'crlf' };
}

export interface IWindowApi {
	readonly activeTextEditor: TextEditor | undefined;
	readonly visibleTextEditors: TextEditor[];
	readonly onDidChangeActiveTextEditor: Event<TextEditor | undefined>;
	readonly onDidChangeVisibleTextEditors: Event<TextEditor[]>;
	readonly onDidOpenTerminal: Event<Terminal>;
	readonly onDidCloseTerminal: Event<Terminal>;
	readonly onDidChangeActiveTerminal: Event<Terminal | undefined>;
	readonly terminals: readonly Terminal[];
	showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>;
	showInformationMessage<T extends { title: string }>(message: string, ...items: T[]): Promise<T | undefined>;
	showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>;
	showWarningMessage<T extends { title: string }>(message: string, ...items: T[]): Promise<T | undefined>;
	showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>;
	showErrorMessage<T extends { title: string }>(message: string, ...items: T[]): Promise<T | undefined>;
	showTextDocument(uri: URI, column?: ViewColumn, preserveFocus?: boolean): Promise<TextEditor>;
	showTextDocument(editor: TextEditor, column?: ViewColumn, preserveFocus?: boolean): Promise<TextEditor>;
	createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;
	createTerminal(options?: { name?: string; cwd?: string; env?: Record<string, string>; shellPath?: string; shellArgs?: string[] } | string): Terminal;
	createWebviewPanel(viewType: string, title: string, showOptions: ViewColumn | { viewColumn: ViewColumn; preserveFocus?: boolean }, options?: { enableScripts?: boolean; enableForms?: boolean; retainContextWhenHidden?: boolean }): WebviewPanel;
	registerCustomEditorProvider(viewType: string, provider: ICustomEditorProvider, options?: { webviewOptions?: { enableFindWidget?: boolean } }): IDisposable;
}

/**
 * Host-side implementation of the `dc.window` namespace. Every call that
 * affects the UI is forwarded to the main process over RPC.
 */
export class ExtHostWindow extends Disposable {
	constructor(
		private readonly _rpc: RPCProtocol,
		private readonly _editors: ExtHostEditors,
		private readonly _terminals: ExtHostTerminal,
		private readonly _webviews: ExtHostWebview,
		private readonly _customEditorHost: CustomEditorHost
	) {
		super();
	}

	public get api(): IWindowApi {
		const self = this;
		return {
			get activeTextEditor() {
				return self._editors.activeTextEditor;
			},
			get visibleTextEditors() {
				return self._editors.visibleTextEditors;
			},
			onDidChangeActiveTextEditor: this._editors.onDidChangeActiveTextEditor,
			onDidChangeVisibleTextEditors: this._editors.onDidChangeVisibleTextEditors,
			onDidOpenTerminal: this._terminals.onDidOpenTerminal,
			onDidCloseTerminal: this._terminals.onDidCloseTerminal,
			onDidChangeActiveTerminal: this._terminals.onDidChangeActiveTerminal,
			get terminals() {
				return self._terminals.all;
			},
			showInformationMessage: (message: string, ...items: any[]) => this._showMessage(MessageSeverity.Information, message, items),
			showWarningMessage: (message: string, ...items: any[]) => this._showMessage(MessageSeverity.Warning, message, items),
			showErrorMessage: (message: string, ...items: any[]) => this._showMessage(MessageSeverity.Error, message, items),
			showTextDocument: (target: URI | TextEditor, column?: ViewColumn, preserveFocus?: boolean) => this._showTextDocument(target, column, preserveFocus),
			createStatusBarItem: (alignment?: StatusBarAlignment, priority?: number) => this._createStatusBarItem(alignment, priority),
			createTerminal: (options?: { name?: string; cwd?: string; env?: Record<string, string>; shellPath?: string; shellArgs?: string[] } | string) => this._terminals.createTerminal(options),
			createWebviewPanel: (viewType: string, title: string, showOptions: ViewColumn | { viewColumn: ViewColumn; preserveFocus?: boolean }, options?: { enableScripts?: boolean; enableForms?: boolean; retainContextWhenHidden?: boolean }) =>
				this._webviews.createWebviewPanel(viewType, title, showOptions, options),
			registerCustomEditorProvider: (viewType: string, provider: ICustomEditorProvider, _options?: { webviewOptions?: { enableFindWidget?: boolean } }) =>
				this._customEditorHost.registerProvider(viewType, provider)
		};
	}

	private async _showMessage(severity: MessageSeverity, message: string, items: any[]): Promise<any> {
		const normalized = items.length === 1 && Array.isArray(items[0]) ? items[0] : items;
		const labels = normalized.map((item: any) => typeof item === 'string' ? item : item.title);
		const picked = await this._rpc.call<string | undefined>('main', 'window.showMessage', { severity, message, items: labels });
		if (picked === undefined) {
			return undefined;
		}
		const index = labels.indexOf(picked);
		const original = normalized[index];
		return typeof original === 'string' ? original : original?.title;
	}

	private async _showTextDocument(target: URI | TextEditor, column?: ViewColumn, preserveFocus?: boolean): Promise<TextEditor> {
		const uri = target instanceof URI ? target : target.document.uri;
		const result = await this._rpc.call<IShowTextDocumentResult>('main', 'window.showTextDocument', {
			uri: uri.toString(),
			column,
			preserveFocus
		});
		if (!result?.editor) {
			throw new Error(`Gagal membuka editor untuk ${uri.toString()}`);
		}
		if (result.document) {
			this._documentsBridge?.addDocument(result.document);
		}
		this._editors.updateEditor(result.editor);
		return this._editors.getTextEditor(result.editor.uri)!;
	}

	private _documentsBridge: { addDocument(data: any): void } | undefined;

	public setDocumentsBridge(bridge: { addDocument(data: any): void }): void {
		this._documentsBridge = bridge;
	}

	private _createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem {
		return new StatusBarItem(this._rpc, generateUuid(), alignment ?? StatusBarAlignment.Left, priority ?? 100);
	}
}

export class StatusBarItem implements IDisposable {
	private _text = '';
	private _tooltip: string | undefined;
	private _command: string | { title?: string; command: string; arguments?: any[] } | undefined;
	private _color: string | undefined;
	private _backgroundColor: string | undefined;
	private _alignment: StatusBarAlignment;
	private _priority: number;
	private _visible = false;
	private _disposed = false;

	constructor(
		private readonly _rpc: RPCProtocol,
		private readonly _id: string,
		alignment: StatusBarAlignment,
		priority: number
	) {
		this._alignment = alignment;
		this._priority = priority;
	}

	public get id(): string {
		return this._id;
	}

	public get text(): string {
		return this._text;
	}

	public set text(value: string) {
		this._text = value;
		this._sync();
	}

	public get tooltip(): string | undefined {
		return this._tooltip;
	}

	public set tooltip(value: string | undefined) {
		this._tooltip = value;
		this._sync();
	}

	public get command(): string | { title?: string; command: string; arguments?: any[] } | undefined {
		return this._command;
	}

	public set command(value: string | { title?: string; command: string; arguments?: any[] } | undefined) {
		this._command = value;
		this._sync();
	}

	public get color(): string | undefined {
		return this._color;
	}

	public set color(value: string | undefined) {
		this._color = value;
		this._sync();
	}

	public get backgroundColor(): string | undefined {
		return this._backgroundColor;
	}

	public set backgroundColor(value: string | undefined) {
		this._backgroundColor = value;
		this._sync();
	}

	public get alignment(): StatusBarAlignment {
		return this._alignment;
	}

	public get priority(): number {
		return this._priority;
	}

	public show(): void {
		if (!this._visible) {
			this._visible = true;
			this._sync();
		}
	}

	public hide(): void {
		if (this._visible) {
			this._visible = false;
			this._sync();
		}
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._visible = false;
		this._rpc.notify('main', 'window.statusBar.dispose', { id: this._id });
	}

	private _sync(): void {
		if (this._disposed) {
			return;
		}
		this._rpc.notify('main', 'window.statusBar', {
			id: this._id,
			text: this._text,
			tooltip: this._tooltip,
			command: this._command,
			color: this._color,
			backgroundColor: this._backgroundColor,
			alignment: this._alignment,
			priority: this._priority,
			visible: this._visible
		});
	}
}
