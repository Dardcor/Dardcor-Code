/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IObservable } from '../../../../base/common/observable.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogger, LogLevel } from '../../../../platform/log/common/log.js';
import { StorageScope } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceFolderData } from '../../../../platform/workspace/common/workspace.js';
import { IResolvedValue } from '../../../services/configurationResolver/common/configurationResolverExpression.js';
import { McpTaskManager } from './mcpTaskManager.js';
import { IMcpServerConnection, LazyCollectionState, McpCollectionDefinition, McpCollectionReference, McpConnectionState, McpDefinitionReference, McpServerDefinition, McpServerLaunch, McpStartServerInteraction } from './mcpTypes.js';
import { MCP } from './modelContextProtocol.js';

export const IMcpRegistry = createDecorator<IMcpRegistry>('mcpRegistry');

export interface IMcpMessageTransport extends IDisposable {
	readonly state: IObservable<McpConnectionState>;
	readonly onDidLog: Event<{ level: LogLevel; message: string }>;
	readonly onDidReceiveMessage: Event<MCP.JSONRPCMessage>;
	send(message: MCP.JSONRPCMessage): void;
	stop(): void;
}

export interface IMcpHostDelegate {
	readonly priority: number;
	waitForInitialProviderPromises(): Promise<void>;
	canStart(collectionDefinition: McpCollectionDefinition, serverDefinition: McpServerDefinition): boolean;
	substituteVariables(serverDefinition: McpServerDefinition, launch: McpServerLaunch): Promise<McpServerLaunch>;
	start(collectionDefinition: McpCollectionDefinition, serverDefinition: McpServerDefinition, resolvedLaunch: McpServerLaunch, options?: { errorOnUserInteraction?: boolean }): IMcpMessageTransport;
}

export interface IMcpResolveConnectionOptions {
	logger: ILogger;
	interaction?: McpStartServerInteraction;
	collectionRef: McpCollectionReference;
	definitionRef: McpDefinitionReference;

	trustNonceBearer: { trustedAtNonce: string | undefined };
	promptType?: 'only-new' | 'all-untrusted' | 'never';
	autoTrustChanges?: boolean;

	debug?: boolean;

	errorOnUserInteraction?: boolean;

	taskManager: McpTaskManager;
}

export interface IMcpRegistry {
	readonly _serviceBrand: undefined;

	readonly onDidChangeInputs: Event<void>;

	readonly collections: IObservable<readonly McpCollectionDefinition[]>;
	readonly delegates: IObservable<readonly IMcpHostDelegate[]>;
	readonly lazyCollectionState: IObservable<{ state: LazyCollectionState; collections: McpCollectionDefinition[] }>;

	getServerDefinition(collectionRef: McpDefinitionReference, definitionRef: McpDefinitionReference): IObservable<{ server: McpServerDefinition | undefined; collection: McpCollectionDefinition | undefined }>;

	discoverCollections(): Promise<McpCollectionDefinition[]>;

	registerDelegate(delegate: IMcpHostDelegate): IDisposable;
	registerCollection(collection: McpCollectionDefinition): IDisposable;

	clearSavedInputs(scope: StorageScope, inputId?: string): Promise<void>;
	editSavedInput(inputId: string, folderData: IWorkspaceFolderData | undefined, configSection: string, target: ConfigurationTarget): Promise<void>;
	setSavedInput(inputId: string, target: ConfigurationTarget, value: string): Promise<void>;
	getSavedInputs(scope: StorageScope): Promise<{ [id: string]: IResolvedValue }>;
	resolveConnection(options: IMcpResolveConnectionOptions): Promise<IMcpServerConnection | undefined>;
}
