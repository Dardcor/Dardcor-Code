/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShutdownReason, ILifecycleService, StartupKind } from '../common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { AbstractLifecycleService } from '../common/lifecycleService.js';
import { localize } from '../../../../nls.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { IStorageService, WillSaveStateReason } from '../../../../platform/storage/common/storage.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { mainWindow } from '../../../../base/browser/window.js';

export class BrowserLifecycleService extends AbstractLifecycleService {

	private beforeUnloadListener: IDisposable | undefined = undefined;
	private unloadListener: IDisposable | undefined = undefined;

	private ignoreBeforeUnload = false;

	private didUnload = false;

	constructor(
		@ILogService logService: ILogService,
		@IStorageService storageService: IStorageService
	) {
		super(logService, storageService);

		this.registerListeners();
	}

	private registerListeners(): void {

		this.beforeUnloadListener = addDisposableListener(mainWindow, EventType.BEFORE_UNLOAD, (e: BeforeUnloadEvent) => this.onBeforeUnload(e));

		this.unloadListener = addDisposableListener(mainWindow, EventType.PAGE_HIDE, () => this.onUnload());
	}

	private onBeforeUnload(event: BeforeUnloadEvent): void {

		if (this.ignoreBeforeUnload) {
			this.logService.info('[lifecycle] onBeforeUnload triggered but ignored once');

			this.ignoreBeforeUnload = false;
		}

		else {
			this.logService.info('[lifecycle] onBeforeUnload triggered and handled with veto support');

			this.doShutdown(() => this.vetoBeforeUnload(event));
		}
	}

	private vetoBeforeUnload(event: BeforeUnloadEvent): void {
		event.preventDefault();
		event.returnValue = localize('lifecycleVeto', "Changes that you made may not be saved. Please check press 'Cancel' and try again.");
	}

	withExpectedShutdown(reason: ShutdownReason): Promise<void>;
	withExpectedShutdown(reason: { disableShutdownHandling: true }, callback: Function): void;
	withExpectedShutdown(reason: ShutdownReason | { disableShutdownHandling: true }, callback?: Function): Promise<void> | void {

		if (typeof reason === 'number') {
			this.shutdownReason = reason;

			return this.storageService.flush(WillSaveStateReason.SHUTDOWN);
		}

		else {
			this.ignoreBeforeUnload = true;
			try {
				callback?.();
			} finally {
				this.ignoreBeforeUnload = false;
			}
		}
	}

	async shutdown(): Promise<void> {
		this.logService.info('[lifecycle] shutdown triggered');

		this.beforeUnloadListener?.dispose();
		this.unloadListener?.dispose();

		await this.storageService.flush(WillSaveStateReason.SHUTDOWN);

		this.doShutdown();
	}

	private doShutdown(vetoShutdown?: () => void): void {
		const logService = this.logService;

		this.storageService.flush(WillSaveStateReason.SHUTDOWN);

		let veto = false;

		function handleVeto(vetoResult: boolean | Promise<boolean>, id: string) {
			if (typeof vetoShutdown !== 'function') {
				return;
			}

			if (vetoResult instanceof Promise) {
				logService.error(`[lifecycle] Long running operations before shutdown are unsupported in the web (id: ${id})`);

				veto = true;
			}

			if (vetoResult === true) {
				logService.info(`[lifecycle]: Unload was prevented (id: ${id})`);

				veto = true;
			}
		}

		this._onBeforeShutdown.fire({
			reason: ShutdownReason.QUIT,
			veto(value, id) {
				handleVeto(value, id);
			},
			finalVeto(valueFn, id) {
				handleVeto(valueFn(), id);
			}
		});

		if (veto && typeof vetoShutdown === 'function') {
			return vetoShutdown();
		}

		return this.onUnload();
	}

	private onUnload(): void {
		if (this.didUnload) {
			return;
		}

		this.didUnload = true;
		this._willShutdown = true;

		this._register(addDisposableListener(mainWindow, EventType.PAGE_SHOW, (e: PageTransitionEvent) => this.onLoadAfterUnload(e)));

		const logService = this.logService;
		this._onWillShutdown.fire({
			reason: ShutdownReason.QUIT,
			joiners: () => [],
			token: CancellationToken.None,
			join(promise, joiner) {
				if (typeof promise === 'function') {
					promise();
				}
				logService.error(`[lifecycle] Long running operations during shutdown are unsupported in the web (id: ${joiner.id})`);
			},
			force: () => { },
		});

		this._onDidShutdown.fire();
	}

	private onLoadAfterUnload(event: PageTransitionEvent): void {

		const wasRestoredFromCache = event.persisted;
		if (!wasRestoredFromCache) {
			return;
		}

		this.withExpectedShutdown({ disableShutdownHandling: true }, () => mainWindow.location.reload());
	}

	protected override doResolveStartupKind(): StartupKind | undefined {
		let startupKind = super.doResolveStartupKind();
		if (typeof startupKind !== 'number') {
			const timing = performance.getEntriesByType('navigation').at(0) as PerformanceNavigationTiming | undefined;
			if (timing?.type === 'reload') {
				startupKind = StartupKind.ReloadedWindow;
			}
		}

		return startupKind;
	}
}

registerSingleton(ILifecycleService, BrowserLifecycleService, InstantiationType.Eager);
