/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export interface MermaidWebviewInfo {
	readonly id: string;
	readonly webview: vscode.Webview;
	readonly mermaidSource: string;
	readonly title: string | undefined;
	readonly type: 'chat' | 'editor';
}

export interface MermaidCommandContext {
	readonly mermaidWebviewId?: string;
	readonly mermaidSource?: string;
	readonly title?: string;
}

export class MermaidWebviewManager {

	private _activeWebviewId: string | undefined;
	private readonly _webviews = new Map<string, MermaidWebviewInfo>();

	public get activeWebview(): MermaidWebviewInfo | undefined {
		return this._activeWebviewId ? this._webviews.get(this._activeWebviewId) : undefined;
	}

	public registerWebview(id: string, webview: vscode.Webview, mermaidSource: string, title: string | undefined, type: 'chat' | 'editor'): vscode.Disposable {
		if (this._webviews.has(id)) {
			throw new Error(`Webview with id ${id} is already registered.`);
		}

		const info: MermaidWebviewInfo = {
			id,
			webview,
			mermaidSource,
			title,
			type
		};
		this._webviews.set(id, info);
		return { dispose: () => this.unregisterWebview(id) };
	}

	private unregisterWebview(id: string): void {
		this._webviews.delete(id);

		if (this._activeWebviewId === id) {
			this._activeWebviewId = undefined;
		}
	}

	public setActiveWebview(id: string): void {
		if (this._webviews.has(id)) {
			this._activeWebviewId = id;
		}
	}

	public getWebview(id: string): MermaidWebviewInfo | undefined {
		return this._webviews.get(id);
	}

	public resetPanZoom(id: string | undefined): void {
		const target = id ? this._webviews.get(id) : this.activeWebview;
		target?.webview.postMessage({ type: 'resetPanZoom' });
	}
}
