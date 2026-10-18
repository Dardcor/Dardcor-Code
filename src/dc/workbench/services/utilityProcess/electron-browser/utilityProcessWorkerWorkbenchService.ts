/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { Client as MessagePortClient } from '../../../../base/parts/ipc/common/ipc.mp.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IPCClient, ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { acquirePort } from '../../../../base/parts/ipc/electron-browser/ipc.mp.js';
import { IOnDidTerminateUtilityrocessWorkerProcess, ipcUtilityProcessWorkerChannelName, IUtilityProcessWorkerProcess, IUtilityProcessWorkerService } from '../../../../platform/utilityProcess/common/utilityProcessWorkerService.js';
import { Barrier, timeout } from '../../../../base/common/async.js';

export const IUtilityProcessWorkerWorkbenchService = createDecorator<IUtilityProcessWorkerWorkbenchService>('utilityProcessWorkerWorkbenchService');

export interface IUtilityProcessWorker extends IDisposable {

	client: IPCClient<string>;

	onDidTerminate: Promise<IOnDidTerminateUtilityrocessWorkerProcess>;
}

export interface IUtilityProcessWorkerWorkbenchService {

	readonly _serviceBrand: undefined;

	createWorker(process: IUtilityProcessWorkerProcess): Promise<IUtilityProcessWorker>;

	notifyRestored(): void;
}

export class UtilityProcessWorkerWorkbenchService extends Disposable implements IUtilityProcessWorkerWorkbenchService {

	declare readonly _serviceBrand: undefined;

	private _utilityProcessWorkerService: IUtilityProcessWorkerService | undefined = undefined;
	private get utilityProcessWorkerService(): IUtilityProcessWorkerService {
		if (!this._utilityProcessWorkerService) {
			const channel = this.mainProcessService.getChannel(ipcUtilityProcessWorkerChannelName);
			this._utilityProcessWorkerService = ProxyChannel.toService<IUtilityProcessWorkerService>(channel);
		}

		return this._utilityProcessWorkerService;
	}

	private readonly restoredBarrier = new Barrier();

	constructor(
		readonly windowId: number,
		@ILogService private readonly logService: ILogService,
		@IMainProcessService private readonly mainProcessService: IMainProcessService
	) {
		super();
	}

	async createWorker(process: IUtilityProcessWorkerProcess): Promise<IUtilityProcessWorker> {
		this.logService.trace('Renderer->UtilityProcess#createWorker');


		await Promise.race([this.restoredBarrier.wait(), timeout(2000)]);

		const nonce = generateUuid();
		const responseChannel = 'vscode:createUtilityProcessWorkerMessageChannelResult';
		const portPromise = acquirePort(undefined , responseChannel, nonce);

		const onDidTerminate = this.utilityProcessWorkerService.createWorker({
			process,
			reply: { windowId: this.windowId, channel: responseChannel, nonce }
		});

		const disposables = new DisposableStore();
		disposables.add(toDisposable(() => {
			this.logService.trace('Renderer->UtilityProcess#disposeWorker', process);

			this.utilityProcessWorkerService.disposeWorker({
				process,
				reply: { windowId: this.windowId }
			});
		}));

		const port = await portPromise;
		const client = disposables.add(new MessagePortClient(port, `window:${this.windowId},module:${process.moduleId}`));
		this.logService.trace('Renderer->UtilityProcess#createWorkerChannel: connection established');

		onDidTerminate.then(({ reason }) => {
			if (reason?.code === 0) {
				this.logService.trace(`[UtilityProcessWorker]: terminated normally with code ${reason.code}, signal: ${reason.signal}`);
			} else {
				this.logService.error(`[UtilityProcessWorker]: terminated unexpectedly with code ${reason?.code}, signal: ${reason?.signal}`);
			}
		});

		return { client, onDidTerminate, dispose: () => disposables.dispose() };
	}

	notifyRestored(): void {
		if (!this.restoredBarrier.isOpen()) {
			this.restoredBarrier.open();
		}
	}
}
