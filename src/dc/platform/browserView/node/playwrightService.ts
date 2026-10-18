/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, IDisposable } from '../../../base/common/lifecycle.js';
import { DeferredPromise, disposableTimeout, raceTimeout } from '../../../base/common/async.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { ILogService } from '../../log/common/log.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { IAgentNetworkFilterService } from '../../networkFilter/common/networkFilterService.js';
import { attachPlaywrightPageToGroups, IInvokeFunctionResult, IPlaywrightService, isBrowserDocumentReadyState, matchPlaywrightTargetToView } from '../common/playwrightService.js';
import { IBrowserViewGroupRemoteService } from '../node/browserViewGroupRemoteService.js';
import { IBrowserViewGroup } from '../common/browserViewGroup.js';
import { PlaywrightTab, DialogInterruptedError } from './playwrightTab.js';
import { CDPRequest, CDPResponse } from '../common/cdp/types.js';
import { generateUuid } from '../../../base/common/uuid.js';

// eslint-disable-next-line local/code-import-patterns
import type { Browser, BrowserContext, CDPSession, ConnectOverCDPTransport, Page } from 'playwright-core';

export interface IPlaywrightActionScope {
	activeCalls: number;
}

const DEFERRED_RESULT_CLEANUP_MS = 5 * 60_000;
const SESSION_INACTIVITY_MS = 30 * 60_000;
const OPEN_PAGE_NAVIGATION_TIMEOUT_MS = 30_000;

function isCDPRequest(message: object): message is CDPRequest {
	const candidate = message as Partial<CDPRequest>;
	return typeof candidate.id === 'number'
		&& typeof candidate.method === 'string'
		&& (candidate.sessionId === undefined || typeof candidate.sessionId === 'string');
}



export class PlaywrightService extends Disposable implements IPlaywrightService {
	declare readonly _serviceBrand: undefined;

	private readonly _sessions = this._register(new DisposableMap<string, PlaywrightSession>());

	private readonly _pendingInits = new Map<string, Promise<PlaywrightSession>>();
	private readonly _pendingPageTracking = new Map<string, Promise<void>>();

	private readonly _inactivityTimers = this._register(new DisposableMap<string, IDisposable>());

	private readonly _trackedPages = new Set<string>();

	private readonly _onDidChangeTrackedPages = this._register(new Emitter<readonly string[]>());
	readonly onDidChangeTrackedPages: Event<readonly string[]> = this._onDidChangeTrackedPages.event;

	constructor(
		private readonly windowId: number,
		private readonly browserViewGroupRemoteService: IBrowserViewGroupRemoteService,
		private readonly logService: ILogService,
		private readonly agentNetworkFilterService: IAgentNetworkFilterService,
		private readonly telemetryService: ITelemetryService,
	) {
		super();
	}

	private async _getOrCreateSession(sessionId: string): Promise<PlaywrightSession> {
		const existing = this._sessions.get(sessionId);
		if (existing) {
			this._touchSession(sessionId);
			return existing;
		}

		const pending = this._pendingInits.get(sessionId);
		if (pending) {
			return pending;
		}

		const initPromise = this._initSession(sessionId);
		this._pendingInits.set(sessionId, initPromise);
		try {
			return await initPromise;
		} finally {
			this._pendingInits.delete(sessionId);
		}
	}

	private async _initSession(sessionId: string): Promise<PlaywrightSession> {
		this.logService.debug(`[PlaywrightService] Initializing session ${sessionId}`);

		const group = await this.browserViewGroupRemoteService.createGroup({ type: 'agent', mainWindowId: this.windowId, sessionId });

		const actionScope: IPlaywrightActionScope = { activeCalls: 0 };

		let browser: Browser;
		try {
			const playwright = await import('playwright-core');
			const sub = group.onCDPMessage(msg => transport.onmessage?.(msg));
			const transport: ConnectOverCDPTransport = {
				close() {
					sub.dispose();
					this.onclose?.();
				},
				send: (rawMessage) => {
					if (!isCDPRequest(rawMessage)) {
						throw new Error(`[PlaywrightService] Unexpected CDP transport payload for session ${sessionId} (type: ${typeof rawMessage})`);
					}
					const message = rawMessage;
					if (actionScope.activeCalls === 0 && message.method.startsWith('Emulation.')) {
						setTimeout(() => {
							transport.onmessage?.({ id: message.id, result: {}, sessionId: message.sessionId } satisfies CDPResponse);
						}, 1);
						return;
					}
					void group.sendCDPMessage(message);
				}
			};
			browser = await playwright.chromium.connectOverCDP(transport);
		} catch (e) {
			group.dispose();
			throw e;
		}

		this.logService.debug(`[PlaywrightService] Connected to browser for session ${sessionId}`);

		if (this._store.isDisposed) {
			browser.close().catch(() => { });
			group.dispose();
			throw new Error('PlaywrightService was disposed during initialization');
		}

		const session = new PlaywrightSession(
			sessionId,
			browser,
			group,
			actionScope,
			this.logService,
			this.agentNetworkFilterService,
			this.telemetryService,
			viewId => this.startTrackingPage(viewId),
		);


		session.registerDisposable(group.onDidAddView(e => {
			if (!this._trackedPages.has(e.viewId)) {
				this._trackedPages.add(e.viewId);
				this._fireTrackedPages();
			}
			for (const [id, other] of this._sessions) {
				if (id !== sessionId) {
					void other.group.addView(e.viewId).catch(() => { });
				}
			}
		}));
		session.registerDisposable(group.onDidRemoveView(e => {
			if (this._trackedPages.delete(e.viewId)) {
				this._fireTrackedPages();
			}
		}));

		browser.on('disconnected', () => {
			this.logService.debug(`[PlaywrightService] Browser disconnected for session ${sessionId}`);
			this._sessions.deleteAndDispose(sessionId);
			this._inactivityTimers.deleteAndDispose(sessionId);
		});

		this._sessions.set(sessionId, session);

		for (const viewId of [...this._trackedPages]) {
			try {
				await session.group.addView(viewId);
			} catch {
				this.logService.debug(`[PlaywrightService] Stale tracked page ${viewId} removed during replay`);
				this._trackedPages.delete(viewId);
				this._fireTrackedPages();
			}
		}

		this._touchSession(sessionId);
		return session;
	}


	async startTrackingPage(viewId: string): Promise<void> {
		const pending = this._pendingPageTracking.get(viewId);
		if (pending) {
			await pending;
			return;
		}

		const sessions = [...this._sessions.values()];
		if (!this._trackedPages.has(viewId)) {
			this._trackedPages.add(viewId);
			this._fireTrackedPages();
		}



		const tracking = attachPlaywrightPageToGroups(viewId, sessions.map(session => session.group));
		this._pendingPageTracking.set(viewId, tracking);
		try {
			await tracking;
		} catch (error) {
			this._trackedPages.delete(viewId);
			this._fireTrackedPages();
			throw error;
		} finally {
			if (this._pendingPageTracking.get(viewId) === tracking) {
				this._pendingPageTracking.delete(viewId);
			}
		}
	}

	async stopTrackingPage(viewId: string): Promise<void> {
		if (this._trackedPages.delete(viewId)) {
			this._fireTrackedPages();
		}
		for (const session of this._sessions.values()) {
			session.group.removeView(viewId);
		}
	}

	async isPageTracked(viewId: string): Promise<boolean> {
		return this._trackedPages.has(viewId);
	}

	async waitForPageReady(sessionId: string, pageId: string, timeoutMs = 15000): Promise<{ url: string; title: string; readyState: string }> {
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			throw new Error('Browser readiness timeout must be a positive number of milliseconds.');
		}
		const session = await this._getOrCreateSession(sessionId);
		return session.waitForPageReady(pageId, timeoutMs);
	}

	async getTrackedPages(): Promise<readonly string[]> {
		return [...this._trackedPages];
	}


	async openPage(sessionId: string, url: string): Promise<{ pageId: string; summary: string }> {
		const session = await this._getOrCreateSession(sessionId);
		return session.openPage(url);
	}

	async getSummary(sessionId: string, pageId: string): Promise<string> {
		const session = await this._getOrCreateSession(sessionId);
		return session.getSummary(pageId);
	}

	async getAndClearDiagnostics(sessionId: string, pageId: string): Promise<readonly string[]> {
		const session = await this._getOrCreateSession(sessionId);
		return session.getAndClearDiagnostics(pageId);
	}

	async invokeFunctionRaw<T>(sessionId: string, pageId: string, fnDef: string, ...args: unknown[]): Promise<T> {
		const session = await this._getOrCreateSession(sessionId);
		return session.invokeFunctionRaw(pageId, fnDef, ...args);
	}

	async invokeFunction(sessionId: string, pageId: string, fnDef: string, args: unknown[] = [], timeoutMs?: number): Promise<IInvokeFunctionResult> {
		const session = await this._getOrCreateSession(sessionId);
		return session.invokeFunction(pageId, fnDef, args, timeoutMs);
	}

	async waitForDeferredResult(sessionId: string, deferredResultId: string, timeoutMs: number): Promise<IInvokeFunctionResult> {
		const session = await this._getOrCreateSession(sessionId);
		return session.waitForDeferredResult(deferredResultId, timeoutMs);
	}

	async replyToFileChooser(sessionId: string, pageId: string, files: string[]): Promise<{ summary: string }> {
		const session = await this._getOrCreateSession(sessionId);
		return session.replyToFileChooser(pageId, files);
	}

	async replyToDialog(sessionId: string, pageId: string, accept: boolean, promptText?: string): Promise<{ summary: string }> {
		const session = await this._getOrCreateSession(sessionId);
		return session.replyToDialog(pageId, accept, promptText);
	}


	async disposeSession(sessionId: string): Promise<void> {
		if (this._sessions.has(sessionId)) {
			this.logService.debug(`[PlaywrightService] Disposing session ${sessionId}`);
			this._sessions.deleteAndDispose(sessionId);
			this._inactivityTimers.deleteAndDispose(sessionId);
		}
	}


	private _fireTrackedPages(): void {
		this._onDidChangeTrackedPages.fire([...this._trackedPages]);
	}

	private _touchSession(sessionId: string): void {
		this._inactivityTimers.deleteAndDispose(sessionId);
		const timer = disposableTimeout(
			() => {
				this.logService.debug(`[PlaywrightService] Session ${sessionId} inactive for ${SESSION_INACTIVITY_MS / 60_000}m, disposing`);
				this._sessions.deleteAndDispose(sessionId);
				this._inactivityTimers.deleteAndDispose(sessionId);
			},
			SESSION_INACTIVITY_MS,
		);
		this._inactivityTimers.set(sessionId, timer);
	}
}

class PlaywrightSession extends Disposable {


	private readonly _viewIdToPage = new Map<string, Page>();
	private readonly _pageToViewId = new WeakMap<Page, string>();
	private readonly _viewIdToTargetId = new Map<string, string>();
	private readonly _viewTargetUrls = new Map<string, string>();
	private readonly _tabs = new WeakMap<Page, PlaywrightTab>();
	private readonly _pendingPageMatches = new WeakMap<Page, Promise<string>>();

	private _viewIdQueue: Array<{ viewId: string; page: DeferredPromise<Page> }> = [];

	private _pageQueue: Array<{ page: Page; targetId?: string; url: string; viewId: DeferredPromise<string> }> = [];

	private readonly _watchedContexts = new WeakSet<BrowserContext>();
	private _scanTimer: ReturnType<typeof setInterval> | undefined;
	private _openContext: BrowserContext | undefined = undefined;

	private readonly _deferredResults = this._register(new DisposableMap<string, {
		pageId: string;
		promise: Promise<unknown>;
		logCtx?: IExecutionLogContext;
	} & IDisposable>());

	constructor(
		readonly sessionId: string,
		private _browser: Browser,
		readonly group: IBrowserViewGroup,
		private readonly actionScope: IPlaywrightActionScope,
		private readonly logService: ILogService,
		private readonly agentNetworkFilterService: IAgentNetworkFilterService,
		private readonly telemetryService: ITelemetryService,
		private readonly onDidCreatePage: (viewId: string) => Promise<void>,
	) {
		super();

		this._register(this.group);
		this._register(this.group.onDidAddView(e => this._onViewAdded(e.viewId, e.targetId, e.url)));
		this._register(this.group.onDidRemoveView(e => this._onViewRemoved(e.viewId)));

		this._scanForNewContexts();
	}

	registerDisposable(d: IDisposable): void {
		this._register(d);
	}


	async openPage(url: string): Promise<{ pageId: string; summary: string }> {
		if (!this._openContext) {
			this._openContext = await this._browser.newContext();
			this._onContextAdded(this._openContext);
		}

		const page = await this._openContext.newPage();
		const viewId = await this._onPageAdded(page);
		await this.onDidCreatePage(viewId);

		if (url && url !== 'about:blank' && page.url() !== url) {
			try {
				await page.goto(url, { waitUntil: 'domcontentloaded', timeout: OPEN_PAGE_NAVIGATION_TIMEOUT_MS });
			} catch (error) {
				if (!isNavigationTimeoutError(error)) {
					throw error;
				}

				throw new Error(`Navigation to ${url} timed out after ${OPEN_PAGE_NAVIGATION_TIMEOUT_MS} ms. The page (ID: ${viewId}) is open and can be reused.`);
			}
		}

		const summary = await this._getSummary(viewId);
		return { pageId: viewId, summary };
	}

	async getSummary(pageId: string): Promise<string> {
		return this._getSummary(pageId, true);
	}

	async getAndClearDiagnostics(pageId: string): Promise<readonly string[]> {
		const page = await this._getPage(pageId);
		const tab = this._tabs.get(page);
		if (!tab) {
			throw new Error(`Playwright diagnostics are unavailable for page "${pageId}".`);
		}
		return tab.getAndClearDiagnostics();
	}

	async waitForPageReady(pageId: string, timeoutMs: number): Promise<{ url: string; title: string; readyState: string }> {
		const page = await this._getPage(pageId, timeoutMs);
		if (page.isClosed()) {
			throw new Error(`Integrated browser page "${pageId}" closed before it became ready.`);
		}

		try {
			await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
			await page.waitForFunction(() => !!document.documentElement && (document.readyState === 'interactive' || document.readyState === 'complete'), undefined, { timeout: timeoutMs });
			const state = await page.evaluate(() => ({ url: location.href, title: document.title, readyState: document.readyState }));
			if (!isBrowserDocumentReadyState(state.readyState)) {
				throw new Error('The document is still loading after Playwright reported DOMContentLoaded.');
			}
			return state;
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(`Integrated browser page "${pageId}" did not become ready within ${timeoutMs} ms: ${detail}`);
		}
	}

	async invokeFunctionRaw<T>(pageId: string, fnDef: string, ...args: unknown[]): Promise<T> {
		const fn = await this._compileFunction(fnDef);
		return this._runAgainstPage(pageId, (page) => fn(page, args) as T);
	}

	async invokeFunction(pageId: string, fnDef: string, args: unknown[] = [], timeoutMs?: number): Promise<IInvokeFunctionResult> {
		this.logService.info(`[PlaywrightSession] Invoking function on view ${pageId}`);

		const logCtx: IExecutionLogContext = {
			startedAt: Date.now(),
			codeLength: fnDef.length,
			codeLineCount: fnDef.split('\n').length,
			pageMethodsCalled: new Map<string, number>(),
			wasDeferred: false,
			resumeCount: 0,
			logged: false,
		};

		let fn;
		try {
			fn = await this._compileFunction(fnDef);
		} catch (err: unknown) {
			this._logExecution(logCtx, false);
			const summary = await this._getSummary(pageId);
			return { error: err instanceof Error ? err.message : String(err), summary };
		}
		const wrappedCallback = async (page: Page) => fn(createPageApiProxy(page, logCtx.pageMethodsCalled), args);

		if (timeoutMs !== undefined) {
			return this._runWithDeferral(pageId, wrappedCallback, timeoutMs, undefined, logCtx);
		}

		let result, error;
		try {
			result = await this._runAgainstPage(pageId, wrappedCallback);
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
		}

		this._logExecution(logCtx, !error);
		const summary = await this._getSummary(pageId);
		return { result, error, summary };
	}

	async waitForDeferredResult(deferredResultId: string, timeoutMs: number): Promise<IInvokeFunctionResult> {
		const entry = this._deferredResults.get(deferredResultId);
		if (!entry) {
			throw new Error(`No deferred result found with ID "${deferredResultId}". It may have been cleaned up or already consumed.`);
		}

		const { pageId, promise, logCtx } = entry;
		if (logCtx) {
			logCtx.resumeCount++;
		}
		this._deferredResults.deleteAndDispose(deferredResultId);
		return this._runWithDeferral(pageId, () => promise, timeoutMs, deferredResultId, logCtx);
	}

	async replyToFileChooser(pageId: string, files: string[]): Promise<{ summary: string }> {
		const page = await this._getPage(pageId);
		const tab = this._tabs.get(page);
		if (!tab) {
			throw new Error('Failed to reply to file chooser');
		}
		await tab.replyToFileChooser(files);
		const summary = await tab.getSummary();
		return { summary };
	}

	async replyToDialog(pageId: string, accept: boolean, promptText?: string): Promise<{ summary: string }> {
		const page = await this._getPage(pageId);
		const tab = this._tabs.get(page);
		if (!tab) {
			throw new Error('Failed to reply to dialog');
		}
		await tab.replyToDialog(accept, promptText);
		const summary = await tab.getSummary();
		return { summary };
	}


	private async _getSummary(pageId: string, full = false): Promise<string> {
		const page = await this._getPage(pageId);
		const tab = this._tabs.get(page);
		if (!tab) {
			throw new Error('Failed to get page summary');
		}
		return tab.getSummary(full);
	}

	private async _runAgainstPage<T>(pageId: string, callback: (page: Page) => T | Promise<T>): Promise<T> {
		const page = await this._getPage(pageId);
		const tab = this._tabs.get(page);
		if (!tab) {
			throw new Error('Failed to execute function against page');
		}
		return tab.safeRunAgainstPage(async () => callback(page));
	}

	private async _runWithDeferral(pageId: string, callback: (page: Page) => Promise<unknown>, timeoutMs: number, existingDeferredId?: string, logCtx?: IExecutionLogContext): Promise<IInvokeFunctionResult> {
		const deferred = new DeferredPromise();

		if (existingDeferredId === undefined && logCtx) {
			deferred.p.then(() => this._logExecution(logCtx, true), () => this._logExecution(logCtx, false));
		}

		const wrappedPromise = this._runAgainstPage(pageId, async (page) => {
			const promise = callback(page);
			promise.catch(() => { });
			deferred.settleWith(promise);
			return promise;
		});

		let result, error;
		let interrupted = false;

		try {
			result = await raceTimeout(wrappedPromise, timeoutMs, () => { interrupted = true; });
		} catch (err: unknown) {
			if (err instanceof DialogInterruptedError) {
				interrupted = true;
			}
			error = err instanceof Error ? err.message : String(err);
		}

		let deferredResultId: string | undefined;
		if (interrupted) {
			if (logCtx) {
				logCtx.wasDeferred = true;
			}
			deferredResultId = existingDeferredId ?? generateUuid();
			const cleanup = disposableTimeout(() => this._deferredResults.deleteAndDispose(deferredResultId!), DEFERRED_RESULT_CLEANUP_MS);
			this._deferredResults.set(deferredResultId, { pageId, promise: deferred.p, logCtx, dispose: () => cleanup.dispose() });
			this.logService.info(`[PlaywrightSession] Execution interrupted, deferred as ${deferredResultId}`);
		} else if (logCtx) {
			this._logExecution(logCtx, !error);
		}

		const summary = await this._getSummary(pageId);
		return { result, error, summary, deferredResultId };
	}

	private _logExecution(ctx: IExecutionLogContext, success: boolean): void {
		if (ctx.logged) {
			return;
		}
		ctx.logged = true;
		const entries = [...ctx.pageMethodsCalled.entries()];
		const total = entries.reduce((sum, [, count]) => sum + count, 0);
		this.telemetryService.publicLog2<RunPlaywrightCodeEvent, RunPlaywrightCodeClassification>(
			'integratedBrowser.tools.runPlaywrightCode.completed',
			{
				pageMethodsCalled: JSON.stringify(Object.fromEntries(entries)),
				pageMethodsCalledDcount: entries.length,
				pageMethodsCalledCount: total,
				success: success ? 1 : 0,
				wasDeferred: ctx.wasDeferred ? 1 : 0,
				resumeCount: ctx.resumeCount,
				durationMs: Math.round(Date.now() - ctx.startedAt),
				codeLength: ctx.codeLength,
				codeLineCount: ctx.codeLineCount,
			}
		);
	}

	private async _compileFunction(fnDef: string): Promise<(page: Page, args: unknown[]) => unknown> {
		const vm = await import('vm');
		return vm.compileFunction(`return (${fnDef})(page, ...args)`, ['page', 'args'], { parsingContext: vm.createContext() }) as (page: Page, args: unknown[]) => unknown;
	}


	private async _getPage(viewId: string, timeoutMs = 10000): Promise<Page> {
		const resolved = this._viewIdToPage.get(viewId);
		if (resolved) {
			return resolved;
		}
		const queued = this._viewIdQueue.find(item => item.viewId === viewId);
		if (queued) {
			return queued.page.p;
		}
		return this._onViewAdded(viewId, undefined, undefined, timeoutMs);
	}

	private _onViewAdded(viewId: string, targetId?: string, url?: string, timeoutMs = 10000): Promise<Page> {
		if (targetId) {
			this._viewIdToTargetId.set(viewId, targetId);
		}
		if (url) {
			this._viewTargetUrls.set(viewId, url);
		}
		const resolved = this._viewIdToPage.get(viewId);
		if (resolved) {
			return Promise.resolve(resolved);
		}
		const queued = this._viewIdQueue.find(item => item.viewId === viewId);
		if (queued) {
			return queued.page.p;
		}

		const deferred = new DeferredPromise<Page>();
		const timeout = setTimeout(() => deferred.error(new Error(`Timed out waiting for page`)), timeoutMs);

		void deferred.p.then(() => {
			clearTimeout(timeout);
			this._viewIdQueue = this._viewIdQueue.filter(item => item.viewId !== viewId);
			if (this._viewIdQueue.length === 0) {
				this._stopScanning();
			}
		}, () => {
			clearTimeout(timeout);
			this._viewIdQueue = this._viewIdQueue.filter(item => item.viewId !== viewId);
			if (this._viewIdQueue.length === 0) {
				this._stopScanning();
			}
		});

		this._viewIdQueue.push({ viewId, page: deferred });
		this._tryMatch();
		this._ensureScanning();

		return deferred.p;
	}

	private _onViewRemoved(viewId: string): void {
		for (const item of this._viewIdQueue.filter(item => item.viewId === viewId)) {
			item.page.error(new Error(`BrowserView "${viewId}" closed before Playwright attached its page.`));
		}
		this._viewIdQueue = this._viewIdQueue.filter(item => item.viewId !== viewId);
		const targetId = this._viewIdToTargetId.get(viewId);
		if (targetId) {
			for (const item of this._pageQueue.filter(item => item.targetId === targetId)) {
				item.viewId.error(new Error(`BrowserView "${viewId}" closed before its Playwright page was attached.`));
			}
			this._pageQueue = this._pageQueue.filter(item => item.targetId !== targetId);
		}
		this._viewIdToTargetId.delete(viewId);
		this._viewTargetUrls.delete(viewId);
		const page = this._viewIdToPage.get(viewId);
		if (page) {
			this._pageToViewId.delete(page);
		}
		this._viewIdToPage.delete(viewId);
	}

	private _onPageAdded(page: Page, timeoutMs = 10000): Promise<string> {
		const resolved = this._pageToViewId.get(page);
		if (resolved) {
			return Promise.resolve(resolved);
		}
		const queued = this._pageQueue.find(item => item.page === page);
		if (queued) {
			return queued.viewId.p;
		}
		const pending = this._pendingPageMatches.get(page);
		if (pending) {
			return pending;
		}

		this._onContextAdded(page.context());
		page.once('close', () => this._onPageRemoved(page));
		page.setDefaultTimeout(10000);
		this._tabs.set(page, new PlaywrightTab(page, this.actionScope, this.agentNetworkFilterService));

		const pendingMatch = (async () => {
			const targetId = await this._resolvePageTargetId(page);
			if (page.isClosed()) {
				throw new Error(`Playwright page ${targetId ? `for target "${targetId}" ` : ''}closed before it was matched.`);
			}
			const url = page.url();
			const deferred = new DeferredPromise<string>();
			const timeout = setTimeout(() => deferred.error(new Error(`Timed out matching Playwright page at "${url || 'unknown URL'}"${targetId ? ` (target ${targetId})` : ''} to its BrowserView.`)), timeoutMs);
			void deferred.p.then(() => clearTimeout(timeout), () => clearTimeout(timeout));
			this._pageQueue.push({ page, targetId, url, viewId: deferred });
			this._tryMatch();
			return deferred.p;
		})();
		this._pendingPageMatches.set(page, pendingMatch);
		void pendingMatch.then(() => this._pendingPageMatches.delete(page), () => this._pendingPageMatches.delete(page));
		return pendingMatch;
	}

	private async _resolvePageTargetId(page: Page): Promise<string | undefined> {
		let cdpSession: CDPSession | undefined;
		try {
			cdpSession = await page.context().newCDPSession(page);
			const result = await cdpSession.send('Target.getTargetInfo') as { targetInfo?: { targetId?: string } };
			const targetId = result?.targetInfo?.targetId;
			if (!targetId) {
				return undefined;
			}
			return targetId;
		} catch (error) {
			this.logService.debug(`[PlaywrightSession] Target identity lookup is unavailable; matching by unique page URL: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		} finally {
			await cdpSession?.detach().catch(() => undefined);
		}
	}

	private _onPageRemoved(page: Page): void {
		for (const item of this._pageQueue.filter(item => item.page === page)) {
			item.viewId.error(new Error('Playwright page closed before it could be matched to its BrowserView.'));
		}
		this._pageQueue = this._pageQueue.filter(item => item.page !== page);
		const viewId = this._pageToViewId.get(page);
		if (viewId) {
			this._viewIdToPage.delete(viewId);
		}
		this._pageToViewId.delete(page);
	}

	private _onContextAdded(context: BrowserContext): void {
		if (this._watchedContexts.has(context)) {
			return;
		}
		this._watchedContexts.add(context);
		context.on('page', (page: Page) => {
			void this._onPageAdded(page).catch(error => this.logService.warn(`[PlaywrightSession] Could not resolve new page identity: ${error instanceof Error ? error.message : String(error)}`));
		});
		context.on('close', () => this._watchedContexts.delete(context));
		for (const page of context.pages()) {
			void this._onPageAdded(page).catch(error => this.logService.warn(`[PlaywrightSession] Could not resolve existing page identity: ${error instanceof Error ? error.message : String(error)}`));
		}
	}


	private _tryMatch(): void {
		for (let pageIndex = this._pageQueue.length - 1; pageIndex >= 0; pageIndex--) {
			const pageItem = this._pageQueue[pageIndex];
			const viewCandidates = this._viewIdQueue.map(item => ({
				viewId: item.viewId,
				targetId: this._viewIdToTargetId.get(item.viewId),
				url: this._viewTargetUrls.get(item.viewId) ?? '',
			}));
			const pageCandidates = this._pageQueue.map(item => ({ targetId: item.targetId, url: item.page.url() || item.url }));
			const viewId = matchPlaywrightTargetToView(pageItem.targetId, pageItem.page.url() || pageItem.url, viewCandidates, pageCandidates);
			if (!viewId) {
				continue;
			}
			const viewIndex = this._viewIdQueue.findIndex(item => item.viewId === viewId);
			if (viewIndex < 0) {
				continue;
			}
			const [viewIdItem] = this._viewIdQueue.splice(viewIndex, 1);
			this._pageQueue.splice(pageIndex, 1);
			this._viewIdToPage.set(viewIdItem.viewId, pageItem.page);
			this._pageToViewId.set(pageItem.page, viewIdItem.viewId);
			viewIdItem.page.complete(pageItem.page);
			pageItem.viewId.complete(viewIdItem.viewId);
			this.logService.debug(`[PlaywrightSession] Matched BrowserView ${viewIdItem.viewId} to Chromium target ${pageItem.targetId}.`);
		}


		if (this._viewIdQueue.length === 1 && this._pageQueue.length === 1) {
			const viewIdItem = this._viewIdQueue.shift()!;
			const pageItem = this._pageQueue.shift()!;
			this._viewIdToPage.set(viewIdItem.viewId, pageItem.page);
			this._pageToViewId.set(pageItem.page, viewIdItem.viewId);
			viewIdItem.page.complete(pageItem.page);
			pageItem.viewId.complete(viewIdItem.viewId);
			this.logService.warn(`[PlaywrightSession] Used unambiguous single-page fallback to match BrowserView ${viewIdItem.viewId}.`);
		}

		if (this._viewIdQueue.length === 0) {
			this._stopScanning();
		}
	}


	private _scanForNewContexts(): void {
		for (const context of this._browser.contexts()) {
			this._onContextAdded(context);
		}
	}

	private _ensureScanning(): void {
		if (this._scanTimer === undefined) {
			this._scanTimer = setInterval(() => this._scanForNewContexts(), 100);
		}
	}

	private _stopScanning(): void {
		if (this._scanTimer !== undefined) {
			clearInterval(this._scanTimer);
			this._scanTimer = undefined;
		}
	}

	override dispose(): void {
		this._stopScanning();
		this._browser?.close().catch(() => { });
		for (const { page } of this._viewIdQueue) {
			page.error(new Error('PlaywrightSession disposed'));
		}
		for (const { viewId } of this._pageQueue) {
			viewId.error(new Error('PlaywrightSession disposed'));
		}
		this._viewIdQueue = [];
		this._pageQueue = [];
		super.dispose();
	}
}

function isNavigationTimeoutError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return error.name === 'TimeoutError'
		|| /Timeout \d+ms exceeded/.test(error.message)
		|| /navigation timeout/i.test(error.message);
}

interface IExecutionLogContext {
	readonly startedAt: number;
	readonly codeLength: number;
	readonly codeLineCount: number;
	readonly pageMethodsCalled: Map<string, number>;
	wasDeferred: boolean;
	resumeCount: number;
	logged: boolean;
}

type RunPlaywrightCodeEvent = {
	pageMethodsCalled: string;
	pageMethodsCalledDcount: number;
	pageMethodsCalledCount: number;
	success: number;
	wasDeferred: number;
	resumeCount: number;
	durationMs: number;
	codeLength: number;
	codeLineCount: number;
};

type RunPlaywrightCodeClassification = {
	pageMethodsCalled: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'JSON object mapping dotted `page.*` method names to their call counts (e.g. `{"click":2,"keyboard.press":5}`), in first-observed order.' };
	pageMethodsCalledDcount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Number of distinct `page.*` methods invoked.' };
	pageMethodsCalledCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Total `page.*` method calls including duplicates (sum of all per-method counts).' };
	success: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: '1 if the code completed without error, 0 otherwise.' };
	wasDeferred: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: '1 if the execution was interrupted and deferred at least once, 0 otherwise.' };
	resumeCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Number of times the caller resumed this execution by polling for its deferred result. 0 means the run either completed within the first timeout or was deferred and never resumed (settled in the background).' };
	durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Wall-clock time in milliseconds from invocation start until the page work settled.' };
	codeLength: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Character length of the executed function source.' };
	codeLineCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Line count of the executed function source.' };
	owner: 'jruales';
	comment: 'Tracks how the run_playwright_code chat tool is exercised.';
};

const PAGE_PROXY_IGNORED_PROPS = new Set<string>([
	'then',
	'catch',
	'finally',
	'toJSON',
	'toString',
	'valueOf',
	'constructor',
]);

const PAGE_PROXY_MAX_DEPTH = 3;

function createPageApiProxy<T extends object>(target: T, methodCalls: Map<string, number>, prefix: string = '', depth: number = 0): T {
	if (depth >= PAGE_PROXY_MAX_DEPTH) {
		return target;
	}
	const cache = new Map<string, unknown>();
	return new Proxy(target, {
		get(t, prop, receiver) {
			const value = Reflect.get(t, prop, receiver);
			if (typeof prop !== 'string' || prop.startsWith('_') || PAGE_PROXY_IGNORED_PROPS.has(prop)) {
				return value;
			}
			const cached = cache.get(prop);
			if (cached !== undefined) {
				return cached;
			}
			if (typeof value === 'function') {
				const name = prefix + prop;
				const wrapper = function (this: unknown, ...args: unknown[]) {
					methodCalls.set(name, (methodCalls.get(name) ?? 0) + 1);
					return Reflect.apply(value as Function, t, args);
				};
				cache.set(prop, wrapper);
				return wrapper;
			}
			if (value !== null && typeof value === 'object') {
				const nested = createPageApiProxy(value as object, methodCalls, `${prefix}${prop}.`, depth + 1);
				cache.set(prop, nested);
				return nested;
			}
			return value;
		},
	});
}
