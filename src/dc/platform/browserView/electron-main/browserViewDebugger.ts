/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableMap, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { CDPEvent, CDPTargetInfo, ICDPConnection } from '../common/cdp/types.js';
import type { BrowserView } from './browserView.js';

export type CDPCommandInterceptor = (method: string, params: unknown, session: ICDPConnection | undefined) => Promise<unknown> | undefined;

export class BrowserViewDebugger extends Disposable {

	private readonly _sessions = this._register(new DisposableMap<string, DebugSession>());
	private readonly _onSessionCreated = this._register(new Emitter<{ session: ICDPConnection; waitingForDebugger: boolean }>());
	readonly onSessionCreated = this._onSessionCreated.event;

	private readonly _knownTargets = new Map<string, CDPTargetInfo>();
	get knownTargets(): ReadonlyMap<string, CDPTargetInfo> { return this._knownTargets; }

	private readonly _onTargetDiscovered = this._register(new Emitter<CDPTargetInfo>());
	readonly onTargetDiscovered = this._onTargetDiscovered.event;

	private readonly _onTargetDestroyed = this._register(new Emitter<string>());
	readonly onTargetDestroyed = this._onTargetDestroyed.event;

	private readonly _onTargetInfoChanged = this._register(new Emitter<CDPTargetInfo>());
	readonly onTargetInfoChanged = this._onTargetInfoChanged.event;

	private _isPaused = false;
	get isPaused(): boolean { return this._isPaused; }

	readonly targetId: string;

	private readonly _messageHandler: (event: Electron.Event, method: string, params: unknown, sessionId?: string) => void;
	private readonly _electronDebugger: Electron.Debugger;
	private readonly _interceptors = new Set<CDPCommandInterceptor>();

	constructor(
		private readonly view: BrowserView,
		readonly logService: ILogService
	) {
		super();

		this._electronDebugger = view.webContents.debugger;
		this.targetId = view.webContents.getOrCreateDevToolsTargetId();

		this._messageHandler = (_event: Electron.Event, method: string, params: unknown, sessionId?: string) => {
			this.routeCDPEvent(method, params, sessionId);
		};
	}

	async attach(): Promise<ICDPConnection> {
		return this.attachToTarget(this.targetId);
	}

	async attachToTarget(targetId: string): Promise<ICDPConnection> {
		this.ensureAttached();
		const result = await this._electronDebugger.sendCommand('Target.attachToTarget', {
			targetId,
			flatten: true
		}) as { sessionId: string };

		if (!this._sessions.has(result.sessionId)) {
			throw new Error(`Failed to attach to target ${targetId}`);
		}

		return this._sessions.get(result.sessionId)!;
	}

	async getTargetInfo(): Promise<CDPTargetInfo> {
		this.ensureAttached();
		const result = await this._electronDebugger.sendCommand('Target.getTargetInfo') as { targetInfo: CDPTargetInfo };
		return result.targetInfo;
	}

	sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
		const session = sessionId ? this._sessions.get(sessionId) : undefined;
		for (const interceptor of this._interceptors) {
			const result = interceptor(method, params, session);
			if (result !== undefined) {
				return result;
			}
		}

		if (method === 'Emulation.setDeviceMetricsOverride') {
			return Promise.resolve({});
		}

		return this.sendCommandRaw(method, params, sessionId);
	}

	sendCommandRaw(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
		this.ensureAttached();
		const resultPromise = this._electronDebugger.sendCommand(method, params, sessionId);

		if (method === 'Page.handleJavaScriptDialog') {
			this.view.webContents.emit('-cancel-dialogs');
		}

		return resultPromise;
	}

	registerCommandInterceptor(interceptor: CDPCommandInterceptor): IDisposable {
		this._interceptors.add(interceptor);
		return toDisposable(() => this._interceptors.delete(interceptor));
	}

	private ensureAttached(): void {
		if (this._electronDebugger.isAttached()) {
			return;
		}

		this._electronDebugger.on('message', this._messageHandler);
		this._electronDebugger.attach('1.3');

		this._electronDebugger.sendCommand('Target.setAutoAttach', {
			autoAttach: true,
			flatten: true,
			waitForDebuggerOnStart: false
		}).catch(() => { });
		this._electronDebugger.sendCommand('Target.setDiscoverTargets', {
			discover: true
		}).catch(() => { });
	}

	private detachElectronDebugger(): void {
		try {
			if (this.view.webContents.isDestroyed() || !this._electronDebugger.isAttached()) {
				return;
			}

			this._electronDebugger.removeListener('message', this._messageHandler);
			this._electronDebugger.detach();
		} catch {
		}
	}

	private routeCDPEvent(method: string, params: unknown, sessionId?: string): void {
		if (method === 'Target.attachedToTarget') {
			const p = params as { sessionId: string; targetInfo: CDPTargetInfo; waitingForDebugger: boolean };
			this.registerSession(p.sessionId, p.targetInfo, p.waitingForDebugger, sessionId);
		} else if (method === 'Target.detachedFromTarget') {
			const p = params as { sessionId: string };
			this._sessions.deleteAndDispose(p.sessionId);
		} else if (method === 'Target.targetDestroyed') {
			const p = params as { targetId: string };
			this.destroyTarget(p.targetId);
		} else if (method === 'Target.targetInfoChanged' && !sessionId) {
			const p = params as { targetInfo: CDPTargetInfo };
			if (this._knownTargets.has(p.targetInfo.targetId)) {
				this._knownTargets.set(p.targetInfo.targetId, p.targetInfo);
				this._onTargetInfoChanged.fire(p.targetInfo);
			}
		} else if (method === 'Debugger.paused') {
			this._isPaused = true;
		} else if (method === 'Debugger.resumed') {
			this._isPaused = false;
		}

		const session = sessionId ? this._sessions.get(sessionId) : undefined;
		if (session) {
			session.emitEvent({ method, params, sessionId });
		}
	}

	private destroyTarget(targetId: string): void {
		const toDispose: string[] = [];
		for (const [sessionId, session] of this._sessions) {
			if (session.targetId === targetId) {
				toDispose.push(sessionId);
			}
		}
		for (const sessionId of toDispose) {
			this._sessions.deleteAndDispose(sessionId);
		}

		if (this._knownTargets.delete(targetId)) {
			this._onTargetDestroyed.fire(targetId);
		}
	}

	private registerSession(sessionId: string, targetInfo: CDPTargetInfo, waitingForDebugger: boolean, parentSessionId: string | undefined): DebugSession {
		if (!this._knownTargets.has(targetInfo.targetId) && targetInfo.targetId !== this.targetId) {
			this._knownTargets.set(targetInfo.targetId, targetInfo);
			this._onTargetDiscovered.fire(targetInfo);
		}

		if (this._sessions.has(sessionId)) {
			return this._sessions.get(sessionId)!;
		}

		const session = new DebugSession(parentSessionId, sessionId, targetInfo.targetId, this);
		this._sessions.set(sessionId, session);
		session.onClose(() => this._sessions.deleteAndDispose(sessionId));

		this._onSessionCreated.fire({ session, waitingForDebugger });

		return session;
	}

	override dispose(): void {
		this.detachElectronDebugger();
		super.dispose();
	}
}

class DebugSession extends Disposable implements ICDPConnection {
	private readonly _onEvent = this._register(new Emitter<CDPEvent>());
	readonly onEvent = this._onEvent.event;
	readonly emitEvent = (event: CDPEvent) => this._onEvent.fire(event);

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose = this._onClose.event;

	private _isDisposed = false;

	constructor(
		public readonly parentSessionId: string | undefined,
		public readonly sessionId: string,
		public readonly targetId: string,
		private readonly _debugger: BrowserViewDebugger,
	) {
		super();
	}

	async sendCommand(method: string, params?: unknown): Promise<unknown> {
		return this._debugger.sendCommand(method, params, this.sessionId);
	}

	override dispose(): void {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;

		this._onClose.fire();
		super.dispose();
	}
}
