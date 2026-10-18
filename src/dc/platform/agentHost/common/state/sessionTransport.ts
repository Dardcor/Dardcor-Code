/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import type { AgentHostClientConnectionKind, AgentHostTransportKind } from '../agentHostTelemetry.js';
import type { ProtocolMessage, AhpServerNotification, JsonRpcNotification, JsonRpcParseErrorResponse, JsonRpcResponse, JsonRpcRequest } from './sessionProtocol.js';

export const enum AgentHostTransportFailureReason {
	Unknown = 'unknown',
	HostNotRunning = 'hostNotRunning',
}

export class NonReconnectableTransportError extends Error {
	constructor(message: string, readonly reason: AgentHostTransportFailureReason = AgentHostTransportFailureReason.Unknown) {
		super(message);
	}
}

export interface IProtocolTransport extends IDisposable {
	readonly transportKind?: AgentHostTransportKind;

	readonly clientConnectionKind?: AgentHostClientConnectionKind;

	readonly onMessage: Event<ProtocolMessage>;

	readonly onClose: Event<void>;

	send(message: ProtocolMessage | AhpServerNotification | JsonRpcNotification | JsonRpcParseErrorResponse | JsonRpcResponse | JsonRpcRequest): void;
}

export interface IClientTransport extends IProtocolTransport {
	connect(): Promise<void>;
}

export function isClientTransport(transport: IProtocolTransport): transport is IClientTransport {
	return typeof (transport as IClientTransport).connect === 'function';
}

export interface IProtocolServer extends IDisposable {
	readonly onConnection: Event<IProtocolTransport>;

	readonly address: string | undefined;
}
