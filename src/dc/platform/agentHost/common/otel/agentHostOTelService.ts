/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type TelemetryConfig = any;
import type { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';


export const AgentHostOTelServiceNamespace = 'vscode.agent-host';
export const AgentHostOTelServiceName = 'vscode-agent-host';
export const AgentHostSessionSpanName = 'vscode.agent_host.session';
export const AgentHostSessionTitleSpanName = 'vscode.agent_host.session.title_changed';

export const AgentHostSessionTitleAttribute = 'vscode.agent_host.session.title';
export const AgentHostSessionUriAttribute = 'vscode.agent_host.session.uri';

export interface IAgentHostTraceContext {
	readonly traceId: string;
	readonly spanId: string;
	readonly traceparent: string;
	readonly tracestate?: string;
}

export interface IAgentHostNativeOTelConfig {
	readonly traces?: { readonly endpoint: string; readonly protocol: 'http/json' | 'http/protobuf' | 'grpc' };
	readonly external?: {
		readonly endpoint: string;
		readonly protocol: 'http/json' | 'http/protobuf' | 'grpc';
		readonly headers?: Readonly<Record<string, string>>;
	};
	readonly captureContent: boolean;
	readonly resourceAttributes: Readonly<Record<string, string>>;
}

export interface IAgentHostOTelService {
	readonly _serviceBrand: undefined;

	getSdkTelemetryConfig(): Promise<TelemetryConfig | undefined>;

	getNativeSdkTelemetryConfig(): Promise<IAgentHostNativeOTelConfig | undefined>;

	getSessionTraceContext(conversationId: string, sessionUri: string): IAgentHostTraceContext | undefined;

	releaseSessionTraceContext(sessionUri: string): void;

	withTraceContext<T>(context: IAgentHostTraceContext | undefined, fn: () => T): T;
	getCurrentTraceContext(): IAgentHostTraceContext | undefined;

	getSpansDbPath(): URI | undefined;

	emitSessionTitleChanged(conversationId: string, sessionUri: string, title: string): void;

	flush(): Promise<void>;
}

export const IAgentHostOTelService = createDecorator<IAgentHostOTelService>('agentHostOTelService');
