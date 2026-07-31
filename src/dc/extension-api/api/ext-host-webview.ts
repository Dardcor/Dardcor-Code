/**
 * Dardcor Code - dc.window.createWebviewPanel API Implementation (Task 613)
 * Mirrors: vs/workbench/api/common/extHostWebview.ts
 */

import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { RPCProtocol } from '../host/rpc-protocol.js';
import { generateUuid } from '../../core/types/uuid.js';
import { URI } from '../../core/types/uri.js';

export interface IWebviewOptions {
	enableScripts?: boolean;
	enableForms?: boolean;
	enableCommandUris?: boolean;
	enableFindWidget?: boolean;
	localResourceRoots?: URI[];
	portMapping?: Array<{ webviewPort: number; extensionHostPort: number }>;
	retainContextWhenHidden?: boolean;
}

export interface IWebviewPanelOptions {
	readonly viewType: string;
	readonly title: string;
	readonly viewColumn: number;
	readonly preserveFocus: boolean;
	readonly options: IWebviewOptions;
}

export interface IWebviewMessageEvent {
	readonly message: any;
	readonly panelId: string;
}

export class Webview {
	private _html = '';
	private _options: IWebviewOptions;

	private readonly _onDidReceiveMessage = new Emitter<any>();
	readonly onDidReceiveMessage: Event<any> = this._onDidReceiveMessage.event;

	constructor(
		private readonly _rpc: RPCProtocol,
		public readonly id: string,
		options: IWebviewOptions = {}
	) {
		this._options = { ...options };
	}

	public get html(): string {
		return this._html;
	}

	public set html(value: string) {
		this._html = value;
		this._rpc.notify('main', 'webview.setHtml', { id: this.id, html: value });
	}

	public get options(): IWebviewOptions {
		return { ...this._options };
	}

	public set options(value: IWebviewOptions) {
		this._options = { ...this._options, ...value };
		this._rpc.notify('main', 'webview.setOptions', { id: this.id, options: this._options });
	}

	public postMessage(message: any): Promise<boolean> {
		return this._rpc.call<boolean>('main', 'webview.postMessage', { id: this.id, message });
	}

	public asWebviewUri(localResource: URI): URI {
		return URI.from({ scheme: 'webview', path: `/dc/${this.id}/${localResource.path}` });
	}

	public _fireMessage(message: any): void {
		this._onDidReceiveMessage.fire(message);
	}

	public dispose(): void {
		this._onDidReceiveMessage.dispose();
	}
}

export class WebviewPanel extends Disposable {
	private _title: string;
	private _viewColumn: number;
	private _visible = true;
	private _active = true;
	private _disposed = false;

	private readonly _onDidChangeViewState = this._register(new Emitter<{ webviewPanel: WebviewPanel }>());
	readonly onDidChangeViewState: Event<{ webviewPanel: WebviewPanel }> = this._onDidChangeViewState.event;

	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose: Event<void> = this._onDidDispose.event;

	constructor(
		private readonly _rpc: RPCProtocol,
		public readonly viewType: string,
		title: string,
		viewColumn: number,
		public readonly webview: Webview,
		private readonly _preserveFocus: boolean
	) {
		super();
		this._title = title;
		this._viewColumn = viewColumn;
	}

	public get title(): string {
		return this._title;
	}

	public set title(value: string) {
		if (value !== this._title) {
			this._title = value;
			this._rpc.notify('main', 'webview.setTitle', { id: this.webview.id, title: value });
		}
	}

	public get viewColumn(): number {
		return this._viewColumn;
	}

	public get visible(): boolean {
		return this._visible;
	}

	public get active(): boolean {
		return this._active;
	}

	public reveal(viewColumn?: number, preserveFocus?: boolean): void {
		this._rpc.notify('main', 'webview.reveal', { id: this.webview.id, viewColumn, preserveFocus: preserveFocus ?? this._preserveFocus });
	}

	public _updateState(data: { visible: boolean; active: boolean; viewColumn: number; title?: string }): void {
		const changed = data.visible !== this._visible || data.active !== this._active || data.viewColumn !== this._viewColumn;
		this._visible = data.visible;
		this._active = data.active;
		this._viewColumn = data.viewColumn;
		if (data.title !== undefined) {
			this._title = data.title;
		}
		if (changed) {
			this._onDidChangeViewState.fire({ webviewPanel: this });
		}
	}

	public _fireDisposed(): void {
		this._disposed = true;
		this._onDidDispose.fire();
	}

	public override dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._rpc.notify('main', 'webview.dispose', { id: this.webview.id });
		this._onDidDispose.fire();
		super.dispose();
	}
}

export interface IWebviewApi {
	createWebviewPanel(viewType: string, title: string, showOptions: number | { viewColumn: number; preserveFocus?: boolean }, options?: IWebviewOptions): WebviewPanel;
}

/**
 * Host-side `createWebviewPanel`. The actual iframe lives on the main
 * side; here we hold the panel/view model and marshal messages.
 */
export class ExtHostWebview extends Disposable {
	private readonly _panels = new Map<string, WebviewPanel>();
	private readonly _webviews = new Map<string, Webview>();

	constructor(private readonly _rpc: RPCProtocol) {
		super();
		this._register(this._rpc.onEvent('webview', 'message')((payload: { id: string; message: any }) => {
			this._webviews.get(payload.id)?._fireMessage(payload.message);
		}));
		this._register(this._rpc.onEvent('webview', 'state')((payload: { id: string; visible: boolean; active: boolean; viewColumn: number; title?: string }) => {
			this._panels.get(payload.id)?._updateState(payload);
		}));
		this._register(this._rpc.onEvent('webview', 'disposed')((payload: { id: string }) => {
			const panel = this._panels.get(payload.id);
			if (panel) {
				this._panels.delete(payload.id);
				this._webviews.delete(payload.id);
				panel._fireDisposed();
			}
		}));
	}

	public createWebviewPanel(viewType: string, title: string, showOptions: number | { viewColumn: number; preserveFocus?: boolean }, options?: IWebviewOptions): WebviewPanel {
		const viewColumn = typeof showOptions === 'number' ? showOptions : showOptions.viewColumn;
		const preserveFocus = typeof showOptions === 'number' ? false : (showOptions.preserveFocus ?? false);
		const id = generateUuid();
		const webview = new Webview(this._rpc, id, options);
		const panel = new WebviewPanel(this._rpc, viewType, title, viewColumn, webview, preserveFocus);
		this._webviews.set(id, webview);
		this._panels.set(id, panel);
		this._rpc.notify('main', 'webview.createPanel', {
			id,
			viewType,
			title,
			viewColumn,
			preserveFocus,
			options
		});
		return panel;
	}

	public get api(): IWebviewApi {
		return {
			createWebviewPanel: (viewType: string, title: string, showOptions: number | { viewColumn: number; preserveFocus?: boolean }, options?: IWebviewOptions) =>
				this.createWebviewPanel(viewType, title, showOptions, options)
		};
	}

	public getPanels(): ReadonlyMap<string, WebviewPanel> {
		return this._panels;
	}
}
