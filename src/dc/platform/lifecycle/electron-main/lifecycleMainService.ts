/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import electron from 'electron';
import { validatedIpcMain } from '../../../base/parts/ipc/electron-main/ipcMain.js';
import { Barrier, Promises, timeout } from '../../../base/common/async.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { isMacintosh, isWindows } from '../../../base/common/platform.js';
import { cwd } from '../../../base/common/process.js';
import { assertReturnsDefined } from '../../../base/common/types.js';
import { NativeParsedArgs } from '../../environment/common/argv.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { IStateService } from '../../state/node/state.js';
import { ICodeWindow, LoadReason, UnloadReason } from '../../window/electron-main/window.js';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from '../../workspace/common/workspace.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IAuxiliaryWindow } from '../../auxiliaryWindow/electron-main/auxiliaryWindow.js';
import { getAllWindowsExcludingOffscreen } from '../../windows/electron-main/windows.js';

export const ILifecycleMainService = createDecorator<ILifecycleMainService>('lifecycleMainService');

interface WindowLoadEvent {

	readonly window: ICodeWindow;

	readonly workspace: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | undefined;

	readonly reason: LoadReason;
}

export const enum ShutdownReason {

	QUIT = 1,

	KILL
}

export interface ShutdownEvent {

	reason: ShutdownReason;

	join(id: string, promise: Promise<void>): void;
}

export interface IRelaunchHandler {

	handleRelaunch(options?: IRelaunchOptions): boolean;
}

export interface IRelaunchOptions {
	readonly addArgs?: string[];
	readonly removeArgs?: string[];
}

export interface ILifecycleMainService {

	readonly _serviceBrand: undefined;

	readonly wasRestarted: boolean;

	readonly quitRequested: boolean;

	phase: LifecycleMainPhase;

	readonly onBeforeShutdown: Event<void>;

	readonly onWillShutdown: Event<ShutdownEvent>;

	readonly onWillLoadWindow: Event<WindowLoadEvent>;

	readonly onBeforeCloseWindow: Event<ICodeWindow>;

	registerWindow(window: ICodeWindow): void;

	registerAuxWindow(auxWindow: IAuxiliaryWindow): void;

	reload(window: ICodeWindow, cli?: NativeParsedArgs): Promise<void>;

	unload(window: ICodeWindow, reason: UnloadReason): Promise<boolean >;

	relaunch(options?: IRelaunchOptions): Promise<void>;

	setRelaunchHandler(handler: IRelaunchHandler): void;

	quit(willRestart?: boolean): Promise<boolean >;

	kill(code?: number): Promise<void>;

	when(phase: LifecycleMainPhase): Promise<void>;
}

export const enum LifecycleMainPhase {

	Starting = 1,

	Ready = 2,

	AfterWindowOpen = 3,

	Eventually = 4
}

export class LifecycleMainService extends Disposable implements ILifecycleMainService {

	declare readonly _serviceBrand: undefined;

	private static readonly QUIT_AND_RESTART_KEY = 'lifecycle.quitAndRestart';

	private readonly _onBeforeShutdown = this._register(new Emitter<void>());
	readonly onBeforeShutdown = this._onBeforeShutdown.event;

	private readonly _onWillShutdown = this._register(new Emitter<ShutdownEvent>());
	readonly onWillShutdown = this._onWillShutdown.event;

	private readonly _onWillLoadWindow = this._register(new Emitter<WindowLoadEvent>());
	readonly onWillLoadWindow = this._onWillLoadWindow.event;

	private readonly _onBeforeCloseWindow = this._register(new Emitter<ICodeWindow>());
	readonly onBeforeCloseWindow = this._onBeforeCloseWindow.event;

	private _quitRequested = false;
	get quitRequested(): boolean { return this._quitRequested; }

	private _wasRestarted = false;
	get wasRestarted(): boolean { return this._wasRestarted; }

	private _phase = LifecycleMainPhase.Starting;
	get phase(): LifecycleMainPhase { return this._phase; }

	private readonly windowToCloseRequest = new Set<number>();
	private oneTimeListenerTokenGenerator = 0;
	private windowCounter = 0;

	private pendingQuitPromise: Promise<boolean> | undefined = undefined;
	private pendingQuitPromiseResolve: { (veto: boolean): void } | undefined = undefined;

	private pendingWillShutdownPromise: Promise<void> | undefined = undefined;

	private readonly mapWindowIdToPendingUnload = new Map<number, Promise<boolean>>();

	private readonly phaseWhen = new Map<LifecycleMainPhase, Barrier>();

	private relaunchHandler: IRelaunchHandler | undefined = undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStateService private readonly stateService: IStateService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService
	) {
		super();

		this.resolveRestarted();
		this.when(LifecycleMainPhase.Ready).then(() => this.registerListeners());
	}

	private resolveRestarted(): void {
		this._wasRestarted = !!this.stateService.getItem(LifecycleMainService.QUIT_AND_RESTART_KEY);

		if (this._wasRestarted) {
			this.stateService.removeItem(LifecycleMainService.QUIT_AND_RESTART_KEY);
		}
	}

	private registerListeners(): void {

		const beforeQuitListener = () => {
			if (this._quitRequested) {
				return;
			}

			this.trace('Lifecycle#app.on(before-quit)');
			this._quitRequested = true;

			this.trace('Lifecycle#onBeforeShutdown.fire()');
			this._onBeforeShutdown.fire();

			if (isMacintosh && this.windowCounter === 0) {
				this.fireOnWillShutdown(ShutdownReason.QUIT);
			}
		};
		electron.app.addListener('before-quit', beforeQuitListener);

		const windowAllClosedListener = () => {
			this.trace('Lifecycle#app.on(window-all-closed)');

			if (this._quitRequested || !isMacintosh) {
				electron.app.quit();
			}
		};
		electron.app.addListener('window-all-closed', windowAllClosedListener);

		electron.app.once('will-quit', e => {
			this.trace('Lifecycle#app.on(will-quit) - begin');

			e.preventDefault();

			const shutdownPromise = this.fireOnWillShutdown(ShutdownReason.QUIT);

			shutdownPromise.finally(() => {
				this.trace('Lifecycle#app.on(will-quit) - after fireOnWillShutdown');

				this.resolvePendingQuitPromise(false );


				electron.app.removeListener('before-quit', beforeQuitListener);
				electron.app.removeListener('window-all-closed', windowAllClosedListener);

				this.trace('Lifecycle#app.on(will-quit) - calling app.quit()');

				electron.app.quit();
			});
		});
	}

	private fireOnWillShutdown(reason: ShutdownReason): Promise<void> {
		if (this.pendingWillShutdownPromise) {
			return this.pendingWillShutdownPromise;
		}

		const logService = this.logService;
		this.trace('Lifecycle#onWillShutdown.fire()');

		const joiners: Promise<void>[] = [];

		this._onWillShutdown.fire({
			reason,
			join(id, promise) {
				logService.trace(`Lifecycle#onWillShutdown - begin '${id}'`);
				joiners.push(promise.finally(() => {
					logService.trace(`Lifecycle#onWillShutdown - end '${id}'`);
				}));
			}
		});

		this.pendingWillShutdownPromise = (async () => {

			try {
				await Promises.settled(joiners);
			} catch (error) {
				this.logService.error(error);
			}

			try {
				await this.stateService.close();
			} catch (error) {
				this.logService.error(error);
			}
		})();

		return this.pendingWillShutdownPromise;
	}

	set phase(value: LifecycleMainPhase) {
		if (value < this.phase) {
			throw new Error('Lifecycle cannot go backwards');
		}

		if (this._phase === value) {
			return;
		}

		this.trace(`lifecycle (main): phase changed (value: ${value})`);

		this._phase = value;

		const barrier = this.phaseWhen.get(this._phase);
		if (barrier) {
			barrier.open();
			this.phaseWhen.delete(this._phase);
		}
	}

	async when(phase: LifecycleMainPhase): Promise<void> {
		if (phase <= this._phase) {
			return;
		}

		let barrier = this.phaseWhen.get(phase);
		if (!barrier) {
			barrier = new Barrier();
			this.phaseWhen.set(phase, barrier);
		}

		await barrier.wait();
	}

	registerWindow(window: ICodeWindow): void {
		const windowListeners = new DisposableStore();

		this.windowCounter++;

		windowListeners.add(window.onWillLoad(e => this._onWillLoadWindow.fire({ window, workspace: e.workspace, reason: e.reason })));

		const win = assertReturnsDefined(window.win);
		windowListeners.add(Event.fromNodeEventEmitter<electron.Event>(win, 'close')(e => {

			const windowId = window.id;
			if (this.windowToCloseRequest.delete(windowId)) {
				return;
			}

			this.trace(`Lifecycle#window.on('close') - window ID ${window.id}`);

			e.preventDefault();
			this.unload(window, UnloadReason.CLOSE).then(veto => {
				if (veto) {
					this.windowToCloseRequest.delete(windowId);
					return;
				}

				this.windowToCloseRequest.add(windowId);

				this.trace(`Lifecycle#onBeforeCloseWindow.fire() - window ID ${windowId}`);
				this._onBeforeCloseWindow.fire(window);

				window.close();
			});
		}));
		windowListeners.add(Event.fromNodeEventEmitter<electron.Event>(win, 'closed')(() => {
			this.trace(`Lifecycle#window.on('closed') - window ID ${window.id}`);

			this.windowCounter--;

			windowListeners.dispose();

			if (this.windowCounter === 0 && (!isMacintosh || this._quitRequested)) {
				this.fireOnWillShutdown(ShutdownReason.QUIT);
			}
		}));
	}

	registerAuxWindow(auxWindow: IAuxiliaryWindow): void {
		const win = assertReturnsDefined(auxWindow.win);

		const windowListeners = new DisposableStore();
		windowListeners.add(Event.fromNodeEventEmitter<electron.Event>(win, 'close')(e => {
			this.trace(`Lifecycle#auxWindow.on('close') - window ID ${auxWindow.id}`);

			if (this._quitRequested) {
				this.trace(`Lifecycle#auxWindow.on('close') - preventDefault() because quit requested`);


				e.preventDefault();
			}
		}));
		windowListeners.add(Event.fromNodeEventEmitter<electron.Event>(win, 'closed')(() => {
			this.trace(`Lifecycle#auxWindow.on('closed') - window ID ${auxWindow.id}`);

			windowListeners.dispose();
		}));
	}

	async reload(window: ICodeWindow, cli?: NativeParsedArgs): Promise<void> {

		const veto = await this.unload(window, UnloadReason.RELOAD);
		if (!veto) {
			window.reload(cli);
		}
	}

	unload(window: ICodeWindow, reason: UnloadReason): Promise<boolean > {

		const pendingUnloadPromise = this.mapWindowIdToPendingUnload.get(window.id);
		if (pendingUnloadPromise) {
			return pendingUnloadPromise;
		}

		const unloadPromise = this.doUnload(window, reason).finally(() => {
			this.mapWindowIdToPendingUnload.delete(window.id);
		});
		this.mapWindowIdToPendingUnload.set(window.id, unloadPromise);

		return unloadPromise;
	}

	private async doUnload(window: ICodeWindow, reason: UnloadReason): Promise<boolean > {

		if (!window.isReady) {
			return false;
		}

		this.trace(`Lifecycle#unload() - window ID ${window.id}`);

		const windowUnloadReason = this._quitRequested ? UnloadReason.QUIT : reason;
		const veto = await this.onBeforeUnloadWindowInRenderer(window, windowUnloadReason);
		if (veto) {
			this.trace(`Lifecycle#unload() - veto in renderer (window ID ${window.id})`);

			return this.handleWindowUnloadVeto(veto);
		}

		await this.onWillUnloadWindowInRenderer(window, windowUnloadReason);

		return false;
	}

	private handleWindowUnloadVeto(veto: boolean): boolean {
		if (!veto) {
			return false;
		}

		this.resolvePendingQuitPromise(true );

		this._quitRequested = false;

		return true;
	}

	private resolvePendingQuitPromise(veto: boolean): void {
		if (this.pendingQuitPromiseResolve) {
			this.pendingQuitPromiseResolve(veto);
			this.pendingQuitPromiseResolve = undefined;
			this.pendingQuitPromise = undefined;
		}
	}

	private onBeforeUnloadWindowInRenderer(window: ICodeWindow, reason: UnloadReason): Promise<boolean > {
		return new Promise<boolean>(resolve => {
			const oneTimeEventToken = this.oneTimeListenerTokenGenerator++;
			const okChannel = `vscode:ok${oneTimeEventToken}`;
			const cancelChannel = `vscode:cancel${oneTimeEventToken}`;

			const cleanup = (value: boolean) => {
				validatedIpcMain.removeListener(okChannel, okListener);
				validatedIpcMain.removeListener(cancelChannel, cancelListener);
				resolve(value);
			};

			const okListener = () => {
				cleanup(false);
			};

			const cancelListener = () => {
				cleanup(true);
			};

			validatedIpcMain.on(okChannel, okListener);
			validatedIpcMain.on(cancelChannel, cancelListener);

			window.send('vscode:onBeforeUnload', { okChannel, cancelChannel, reason });
		});
	}

	private onWillUnloadWindowInRenderer(window: ICodeWindow, reason: UnloadReason): Promise<void> {
		return new Promise<void>(resolve => {
			const oneTimeEventToken = this.oneTimeListenerTokenGenerator++;
			const replyChannel = `vscode:reply${oneTimeEventToken}`;

			validatedIpcMain.once(replyChannel, () => resolve());

			window.send('vscode:onWillUnload', { replyChannel, reason });
		});
	}

	quit(willRestart?: boolean): Promise<boolean > {
		return this.doQuit(willRestart).then(veto => {
			if (!veto && willRestart) {
				try {
					if (isWindows) {
						const currentWorkingDir = cwd();
						if (currentWorkingDir !== process.cwd()) {
							process.chdir(currentWorkingDir);
						}
					}
				} catch (err) {
					this.logService.error(err);
				}
			}

			return veto;
		});
	}

	private doQuit(willRestart?: boolean): Promise<boolean > {
		this.trace(`Lifecycle#quit() - begin (willRestart: ${willRestart})`);

		if (this.pendingQuitPromise) {
			this.trace('Lifecycle#quit() - returning pending quit promise');

			return this.pendingQuitPromise;
		}

		if (willRestart) {
			this.stateService.setItem(LifecycleMainService.QUIT_AND_RESTART_KEY, true);
		}

		this.pendingQuitPromise = new Promise(resolve => {

			this.pendingQuitPromiseResolve = resolve;

			this.trace('Lifecycle#quit() - calling app.quit()');
			electron.app.quit();
		});

		return this.pendingQuitPromise;
	}

	private trace(msg: string): void {
		if (this.environmentMainService.args['enable-smoke-test-driver']) {
			this.logService.info(msg);
		} else {
			this.logService.trace(msg);
		}
	}

	setRelaunchHandler(handler: IRelaunchHandler): void {
		this.relaunchHandler = handler;
	}

	async relaunch(options?: IRelaunchOptions): Promise<void> {
		this.trace('Lifecycle#relaunch()');

		const args = process.argv.slice(1);
		if (options?.addArgs) {
			args.push(...options.addArgs);
		}

		if (options?.removeArgs) {
			for (const a of options.removeArgs) {
				const idx = args.indexOf(a);
				if (idx >= 0) {
					args.splice(idx, 1);
				}
			}
		}

		const quitListener = () => {
			if (!this.relaunchHandler?.handleRelaunch(options)) {
				this.trace('Lifecycle#relaunch() - calling app.relaunch()');
				electron.app.relaunch({ args });
			}
		};
		electron.app.once('quit', quitListener);

		const veto = await this.quit(true );
		if (veto) {
			electron.app.removeListener('quit', quitListener);
		}
	}

	async kill(code?: number): Promise<void> {
		this.trace('Lifecycle#kill()');

		await this.fireOnWillShutdown(ShutdownReason.KILL);


		await Promise.race([

			timeout(1000),

			(async () => {
				for (const window of getAllWindowsExcludingOffscreen()) {
					if (window && !window.isDestroyed()) {
						let whenWindowClosed: Promise<void>;
						if (window.webContents && !window.webContents.isDestroyed()) {
							whenWindowClosed = new Promise(resolve => window.once('closed', resolve));
						} else {
							whenWindowClosed = Promise.resolve();
						}

						window.destroy();
						await whenWindowClosed;
					}
				}
			})()
		]);

		electron.app.exit(code);
	}
}
