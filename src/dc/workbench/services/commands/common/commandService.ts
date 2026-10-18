/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancelablePromise, notCancellablePromise, raceCancellablePromises, timeout } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry, ICommandEvent, ICommandService } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IExtensionService } from '../../extensions/common/extensions.js';

export class CommandService extends Disposable implements ICommandService {

	declare readonly _serviceBrand: undefined;

	private _extensionHostIsReady: boolean = false;
	private _starActivation: CancelablePromise<void> | null;

	private readonly _onWillExecuteCommand: Emitter<ICommandEvent> = this._register(new Emitter<ICommandEvent>());
	public readonly onWillExecuteCommand: Event<ICommandEvent> = this._onWillExecuteCommand.event;

	private readonly _onDidExecuteCommand = this._register(new Emitter<ICommandEvent>());
	public readonly onDidExecuteCommand: Event<ICommandEvent> = this._onDidExecuteCommand.event;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this._extensionService.whenInstalledExtensionsRegistered().then(value => this._extensionHostIsReady = value);
		this._starActivation = null;
	}

	private _activateStar(): Promise<void> {
		if (!this._starActivation) {
			this._starActivation = raceCancellablePromises([
				this._extensionService.activateByEvent(`*`),
				timeout(30000)
			]);
		}

		return notCancellablePromise(this._starActivation);
	}

	async executeCommand<T>(id: string, ...args: unknown[]): Promise<T> {
		this._logService.trace('CommandService#executeCommand', id);

		const activationEvent = `onCommand:${id}`;
		const commandIsRegistered = !!CommandsRegistry.getCommand(id);

		if (commandIsRegistered) {

			if (this._extensionService.activationEventIsDone(activationEvent)) {
				return this._tryExecuteCommand(id, args);
			}

			if (!this._extensionHostIsReady) {
				this._extensionService.activateByEvent(activationEvent);
				return this._tryExecuteCommand(id, args);
			}

			await this._extensionService.activateByEvent(activationEvent);
			return this._tryExecuteCommand(id, args);
		}

		await Promise.all([
			this._extensionService.activateByEvent(activationEvent),
			raceCancellablePromises<unknown>([
				this._activateStar(),
				Event.toPromise(Event.filter(CommandsRegistry.onDidRegisterCommand, e => e === id))
			]),
		]);

		return this._tryExecuteCommand(id, args);
	}

	private _tryExecuteCommand(id: string, args: unknown[]): Promise<any> {
		const command = CommandsRegistry.getCommand(id);
		if (!command) {
			return Promise.reject(new Error(`command '${id}' not found`));
		}
		try {
			this._onWillExecuteCommand.fire({ commandId: id, args });
			const result = this._instantiationService.invokeFunction(command.handler, ...args);
			this._onDidExecuteCommand.fire({ commandId: id, args });
			return Promise.resolve(result);
		} catch (err) {
			return Promise.reject(err);
		}
	}

	public override dispose(): void {
		super.dispose();
		this._starActivation?.cancel();
	}
}

registerSingleton(ICommandService, CommandService, InstantiationType.Delayed);
