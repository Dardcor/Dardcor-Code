/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext) {
	vscode.workspace.registerRemoteAuthorityResolver('test', {
		async resolve(_authority: string): Promise<vscode.ResolverResult> {
			console.log(`Resolving ${_authority}`);
			console.log(`Activating vscode.github-authentication to simulate auth`);
			await vscode.extensions.getExtension('vscode.github-authentication')?.activate();
			return new vscode.ManagedResolvedAuthority(async () => {
				return new InitialManagedMessagePassing();
			});
		}
	});
}

class InitialManagedMessagePassing implements vscode.ManagedMessagePassing {
	private readonly dataEmitter = new vscode.EventEmitter<Uint8Array<ArrayBuffer>>();
	private readonly closeEmitter = new vscode.EventEmitter<Error | undefined>();
	private readonly endEmitter = new vscode.EventEmitter<void>();

	public readonly onDidReceiveMessage = this.dataEmitter.event;
	public readonly onDidClose = this.closeEmitter.event;
	public readonly onDidEnd = this.endEmitter.event;

	private _actual: OpeningManagedMessagePassing | null = null;
	private _isDisposed = false;

	public send(d: Uint8Array): void {
		if (this._actual) {
			this._actual.send(d as Uint8Array<ArrayBuffer>);
			return;
		}

		if (this._isDisposed) {
			return;
		}

		const decoder = new TextDecoder();
		const str = decoder.decode(d);

		const match = str.match(/GET\s+(\S+)\s+HTTP/);
		if (!match) {
			console.error(`Coult not parse ${str}`);
			this.closeEmitter.fire(new Error(`Coult not parse ${str}`));
			return;
		}

		const url = new URL(match[1]);

		const parsedUrl = new URL(url);
		this._actual = new OpeningManagedMessagePassing(parsedUrl, this.dataEmitter, this.closeEmitter, this.endEmitter);
	}

	public end(): void {
		if (this._actual) {
			this._actual.end();
			return;
		}
		this._isDisposed = true;
	}
}

class OpeningManagedMessagePassing {

	private readonly socket: WebSocket;
	private isOpen = false;
	private bufferedData: Uint8Array<ArrayBuffer>[] = [];

	constructor(
		url: URL,
		dataEmitter: vscode.EventEmitter<Uint8Array>,
		closeEmitter: vscode.EventEmitter<Error | undefined>,
		_endEmitter: vscode.EventEmitter<void>
	) {
		this.socket = new WebSocket(`ws://localhost:9888${url.pathname}${url.search.replace(/skipWebSocketFrames=true/, 'skipWebSocketFrames=false')}`);
		this.socket.addEventListener('close', () => closeEmitter.fire(undefined));
		this.socket.addEventListener('error', (e) => closeEmitter.fire(new Error(String(e))));
		this.socket.addEventListener('message', async (e) => {
			const arrayBuffer = await e.data.arrayBuffer();
			dataEmitter.fire(new Uint8Array(arrayBuffer));
		});
		this.socket.addEventListener('open', () => {
			while (this.bufferedData.length > 0) {
				const first = this.bufferedData.shift()!;
				this.socket.send(first);
			}
			this.isOpen = true;

			const responseHeaders = [
				`HTTP/1.1 101 Switching Protocols`,
				`Upgrade: websocket`,
				`Connection: Upgrade`,
				`Sec-WebSocket-Accept: TODO`
			];
			const textEncoder = new TextEncoder();
			textEncoder.encode(responseHeaders.join('\r\n') + '\r\n\r\n');
			dataEmitter.fire(textEncoder.encode(responseHeaders.join('\r\n') + '\r\n\r\n'));
		});
	}

	public send(d: Uint8Array<ArrayBuffer>): void {
		if (!this.isOpen) {
			this.bufferedData.push(d);
			return;
		}
		this.socket.send(d);
	}

	public end(): void {
		this.socket.close();
	}
}
