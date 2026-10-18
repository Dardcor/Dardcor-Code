/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ICDPTarget, CDPRequest, CDPResponse, CDPEvent, CDPError, CDPErrorCode, CDPServerError, CDPMethodNotFoundError, CDPInvalidParamsError, ICDPConnection, ICDPBrowserTarget } from './types.js';

export class CDPBrowserProxy extends Disposable implements ICDPConnection {
	readonly sessionId = `browser-session-${generateUuid()}`;
	get targetId() {
		return this.browserTarget.targetInfo.targetId;
	}

	private _isAttachedToBrowserTarget = false;
	private _autoAttach = false;
	private _discover = false;

	private readonly _sessions = this._register(new DisposableMap<string, ICDPConnection>());
	private readonly _targets = this._register(new DisposableMap<string, ICDPTarget>());

	private readonly _autoAttachments = new WeakSet<ICDPTarget>();

	private readonly _handlers = new Map<string, (params: unknown, sessionId?: string) => Promise<object> | object>([
		['Browser.addPrivacySandboxCoordinatorKeyConfig', () => ({})],
		['Browser.addPrivacySandboxEnrollmentOverride', () => ({})],
		['Browser.close', () => ({})],
		['Browser.getVersion', () => this.browserTarget.getVersion()],
		['Browser.resetPermissions', () => ({})],
		['Browser.getWindowForTarget', (p, s) => this.handleBrowserGetWindowForTarget(p as { targetId?: string; sessionId?: string }, s)],
		['Browser.setDownloadBehavior', () => ({})],
		['Browser.setWindowBounds', () => ({})],
		['Target.activateTarget', (p) => this.handleTargetActivateTarget(p as { targetId: string })],
		['Target.attachToTarget', (p) => this.handleTargetAttachToTarget(p as { targetId: string; flatten?: boolean })],
		['Target.closeTarget', (p) => this.handleTargetCloseTarget(p as { targetId: string })],
		['Target.createBrowserContext', () => this.handleTargetCreateBrowserContext()],
		['Target.createTarget', (p) => this.handleTargetCreateTarget(p as { url?: string; browserContextId?: string })],
		['Target.detachFromTarget', (p) => this.handleTargetDetachFromTarget(p as { sessionId: string })],
		['Target.disposeBrowserContext', (p) => this.handleTargetDisposeBrowserContext(p as { browserContextId: string })],
		['Target.getBrowserContexts', () => this.handleTargetGetBrowserContexts()],
		['Target.getTargets', () => this.handleTargetGetTargets()],
		['Target.setAutoAttach', (p, s) => this.handleTargetSetAutoAttach(p as { autoAttach?: boolean; flatten?: boolean }, s)],
		['Target.setDiscoverTargets', (p) => this.handleTargetSetDiscoverTargets(p as { discover?: boolean })],
		['Target.attachToBrowserTarget', () => this.handleTargetAttachToBrowserTarget()],
		['Target.getTargetInfo', (p) => this.handleTargetGetTargetInfo(p as { targetId?: string } | undefined)],
	]);

	constructor(
		private readonly browserTarget: ICDPBrowserTarget,
	) {
		super();
	}

	registerTarget(target: ICDPTarget): void {
		const targetInfo = target.targetInfo;
		if (this._targets.has(targetInfo.targetId)) {
			return;
		}
		this._targets.set(targetInfo.targetId, target);

		if (this._discover) {
			this.sendEvent('Target.targetCreated', {
				targetInfo: target.targetInfo,
			});
		}
		if (this._autoAttach && !this._autoAttachments.has(target)) {
			this._autoAttachments.add(target);
			void target.attach();
		}

		target.onClose(() => {
			this._targets.deleteAndDispose(targetInfo.targetId);
			if (this._discover) {
				this.sendEvent('Target.targetDestroyed', { targetId: targetInfo.targetId });
			}
		});

		target.onTargetInfoChanged(info => {
			if (this._discover) {
				this.sendEvent('Target.targetInfoChanged', { targetInfo: info });
			}
		});

		for (const [, session] of target.sessions) {
			this.registerSession(session, false);
		}
		target.onSessionCreated(({ session, waitingForDebugger }) => {
			this.registerSession(session, waitingForDebugger);
		});
	}

	notifySessionCreated(session: ICDPConnection, waitingForDebugger: boolean): void {
		if (this._sessions.has(session.sessionId)) {
			return;
		}
		if (!session.parentSessionId) {
			return;
		}
		if (!this._sessions.has(session.parentSessionId)) {
			return;
		}
		const target = this._targets.get(session.targetId);
		if (!target) {
			return;
		}
		target.notifySessionCreated(session, waitingForDebugger);
	}

	private registerSession(session: ICDPConnection, waitingForDebugger: boolean): void {
		if (this._sessions.has(session.sessionId)) {
			return;
		}
		this._sessions.set(session.sessionId, session);

		const target = this._targets.get(session.targetId);
		if (!target) {
			throw new CDPServerError(`Unable to resolve target for session ${session.sessionId}`);
		}

		this.sendEvent('Target.attachedToTarget', {
			sessionId: session.sessionId,
			targetInfo: target.targetInfo,
			waitingForDebugger
		}, session.parentSessionId);

		session.onEvent(event => {
			if (event.method.startsWith('Target.')) {
				return;
			}
			this.sendEvent(event.method, event.params, event.sessionId ?? session.sessionId);
		});

		session.onClose(() => {
			this._sessions.deleteAndDispose(session.sessionId);

			this.sendEvent('Target.detachedFromTarget', {
				sessionId: session.sessionId,
				targetId: session.targetId
			}, session.parentSessionId);
		});
	}

	private sendEvent(method: string, params: unknown, sessionId?: string): void {
		sessionId ||= (this._isAttachedToBrowserTarget ? this.sessionId : undefined);
		this._onMessage.fire({ method, params, sessionId });
		this._onEvent.fire({ method, params, sessionId });
	}


	private readonly _onEvent = this._register(new Emitter<CDPEvent>());
	readonly onEvent: Event<CDPEvent> = this._onEvent.event;
	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose: Event<void> = this._onClose.event;
	private readonly _onMessage = this._register(new Emitter<CDPResponse | CDPEvent>());
	readonly onMessage: Event<CDPResponse | CDPEvent> = this._onMessage.event;

	async sendCommand(method: string, params: unknown = {}, sessionId?: string): Promise<unknown> {
		try {
			if (
				!sessionId ||
				sessionId === this.sessionId ||
				method.startsWith('Browser.') ||
				method.startsWith('Target.')
			) {
				const handler = this._handlers.get(method);
				if (!handler) {
					throw new CDPMethodNotFoundError(method);
				}
				return await handler(params, sessionId);
			}

			const connection = this._sessions.get(sessionId);
			if (!connection) {
				throw new CDPServerError(`Session not found: ${sessionId}`);
			}

			const result = await connection.sendCommand(method, params);
			return result ?? {};
		} catch (error) {
			if (error instanceof CDPError) {
				throw error;
			}
			throw new CDPServerError(error instanceof Error ? error.message : 'Unknown error');
		}
	}

	async sendMessage({ id, method, params, sessionId }: CDPRequest): Promise<void> {
		return this.sendCommand(method, params, sessionId)
			.then(result => {
				this._onMessage.fire({ id, result, sessionId });
			})
			.catch((error: Error) => {
				this._onMessage.fire({
					id,
					error: {
						code: error instanceof CDPError ? error.code : CDPErrorCode.ServerError,
						message: error.message || 'Unknown error'
					},
					sessionId
				});
			});
	}



	private handleBrowserGetWindowForTarget({ targetId }: { targetId?: string }, sessionId?: string) {
		const resolvedTargetId = (sessionId && this._sessions.get(sessionId)?.targetId) ?? targetId;
		if (!resolvedTargetId) {
			throw new CDPServerError('Unable to resolve target');
		}

		const target = this._targets.get(resolvedTargetId);
		if (!target) {
			throw new CDPServerError('Unable to resolve target');
		}

		return this.browserTarget.getWindowForTarget(target);
	}

	private handleTargetGetBrowserContexts() {
		return { browserContextIds: this.browserTarget.getBrowserContexts() };
	}

	private async handleTargetCreateBrowserContext() {
		const browserContextId = await this.browserTarget.createBrowserContext();
		return { browserContextId };
	}

	private async handleTargetDisposeBrowserContext({ browserContextId }: { browserContextId: string }) {
		await this.browserTarget.disposeBrowserContext(browserContextId);
		return {};
	}

	private handleTargetAttachToBrowserTarget() {
		this.sendEvent('Target.attachedToTarget', {
			sessionId: this.sessionId,
			targetInfo: this.browserTarget.targetInfo,
			waitingForDebugger: false
		});
		this._isAttachedToBrowserTarget = true;
		return { sessionId: this.sessionId };
	}

	private handleTargetActivateTarget({ targetId }: { targetId: string }) {
		const target = this._targets.get(targetId);
		if (!target) {
			throw new CDPServerError('Unable to resolve target');
		}
		return this.browserTarget.activateTarget(target);
	}

	private async handleTargetSetAutoAttach(params: { autoAttach?: boolean; flatten?: boolean }, sessionId?: string) {
		if (sessionId && sessionId !== this.sessionId) {
			const connection = this._sessions.get(sessionId);
			if (!connection) {
				throw new CDPServerError(`Session not found: ${sessionId}`);
			}
			return connection.sendCommand('Target.setAutoAttach', params);
		}

		if (!params.flatten) {
			throw new CDPInvalidParamsError('This implementation only supports auto-attach with flatten=true');
		}

		this._autoAttach = params.autoAttach ?? false;

		return {};
	}

	private async handleTargetSetDiscoverTargets({ discover = false }: { discover?: boolean }) {
		if (discover !== this._discover) {
			this._discover = discover;

			if (this._discover) {
				for (const target of this._targets.values()) {
					this.sendEvent('Target.targetCreated', { targetInfo: target.targetInfo });
				}
			}
		}

		return {};
	}

	private async handleTargetGetTargets() {
		return { targetInfos: Array.from(this._targets.values()).map(target => target.targetInfo) };
	}

	private async handleTargetGetTargetInfo({ targetId }: { targetId?: string } = {}) {
		if (!targetId) {
			return { targetInfo: this.browserTarget.targetInfo };
		}

		const target = this._targets.get(targetId);
		if (!target) {
			throw new CDPServerError('Unable to resolve target');
		}
		return { targetInfo: target.targetInfo };
	}

	private async handleTargetAttachToTarget({ targetId, flatten }: { targetId: string; flatten?: boolean }) {
		if (!flatten) {
			throw new CDPInvalidParamsError('This implementation only supports attachToTarget with flatten=true');
		}

		const target = this._targets.get(targetId);
		if (!target) {
			throw new CDPServerError('Unable to resolve target');
		}
		const connection = await target.attach();
		return { sessionId: connection.sessionId };
	}

	private async handleTargetDetachFromTarget({ sessionId }: { sessionId: string }) {
		const connection = this._sessions.get(sessionId);
		if (!connection) {
			throw new CDPServerError(`Session not found: ${sessionId}`);
		}

		connection.dispose();
		return {};
	}

	private async handleTargetCreateTarget({ url, browserContextId }: { url?: string; browserContextId?: string }) {
		const target = await this.browserTarget.createTarget(url || 'about:blank', browserContextId);
		this.registerTarget(target);

		if (this._autoAttach && !this._autoAttachments.has(target)) {
			this._autoAttachments.add(target);
			await target.attach();
		}

		return { targetId: target.targetInfo.targetId };
	}

	private async handleTargetCloseTarget({ targetId }: { targetId: string }) {
		try {
			const target = this._targets.get(targetId);
			if (!target) {
				throw new CDPServerError('Unable to resolve target');
			}
			await this.browserTarget.closeTarget(target);
			return { success: true };
		} catch {
			return { success: false };
		}
	}

}
