/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Throttler } from '../../../base/common/async.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { ILogService } from '../../log/common/log.js';
import {
	IAgentHostByokLmHandler,
	IByokLmBridgeConnection,
	IByokLmChatRequest,
	IByokLmChatResult,
	IByokLmModelInfo,
} from './agentHostByokLm.js';

export const AGENT_HOST_CLIENT_BYOK_LM_CHANNEL = 'agentHostClientByokLm';

export function createAgentHostClientByokLmConnection(channel: IChannel): IByokLmBridgeConnection {
	return {
		chat: (request) => channel.call('chat', request) as Promise<IByokLmChatResult>,
		onDidChangeModels: channel.listen<IByokLmModelInfo[]>('models'),
	};
}


export class AgentHostClientByokLmChannel implements IServerChannel {

	constructor(
		@IAgentHostByokLmHandler private readonly _handler: IAgentHostByokLmHandler,
		@ILogService private readonly _logService: ILogService,
	) { }

	listen<T>(_ctx: unknown, event: string): Event<T> {
		if (event === 'models') {
			return this._modelsSnapshotEvent() as Event<T>;
		}
		throw new Error(`No event '${event}' on AgentHostClientByokLmChannel`);
	}

	private _modelsSnapshotEvent(): Event<IByokLmModelInfo[]> {
		const store = new DisposableStore();
		const throttler = store.add(new Throttler());
		const emitter = store.add(new Emitter<IByokLmModelInfo[]>({
			onDidAddFirstListener: () => {
				if (this._handler.onDidChangeModels) {
					store.add(this._handler.onDidChangeModels(() => void publish()));
				}
				void publish();
			},
			onDidRemoveLastListener: () => store.dispose(),
		}));
		const publish = () => {
			if (store.isDisposed) {
				return;
			}
			throttler.queue(async () => {
				try {
					const models = await this._handler.listModels(CancellationToken.None);
					if (!store.isDisposed) {
						emitter.fire(models);
					}
				} catch (err) {
					this._logService.warn('AgentHostClientByokLmChannel: failed to enumerate BYOK models from the renderer', err);
				}
			});
		};
		return emitter.event;
	}

	async call<T>(_ctx: unknown, command: string, arg?: unknown): Promise<T> {
		switch (command) {
			case 'chat': {
				const result = await this._handler.chat(arg as IByokLmChatRequest, CancellationToken.None);
				return result as T;
			}
		}
		throw new Error(`Unknown command '${command}' on AgentHostClientByokLmChannel`);
	}
}

export class NullAgentHostClientByokLmChannel implements IServerChannel {

	listen<T>(_ctx: unknown, event: string): Event<T> {
		if (event === 'models') {
			return Event.None;
		}
		throw new Error(`No event '${event}' on NullAgentHostClientByokLmChannel`);
	}

	async call<T>(_ctx: unknown, command: string): Promise<T> {
		throw new Error(`No command '${command}' on NullAgentHostClientByokLmChannel`);
	}
}
