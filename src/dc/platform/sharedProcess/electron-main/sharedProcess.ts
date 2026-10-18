/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IpcMainEvent, MessagePortMain } from 'electron';
import { validatedIpcMain } from '../../../base/parts/ipc/electron-main/ipcMain.js';
import { Barrier, DeferredPromise } from '../../../base/common/async.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { ISharedProcessConfiguration } from '../node/sharedProcess.js';
import { IUserDataProfilesService } from '../../userDataProfile/common/userDataProfile.js';
import { IPolicyService } from '../../policy/common/policy.js';
import { ILoggerMainService } from '../../log/electron-main/loggerService.js';
import { UtilityProcess } from '../../utilityProcess/electron-main/utilityProcess.js';
import { NullTelemetryService } from '../../telemetry/common/telemetryUtils.js';
import { parseSharedProcessDebugPort } from '../../environment/node/environmentService.js';
import { assertReturnsDefined } from '../../../base/common/types.js';
import { SharedProcessChannelConnection, SharedProcessRawConnection, SharedProcessLifecycle } from '../common/sharedProcess.js';
import { Emitter } from '../../../base/common/event.js';

export class SharedProcess extends Disposable {

	private readonly firstWindowConnectionBarrier = new Barrier();

	private utilityProcess: UtilityProcess | undefined = undefined;
	private utilityProcessLogListener: IDisposable | undefined = undefined;

	private readonly _onDidCrash = this._register(new Emitter<void>());
	readonly onDidCrash = this._onDidCrash.event;

	constructor(
		private readonly machineId: string,
		private readonly sqmId: string,
		private readonly devDeviceId: string,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@IUserDataProfilesService private readonly userDataProfilesService: IUserDataProfilesService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@ILogService private readonly logService: ILogService,
		@ILoggerMainService private readonly loggerMainService: ILoggerMainService,
		@IPolicyService private readonly policyService: IPolicyService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		validatedIpcMain.on(SharedProcessChannelConnection.request, (e, nonce: string) => this.onWindowConnection(e, nonce, SharedProcessChannelConnection.response));

		validatedIpcMain.on(SharedProcessRawConnection.request, (e, nonce: string) => this.onWindowConnection(e, nonce, SharedProcessRawConnection.response));

		this._register(this.lifecycleMainService.onWillShutdown(() => this.onWillShutdown()));
	}

	private async onWindowConnection(e: IpcMainEvent, nonce: string, responseChannel: string): Promise<void> {
		this.logService.trace(`[SharedProcess] onWindowConnection for: ${responseChannel}`);

		if (!this.firstWindowConnectionBarrier.isOpen()) {
			this.firstWindowConnectionBarrier.open();
		}


		await this.whenReady();


		const port = await this.connect(responseChannel);


		if (e.sender.isDestroyed()) {
			return port.close();
		}

		e.sender.postMessage(responseChannel, nonce, [port]);
	}

	private onWillShutdown(): void {
		this.logService.trace('[SharedProcess] onWillShutdown');

		this.utilityProcess?.postMessage(SharedProcessLifecycle.exit);
		this.utilityProcess = undefined;
	}

	private _whenReady: Promise<void> | undefined = undefined;
	whenReady(): Promise<void> {
		if (!this._whenReady) {
			this._whenReady = (async () => {

				await this.whenIpcReady;


				const whenReady = new DeferredPromise<void>();
				this.utilityProcess?.once(SharedProcessLifecycle.initDone, () => whenReady.complete());

				await whenReady.p;
				this.utilityProcessLogListener?.dispose();
				this.logService.trace('[SharedProcess] Overall ready');
			})();
		}

		return this._whenReady;
	}

	private _whenIpcReady: Promise<void> | undefined = undefined;
	private get whenIpcReady() {
		if (!this._whenIpcReady) {
			this._whenIpcReady = (async () => {

				await this.firstWindowConnectionBarrier.wait();

				this.createUtilityProcess();

				const sharedProcessIpcReady = new DeferredPromise<void>();
				this.utilityProcess?.once(SharedProcessLifecycle.ipcReady, () => sharedProcessIpcReady.complete());

				await sharedProcessIpcReady.p;
				this.logService.trace('[SharedProcess] IPC ready');
			})();
		}

		return this._whenIpcReady;
	}

	private createUtilityProcess(): void {
		this.utilityProcess = this._register(new UtilityProcess(this.logService, NullTelemetryService, this.lifecycleMainService));

		this.utilityProcessLogListener = this.utilityProcess.onMessage(e => {
			const logValue = e as { warning?: unknown; error?: unknown };
			if (typeof logValue.warning === 'string') {
				this.logService.warn(logValue.warning);
			} else if (typeof logValue.error === 'string') {
				this.logService.error(logValue.error);
			}
		});

		const inspectParams = parseSharedProcessDebugPort(this.environmentMainService.args, this.environmentMainService.isBuilt);
		let execArgv: string[] | undefined = undefined;
		if (inspectParams.port) {
			execArgv = ['--nolazy', '--experimental-network-inspection'];
			if (inspectParams.break) {
				execArgv.push(`--inspect-brk=${inspectParams.port}`);
			} else {
				execArgv.push(`--inspect=${inspectParams.port}`);
			}
		}

		this.utilityProcess.start({
			type: 'shared-process',
			name: 'shared-process',
			entryPoint: 'vs/code/electron-utility/sharedProcess/sharedProcessMain',
			payload: this.createSharedProcessConfiguration(),
			respondToAuthRequestsFromMainProcess: true,
			execArgv
		});

		this._register(this.utilityProcess.onCrash(() => this._onDidCrash.fire()));
	}

	private createSharedProcessConfiguration(): ISharedProcessConfiguration {
		return {
			machineId: this.machineId,
			sqmId: this.sqmId,
			devDeviceId: this.devDeviceId,
			codeCachePath: this.environmentMainService.codeCachePath,
			profiles: {
				home: this.userDataProfilesService.profilesHome,
				all: this.userDataProfilesService.profiles,
			},
			args: this.environmentMainService.args,
			logLevel: this.loggerMainService.getLogLevel(),
			loggers: this.loggerMainService.getGlobalLoggers(),
			policiesData: this.policyService.serialize()
		};
	}

	async connect(payload?: unknown): Promise<MessagePortMain> {

		await this.whenIpcReady;

		const utilityProcess = assertReturnsDefined(this.utilityProcess);
		return utilityProcess.connect(payload);
	}
}
