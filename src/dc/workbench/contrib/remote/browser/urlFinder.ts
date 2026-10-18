/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, IDisposable } from '../../../../base/common/lifecycle.js';
import { IDebugService, IDebugSession, IReplElement } from '../../debug/common/debug.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { RunOnceWorker } from '../../../../base/common/async.js';

export class UrlFinder extends Disposable {
	private static readonly dataDebounceTimeout = 500;

	private static readonly maxDataLength = 10000;
	private static readonly localUrlRegex = /\b\w{0,20}(?::\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|:\d{2,5})[\w\-\.\~:\/\?\#[\]\@!\$&\(\)\*\+\,\;\=]*/gim;
	private static readonly extractPortRegex = /(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{1,5})/;
	private static readonly localPythonServerRegex = /HTTP\son\s(127\.0\.0\.1|0\.0\.0\.0)\sport\s(\d+)/;

	private static readonly excludeTerminals = ['Dev Containers'];

	private readonly _onDidMatchLocalUrl = this._register(new Emitter<{ host: string; port: number }>());
	readonly onDidMatchLocalUrl = this._onDidMatchLocalUrl.event;
	private readonly listeners: Map<ITerminalInstance | string, IDisposable> = new Map();
	private readonly terminalDataWorkers = this._register(new DisposableMap<ITerminalInstance, RunOnceWorker<string>>());

	constructor(terminalService: ITerminalService, debugService: IDebugService) {
		super();
		terminalService.instances.forEach(instance => {
			this.registerTerminalInstance(instance);
		});
		this._register(terminalService.onDidCreateInstance(instance => {
			this.registerTerminalInstance(instance);
		}));
		this._register(terminalService.onDidDisposeInstance(instance => {
			this.listeners.get(instance)?.dispose();
			this.listeners.delete(instance);
			this.terminalDataWorkers.deleteAndDispose(instance);
		}));

		this._register(debugService.onDidNewSession(session => {
			if (!session.parentSession || (session.parentSession && session.hasSeparateRepl())) {
				this.listeners.set(session.getId(), session.onDidChangeReplElements(() => {
					this.processNewReplElements(session);
				}));
			}
		}));
		this._register(debugService.onDidEndSession(({ session }) => {
			if (this.listeners.has(session.getId())) {
				this.listeners.get(session.getId())?.dispose();
				this.listeners.delete(session.getId());
			}
		}));
	}

	private registerTerminalInstance(instance: ITerminalInstance) {
		if (!UrlFinder.excludeTerminals.includes(instance.title)) {
			this.listeners.set(instance, instance.onData(data => {
				this.getOrCreateWorker(instance).work(data);
			}));
		}
	}

	private getOrCreateWorker(instance: ITerminalInstance): RunOnceWorker<string> {
		let worker = this.terminalDataWorkers.get(instance);
		if (!worker) {
			worker = new RunOnceWorker<string>(chunks => this.processTerminalData(chunks), UrlFinder.dataDebounceTimeout);
			this.terminalDataWorkers.set(instance, worker);
		}
		return worker;
	}

	private processTerminalData(chunks: string[]): void {
		const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		if (totalLength > UrlFinder.maxDataLength) {
			return;
		}
		this.processData(chunks.join(''));
	}

	private replPositions: Map<string, { position: number; tail: IReplElement }> = new Map();
	private processNewReplElements(session: IDebugSession) {
		const oldReplPosition = this.replPositions.get(session.getId());
		const replElements = session.getReplElements();
		this.replPositions.set(session.getId(), { position: replElements.length - 1, tail: replElements[replElements.length - 1] });

		if (!oldReplPosition && replElements.length > 0) {
			replElements.forEach(element => this.processData(element.toString()));
		} else if (oldReplPosition && (replElements.length - 1 !== oldReplPosition.position)) {
			for (let i = replElements.length - 1; i >= 0; i--) {
				const element = replElements[i];
				if (element === oldReplPosition.tail) {
					break;
				} else {
					this.processData(element.toString());
				}
			}
		}
	}

	override dispose() {
		super.dispose();
		for (const listener of this.listeners.values()) {
			listener.dispose();
		}
	}

	private processData(data: string) {
		data = removeAnsiEscapeCodes(data);
		const urlMatches = data.match(UrlFinder.localUrlRegex) || [];
		if (urlMatches && urlMatches.length > 0) {
			urlMatches.forEach((match) => {
				let serverUrl;
				try {
					serverUrl = new URL(match);
				} catch (e) {
				}
				if (serverUrl) {
					const portMatch = match.match(UrlFinder.extractPortRegex);
					const port = parseFloat(serverUrl.port ? serverUrl.port : (portMatch ? portMatch[2] : 'NaN'));
					if (!isNaN(port) && Number.isInteger(port) && port > 0 && port <= 65535) {
						let host = serverUrl.hostname;
						if (host !== '0.0.0.0' && host !== '127.0.0.1') {
							host = 'localhost';
						}
						if (port !== 9229 && data.startsWith('Debugger listening on')) {
							return;
						}
						this._onDidMatchLocalUrl.fire({ port, host });
					}
				}
			});
		} else {
			const pythonMatch = data.match(UrlFinder.localPythonServerRegex);
			if (pythonMatch && pythonMatch.length === 3) {
				this._onDidMatchLocalUrl.fire({ host: pythonMatch[1], port: Number(pythonMatch[2]) });
			}
		}
	}
}
