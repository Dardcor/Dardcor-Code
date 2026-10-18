/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { MCP } from './modelContextProtocol.js';

export const IMcpGatewayService = createDecorator<IMcpGatewayService>('IMcpGatewayService');

export const McpGatewayChannelName = 'mcpGateway';
export const McpGatewayToolBrokerChannelName = 'mcpGatewayToolBroker';

export interface IMcpGatewayServerDescriptor {
	readonly id: string;
	readonly label: string;
}

export interface IMcpGatewayServerInfo {
	readonly label: string;
	readonly address: URI;
}

export interface IMcpGatewaySingleServerInvoker {
	readonly onDidChangeTools: Event<void>;
	readonly onDidChangeResources: Event<void>;
	listTools(): Promise<readonly MCP.Tool[]>;
	callTool(name: string, args: Record<string, unknown>): Promise<MCP.CallToolResult>;
	listResources(): Promise<readonly MCP.Resource[]>;
	readResource(uri: string): Promise<MCP.ReadResourceResult>;
	listResourceTemplates(): Promise<readonly MCP.ResourceTemplate[]>;
}

export interface IMcpGatewayToolInvoker {
	readonly onDidChangeServers: Event<readonly IMcpGatewayServerDescriptor[]>;
	readonly onDidChangeTools: Event<void>;
	readonly onDidChangeResources: Event<void>;
	listServers(): readonly IMcpGatewayServerDescriptor[];
	listToolsForServer(serverId: string): Promise<readonly MCP.Tool[]>;
	callToolForServer(serverId: string, name: string, args: Record<string, unknown>): Promise<MCP.CallToolResult>;
	listResourcesForServer(serverId: string): Promise<readonly MCP.Resource[]>;
	readResourceForServer(serverId: string, uri: string): Promise<MCP.ReadResourceResult>;
	listResourceTemplatesForServer(serverId: string): Promise<readonly MCP.ResourceTemplate[]>;
}

export interface IMcpGatewayDto {
	readonly servers: readonly IMcpGatewayServerInfo[];

	readonly gatewayId: string;
}

export interface IMcpGatewayInfo extends IMcpGatewayDto {
	readonly onDidChangeServers: Event<readonly IMcpGatewayServerInfo[]>;
}

export interface IMcpGatewayService {
	readonly _serviceBrand: undefined;

	disposeGatewaysForClient<TContext>(context: TContext): void;

	createGateway<TContext>(context: TContext, toolInvoker?: IMcpGatewayToolInvoker): Promise<IMcpGatewayInfo>;

	disposeGateway(gatewayId: string): Promise<void>;
}
