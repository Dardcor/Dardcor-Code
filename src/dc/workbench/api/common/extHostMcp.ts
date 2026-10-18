/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DeferredPromise, raceCancellationError, Sequencer, timeout } from '../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { AUTH_SCOPE_SEPARATOR, fetchAuthorizationServerMetadata, fetchResourceMetadata, getDefaultMetadataForUrl, IAuthorizationProtectedResourceMetadata, IAuthorizationServerMetadata, parseWWWAuthenticateHeader, scopesMatch } from '../../../base/common/oauth.js';
import { SSEParser } from '../../../base/common/sseParser.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { vArray, vNumber, vObj, vObjAny, vOptionalProp, vString } from '../../../base/common/validation.js';
import { ConfigurationTarget } from '../../../platform/configuration/common/configuration.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { canLog, ILogService, LogLevel } from '../../../platform/log/common/log.js';
import product from '../../../platform/product/common/product.js';
import { StorageScope } from '../../../platform/storage/common/storage.js';
import { extensionPrefixedIdentifier, McpCollectionDefinition, McpConnectionState, McpServerDefinition, McpServerLaunch, McpServerStaticMetadata, McpServerStaticToolAvailability, McpServerTransportHTTP, McpServerTransportType, UserInteractionRequiredError } from '../../contrib/mcp/common/mcpTypes.js';
import { MCP } from '../../contrib/mcp/common/modelContextProtocol.js';
import { checkProposedApiEnabled, isProposedApiEnabled } from '../../services/extensions/common/extensions.js';
import { ExtHostMcpShape, IMcpAuthenticationDetails, IAuthMetadataSource, IStartMcpOptions, MainContext, MainThreadMcpShape, IAuthResourceMetadataSource, IAuthServerMetadataSource } from './extHost.protocol.js';
import { IExtHostInitDataService } from './extHostInitDataService.js';
import { IExtHostRpcService } from './extHostRpcService.js';
import * as Convert from './extHostTypeConverters.js';
import { McpHttpServerDefinition, McpStdioServerDefinition, McpToolAvailability } from './extHostTypes.js';
import { IExtHostVariableResolverProvider } from './extHostVariableResolverService.js';
import { IExtHostWorkspace } from './extHostWorkspace.js';

export const IExtHostMpcService = createDecorator<IExtHostMpcService>('IExtHostMpcService');

export interface IExtHostMpcService extends ExtHostMcpShape {
	registerMcpConfigurationProvider(extension: IExtensionDescription, id: string, provider: vscode.McpServerDefinitionProvider): IDisposable;

	readonly onDidChangeMcpServerDefinitions: Event<void>;

	readonly mcpServerDefinitions: readonly vscode.McpServerDefinition[];

	startMcpGateway(chatSessionResource?: URI): Promise<vscode.McpGateway | undefined>;
}

const serverDataValidation = vObj({
	label: vString(),
	version: vOptionalProp(vString()),
	metadata: vOptionalProp(vObj({
		capabilities: vOptionalProp(vObjAny()),
		serverInfo: vOptionalProp(vObjAny()),
		tools: vOptionalProp(vArray(vObj({
			availability: vNumber(),
			definition: vObjAny(),
		}))),
	})),
	authentication: vOptionalProp(vObj({
		providerId: vString(),
		scopes: vArray(vString()),
	}))
});


export class ExtHostMcpService extends Disposable implements IExtHostMpcService {
	protected _proxy: MainThreadMcpShape;
	private readonly _initialProviderPromises = new Set<Promise<void>>();
	protected readonly _sseEventSources = this._register(new DisposableMap<number, McpHTTPHandle>());
	private readonly _unresolvedMcpServers = new Map< string, {
		provider: vscode.McpServerDefinitionProvider;
		servers: vscode.McpServerDefinition[];
	}>();

	private readonly _onDidChangeMcpServerDefinitions = this._register(new Emitter<void>());
	readonly onDidChangeMcpServerDefinitions: Event<void> = this._onDidChangeMcpServerDefinitions.event;
	private _mcpServerDefinitions: readonly vscode.McpServerDefinition[] = [];

	private readonly _activeGateways = new Map<string, {
		servers: vscode.McpGatewayServer[];
		onDidChangeServers: Emitter<readonly vscode.McpGatewayServer[]>;
	}>();

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@ILogService protected readonly _logService: ILogService,
		@IExtHostInitDataService private readonly _extHostInitData: IExtHostInitDataService,
		@IExtHostWorkspace protected readonly _workspaceService: IExtHostWorkspace,
		@IExtHostVariableResolverProvider private readonly _variableResolver: IExtHostVariableResolverProvider,
	) {
		super();
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadMcp);
	}

	get mcpServerDefinitions(): readonly vscode.McpServerDefinition[] {
		return this._mcpServerDefinitions;
	}

	$onDidChangeMcpServerDefinitions(servers: McpServerDefinition.Serialized[]): void {
		this._mcpServerDefinitions = servers.map(dto => Convert.McpServerDefinition.to(dto));
		this._onDidChangeMcpServerDefinitions.fire();
	}

	$startMcp(id: number, opts: IStartMcpOptions): void {
		this._startMcp(id, McpServerLaunch.fromSerialized(opts.launch), opts.defaultCwd && URI.revive(opts.defaultCwd), opts.errorOnUserInteraction);
	}

	protected _startMcp(id: number, launch: McpServerLaunch, _defaultCwd?: URI, errorOnUserInteraction?: boolean): void {
		if (launch.type === McpServerTransportType.HTTP) {
			this._sseEventSources.set(id, new McpHTTPHandle(id, launch, this._proxy, this._logService, errorOnUserInteraction));
			return;
		}

		throw new Error('not implemented');
	}

	async $substituteVariables<T>(_workspaceFolder: UriComponents | undefined, value: T): Promise<T> {
		const folderURI = URI.revive(_workspaceFolder);
		const folder = folderURI && await this._workspaceService.resolveWorkspaceFolder(folderURI);
		const variableResolver = await this._variableResolver.getResolver();
		return variableResolver.resolveAsync(folder && {
			uri: folder.uri,
			name: folder.name,
			index: folder.index,
		}, value) as T;
	}

	$stopMcp(id: number): void {
		this._sseEventSources.get(id)
			?.close()
			.then(() => this._didClose(id));
	}

	private _didClose(id: number) {
		this._sseEventSources.deleteAndDispose(id);
	}

	$sendMessage(id: number, message: string): void {
		this._sseEventSources.get(id)?.send(message);
	}

	async $waitForInitialCollectionProviders(): Promise<void> {
		await Promise.all(this._initialProviderPromises);
	}

	async $resolveMcpLaunch(collectionId: string, label: string): Promise<McpServerLaunch.Serialized | undefined> {
		const rec = this._unresolvedMcpServers.get(collectionId);
		if (!rec) {
			return;
		}

		const server = rec.servers.find(s => s.label === label);
		if (!server) {
			return;
		}
		if (!rec.provider.resolveMcpServerDefinition) {
			return Convert.McpServerDefinition.from(server);
		}

		const resolved = await rec.provider.resolveMcpServerDefinition(server, CancellationToken.None);
		return resolved ? Convert.McpServerDefinition.from(resolved) : undefined;
	}

	public registerMcpConfigurationProvider(extension: IExtensionDescription, id: string, provider: vscode.McpServerDefinitionProvider): IDisposable {
		const store = new DisposableStore();

		const metadata = extension.contributes?.mcpServerDefinitionProviders?.find(m => m.id === id);
		if (!metadata) {
			throw new Error(`MCP configuration providers must be registered in the contributes.mcpServerDefinitionProviders array within your package.json, but "${id}" was not`);
		}

		const mcp: McpCollectionDefinition.FromExtHost = {
			id: extensionPrefixedIdentifier(extension.identifier, id),
			isTrustedByDefault: true,
			label: metadata?.label ?? extension.displayName ?? extension.name,
			scope: StorageScope.WORKSPACE,
			canResolveLaunch: typeof provider.resolveMcpServerDefinition === 'function',
			extensionId: extension.identifier.value,
			configTarget: this._extHostInitData.remote.isRemote ? ConfigurationTarget.USER_REMOTE : ConfigurationTarget.USER,
		};

		const update = async () => {
			const list = await provider.provideMcpServerDefinitions(CancellationToken.None);
			this._unresolvedMcpServers.set(mcp.id, { servers: list ?? [], provider });

			const servers: McpServerDefinition.Serialized[] = [];
			for (const item of list ?? []) {
				let id = ExtensionIdentifier.toKey(extension.identifier) + '/' + item.label;
				if (servers.some(s => s.id === id)) {
					let i = 2;
					while (servers.some(s => s.id === id + i)) { i++; }
					id = id + i;
				}

				serverDataValidation.validateOrThrow(item);
				if ((item as vscode.McpHttpServerDefinition2).authentication) {
					checkProposedApiEnabled(extension, 'mcpToolDefinitions');
				}

				let staticMetadata: McpServerStaticMetadata | undefined;
				const castAs2 = item as McpStdioServerDefinition | McpHttpServerDefinition;
				if (isProposedApiEnabled(extension, 'mcpToolDefinitions') && castAs2.metadata) {
					staticMetadata = {
						capabilities: castAs2.metadata.capabilities as MCP.ServerCapabilities,
						instructions: castAs2.metadata.instructions,
						serverInfo: castAs2.metadata.serverInfo as MCP.Implementation,
						tools: castAs2.metadata.tools?.map(t => ({
							availability: t.availability === McpToolAvailability.Dynamic ? McpServerStaticToolAvailability.Dynamic : McpServerStaticToolAvailability.Initial,
							definition: t.definition as MCP.Tool,
						})),
					};
				}

				servers.push({
					id,
					label: item.label,
					cacheNonce: item.version || '$$NONE',
					staticMetadata,
					launch: Convert.McpServerDefinition.from(item),
				});
			}

			this._proxy.$upsertMcpCollection(mcp, servers);
		};

		store.add(toDisposable(() => {
			this._unresolvedMcpServers.delete(mcp.id);
			this._proxy.$deleteMcpCollection(mcp.id);
		}));

		if (provider.onDidChangeMcpServerDefinitions) {
			store.add(provider.onDidChangeMcpServerDefinitions(update));
		}
		// eslint-disable-next-line local/code-no-any-casts
		if ((provider as any).onDidChangeServerDefinitions) {
			// eslint-disable-next-line local/code-no-any-casts
			store.add((provider as any).onDidChangeServerDefinitions(update));
		}
		// eslint-disable-next-line local/code-no-any-casts
		if ((provider as any).onDidChange) {
			// eslint-disable-next-line local/code-no-any-casts
			store.add((provider as any).onDidChange(update));
		}

		const promise = new Promise<void>(resolve => {
			setTimeout(() => update().finally(() => {
				this._initialProviderPromises.delete(promise);
				resolve();
			}), 0);
		});

		this._initialProviderPromises.add(promise);

		return store;
	}

	public async startMcpGateway(chatSessionResource?: URI): Promise<vscode.McpGateway | undefined> {
		const result = await this._proxy.$startMcpGateway(chatSessionResource?.toJSON());
		if (!result) {
			return undefined;
		}

		const gatewayId = result.gatewayId;
		const servers: vscode.McpGatewayServer[] = result.servers.map(s => ({
			label: s.label,
			address: URI.revive(s.address),
		}));
		const onDidChangeServers = new Emitter<readonly vscode.McpGatewayServer[]>();

		this._activeGateways.set(gatewayId, { servers, onDidChangeServers });

		return {
			get servers() { return servers; },
			onDidChangeServers: onDidChangeServers.event,
			dispose: () => {
				this._activeGateways.delete(gatewayId);
				onDidChangeServers.dispose();
				this._proxy.$disposeMcpGateway(gatewayId);
			}
		};
	}

	$onDidChangeGatewayServers(gatewayId: string, newServers: { label: string; address: UriComponents }[]): void {
		const gateway = this._activeGateways.get(gatewayId);
		if (!gateway) {
			return;
		}

		const servers: vscode.McpGatewayServer[] = newServers.map(s => ({
			label: s.label,
			address: URI.revive(s.address),
		}));
		gateway.servers.length = 0;
		gateway.servers.push(...servers);
		gateway.onDidChangeServers.fire(servers);
	}
}

function stringifyError(err: unknown): string {
	if (!(err instanceof Error)) {
		return String(err);
	}
	let msg = String(err);
	let cause: unknown = err.cause;
	for (let depth = 0; cause !== undefined && depth < 5; depth++) {
		msg += `: ${cause instanceof Error ? (cause.message || String(cause)) : String(cause)}`;
		cause = cause instanceof Error ? cause.cause : undefined;
	}
	return msg;
}

const enum HttpMode {
	Unknown,
	Http,
	SSE,
}

type HttpModeT =
	| { value: HttpMode.Unknown }
	| { value: HttpMode.Http; sessionId: string | undefined }
	| { value: HttpMode.SSE; endpoint: string };

const MAX_FOLLOW_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];
const ALLOWED_REDIRECT_PROTOCOLS = new Set(['http:', 'https:']);
const CROSS_ORIGIN_STRIPPED_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization', 'mcp-session-id']);

function setHostHeader(headers: Record<string, string>, name: string, value: string): void {
	for (const configuredName of Object.keys(headers)) {
		if (configuredName.toLowerCase() === name.toLowerCase()) {
			delete headers[configuredName];
		}
	}
	headers[name] = value;
}

export class McpHTTPHandle extends Disposable {
	private readonly _requestSequencer = new Sequencer();
	private readonly _postEndpoint = new DeferredPromise<{ url: string; transport: McpServerTransportHTTP }>();
	private _mode: HttpModeT = { value: HttpMode.Unknown };
	private readonly _cts = new CancellationTokenSource();
	private readonly _abortCtrl = new AbortController();
	private _authMetadata?: AuthMetadata;
	private _didSendClose = false;

	constructor(
		private readonly _id: number,
		private readonly _launch: McpServerTransportHTTP,
		private readonly _proxy: MainThreadMcpShape,
		private readonly _logService: ILogService,
		private readonly _errorOnUserInteraction?: boolean,
	) {
		super();

		this._register(toDisposable(() => {
			this._abortCtrl.abort();
			this._cts.dispose(true);
		}));
		this._proxy.$onDidChangeState(this._id, { state: McpConnectionState.Kind.Running });
	}

	async send(message: string) {
		try {
			if (this._mode.value === HttpMode.Unknown) {
				await this._requestSequencer.queue(() => this._send(message));
			} else {
				await this._send(message);
			}
		} catch (err) {
			const msg = `Error sending message to ${this._launch.uri}: ${stringifyError(err)}`;
			this._proxy.$onDidChangeState(this._id, { state: McpConnectionState.Kind.Error, message: msg });
		}
	}

	async close() {
		if (this._mode.value === HttpMode.Http && this._mode.sessionId && !this._didSendClose) {
			this._didSendClose = true;
			try {
				await this._closeSession(this._mode.sessionId);
			} catch {
			}
		}

		this._proxy.$onDidChangeState(this._id, { state: McpConnectionState.Kind.Stopped });
	}

	private async _closeSession(sessionId: string) {
		const headers: Record<string, string> = {
			...Object.fromEntries(this._launch.headers),
			'Mcp-Session-Id': sessionId,
		};

		try {
			await this._addAuthHeader(headers, { errorOnUserInteraction: true });
		} catch (e) {
			this._log(LogLevel.Debug, `Skipping session close: authentication no longer available`);
			return;
		}

		await this._fetch(
			this._launch.uri.toString(true),
			{
				method: 'DELETE',
				headers,
			},
		);
	}

	private _send(message: string) {
		if (this._mode.value === HttpMode.SSE) {
			return this._sendLegacySSE(this._mode.endpoint, message);
		} else {
			return this._sendStreamableHttp(message, this._mode.value === HttpMode.Http ? this._mode.sessionId : undefined);
		}
	}

	private async _sendStreamableHttp(message: string, sessionId: string | undefined) {
		const asBytes = new TextEncoder().encode(message) as Uint8Array<ArrayBuffer>;
		const headers: Record<string, string> = {
			...Object.fromEntries(this._launch.headers),
			'Content-Type': 'application/json',
			Accept: 'text/event-stream, application/json',
		};
		if (sessionId) {
			headers['Mcp-Session-Id'] = sessionId;
		}
		await this._addAuthHeader(headers);

		const res = await this._fetchWithAuthRetry(
			this._launch.uri.toString(true),
			{
				method: 'POST',
				headers,
				body: asBytes,
			},
			headers
		);

		const wasUnknown = this._mode.value === HttpMode.Unknown;

		const nextSessionId = res.headers.get('Mcp-Session-Id');
		if (nextSessionId) {
			this._mode = { value: HttpMode.Http, sessionId: nextSessionId };
		}

		if (this._mode.value === HttpMode.Unknown &&
			res.status >= 400 && res.status < 500
			&& !isAuthStatusCode(res.status)
		) {
			this._log(LogLevel.Info, `${res.status} status sending message to ${this._launch.uri}, will attempt to fall back to legacy SSE`);
			this._sseFallbackWithMessage(message);
			return;
		}

		if (res.status >= 300) {
			const retryWithSessionId = this._mode.value === HttpMode.Http && !!this._mode.sessionId && (res.status === 400 || res.status === 404);

			this._proxy.$onDidChangeState(this._id, {
				state: McpConnectionState.Kind.Error,
				message: `${res.status} status sending message to ${this._launch.uri}: ${await this._getErrText(res)}` + (retryWithSessionId ? `; will retry with new session ID` : ''),
				shouldRetry: retryWithSessionId,
			});
			return;
		}

		if (this._mode.value === HttpMode.Unknown) {
			this._mode = { value: HttpMode.Http, sessionId: undefined };
		}
		if (wasUnknown) {
			this._attachStreamableBackchannel();
		}

		await this._handleSuccessfulStreamableHttp(res, message);
	}

	private async _sseFallbackWithMessage(message: string) {
		const endpoint = await this._attachSSE();
		if (endpoint) {
			this._mode = { value: HttpMode.SSE, endpoint };
			await this._sendLegacySSE(endpoint, message);
		}
	}

	private async _handleSuccessfulStreamableHttp(res: CommonResponse, message: string) {
		if (res.status === 202) {
			return;
		}

		const contentType = res.headers.get('Content-Type')?.toLowerCase() || '';
		if (contentType.startsWith('text/event-stream')) {
			const parser = new SSEParser(event => {
				if (event.type === 'message') {
					this._proxy.$onDidReceiveMessage(this._id, event.data);
				} else if (event.type === 'endpoint') {
					this._log(LogLevel.Warning, `Received SSE endpoint from a POST to ${this._launch.uri}, will fall back to legacy SSE`);
					this._sseFallbackWithMessage(message);
					throw new CancellationError();
				}
			});

			try {
				await this._doSSE(parser, res);
			} catch (err) {
				this._log(LogLevel.Warning, `Error reading SSE stream: ${stringifyError(err)}`);
			}
		} else if (contentType.startsWith('application/json')) {
			this._proxy.$onDidReceiveMessage(this._id, await res.text());
		} else {
			const responseBody = await res.text();
			if (isJSON(responseBody)) {
				this._proxy.$onDidReceiveMessage(this._id, responseBody);
			} else {
				this._log(LogLevel.Warning, `Unexpected ${res.status} response for request: ${responseBody}`);
			}
		}
	}

	private async _attachStreamableBackchannel() {
		let lastEventId: string | undefined;
		let canReconnectAt: number | undefined;
		for (let retry = 0; !this._store.isDisposed; retry++) {
			if (canReconnectAt !== undefined) {
				await timeout(Math.max(0, canReconnectAt - Date.now()), this._cts.token);
				canReconnectAt = undefined;
			} else {
				await timeout(Math.min(retry * 1000, 30_000), this._cts.token);
			}

			let res: CommonResponse;
			try {
				const headers: Record<string, string> = {
					...Object.fromEntries(this._launch.headers),
					'Accept': 'text/event-stream',
				};
				await this._addAuthHeader(headers);

				if (this._mode.value === HttpMode.Http && this._mode.sessionId !== undefined) {
					headers['Mcp-Session-Id'] = this._mode.sessionId;
				}
				if (lastEventId) {
					headers['Last-Event-ID'] = lastEventId;
				}

				res = await this._fetchWithAuthRetry(
					this._launch.uri.toString(true),
					{
						method: 'GET',
						headers,
					},
					headers
				);
			} catch (e) {
				this._log(LogLevel.Info, `Error connecting to ${this._launch.uri} for async notifications, will retry`);
				continue;
			}

			if (res.status >= 400) {
				this._log(LogLevel.Debug, `${res.status} status connecting to ${this._launch.uri} for async notifications; they will be disabled: ${await this._getErrText(res)}`);
				return;
			}

			if (res.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
				retry = 0;
			}

			const parser = new SSEParser(event => {
				if (event.retry) {
					canReconnectAt = Date.now() + event.retry;
				}
				if (event.type === 'message' && event.data) {
					this._proxy.$onDidReceiveMessage(this._id, event.data);
				}
				if (event.id) {
					lastEventId = event.id;
				}
			});

			try {
				await this._doSSE(parser, res);
			} catch (e) {
				this._log(LogLevel.Info, `Error reading from async stream, we will reconnect: ${e}`);
			}
		}
	}

	private async _attachSSE(): Promise<string | undefined> {
		const postEndpoint = new DeferredPromise<string>();
		const headers: Record<string, string> = {
			...Object.fromEntries(this._launch.headers),
			'Accept': 'text/event-stream',
		};
		await this._addAuthHeader(headers);

		let res: CommonResponse;
		try {
			res = await this._fetchWithAuthRetry(
				this._launch.uri.toString(true),
				{
					method: 'GET',
					headers,
				},
				headers
			);
			if (res.status >= 300) {
				this._proxy.$onDidChangeState(this._id, { state: McpConnectionState.Kind.Error, message: `${res.status} status connecting to ${this._launch.uri} as SSE: ${await this._getErrText(res)}` });
				return;
			}
		} catch (e) {
			this._proxy.$onDidChangeState(this._id, { state: McpConnectionState.Kind.Error, message: `Error connecting to ${this._launch.uri} as SSE: ${e}` });
			return;
		}

		const parser = new SSEParser(event => {
			if (event.type === 'message') {
				this._proxy.$onDidReceiveMessage(this._id, event.data);
			} else if (event.type === 'endpoint') {
				postEndpoint.complete(new URL(event.data, this._launch.uri.toString(true)).toString());
			}
		});

		this._register(toDisposable(() => postEndpoint.cancel()));
		this._doSSE(parser, res).catch(err => {
			this._proxy.$onDidChangeState(this._id, { state: McpConnectionState.Kind.Error, message: `Error reading SSE stream: ${stringifyError(err)}` });
		});

		return postEndpoint.p;
	}

	private async _sendLegacySSE(url: string, message: string) {
		const asBytes = new TextEncoder().encode(message) as Uint8Array<ArrayBuffer>;
		const headers: Record<string, string> = {
			...Object.fromEntries(this._launch.headers),
			'Content-Type': 'application/json',
		};
		await this._addAuthHeader(headers);
		const res = await this._fetch(url, {
			method: 'POST',
			headers,
			body: asBytes,
		});

		if (res.status >= 300) {
			this._log(LogLevel.Warning, `${res.status} status sending message to ${this._postEndpoint}: ${await this._getErrText(res)}`);
		}
	}

	private async _doSSE(parser: SSEParser, res: CommonResponse) {
		if (!res.body) {
			return;
		}

		const reader = res.body.getReader();
		let chunk: ReadableStreamReadResult<Uint8Array>;
		do {
			try {
				chunk = await raceCancellationError(reader.read(), this._cts.token);
			} catch (err) {
				reader.cancel();
				if (this._store.isDisposed) {
					return;
				} else {
					throw err;
				}
			}

			if (chunk.value) {
				parser.feed(chunk.value);
			}
		} while (!chunk.done);
	}

	private async _addAuthHeader(headers: Record<string, string>, options?: { forceNewRegistration?: boolean; errorOnUserInteraction?: boolean }) {
		const errorOnUserInteraction = options?.errorOnUserInteraction ?? this._errorOnUserInteraction;
		if (this._authMetadata) {
			try {
				const authDetails: IMcpAuthenticationDetails = {
					authorizationServer: this._authMetadata.authorizationServer.toJSON(),
					authorizationServerMetadata: this._authMetadata.serverMetadata,
					resourceMetadata: this._authMetadata.resourceMetadata,
					scopes: this._authMetadata.scopes,
					clientId: this._launch.oauth?.clientId,
					enterpriseManaged: this._launch.oauth?.enterpriseManaged,
				};
				const token = await this._proxy.$getTokenFromServerMetadata(
					this._id,
					authDetails,
					{
						errorOnUserInteraction,
						forceNewRegistration: options?.forceNewRegistration
					});
				if (token) {
					setHostHeader(headers, 'Authorization', `Bearer ${token}`);
				}
			} catch (e) {
				if (UserInteractionRequiredError.is(e)) {
					this._proxy.$onDidChangeState(this._id, { state: McpConnectionState.Kind.Stopped, reason: 'needs-user-interaction' });
					throw new CancellationError();
				}
				this._log(LogLevel.Warning, `Error getting token from server metadata: ${String(e)}`);
			}
		}
		if (this._launch.authentication) {
			try {
				this._log(LogLevel.Debug, `Using provided authentication config: providerId=${this._launch.authentication.providerId}, scopes=${this._launch.authentication.scopes.join(', ')}`);
				const token = await this._proxy.$getTokenForProviderId(
					this._id,
					this._launch.authentication.providerId,
					this._launch.authentication.scopes,
					{
						errorOnUserInteraction,
						forceNewRegistration: options?.forceNewRegistration,
						clientId: this._launch.oauth?.clientId,
					}
				);
				if (token) {
					setHostHeader(headers, 'Authorization', `Bearer ${token}`);
					this._log(LogLevel.Info, 'Successfully obtained token from provided authentication config');
				}
			} catch (e) {
				if (UserInteractionRequiredError.is(e)) {
					this._proxy.$onDidChangeState(this._id, { state: McpConnectionState.Kind.Stopped, reason: 'needs-user-interaction' });
					throw new CancellationError();
				}
				this._log(LogLevel.Warning, `Error getting token from provided authentication config: ${String(e)}`);
			}
		}
		return headers;
	}

	private _log(level: LogLevel, message: string) {
		if (!this._store.isDisposed) {
			this._proxy.$onDidPublishLog(this._id, level, message);
		}
	}

	private async _getErrText(res: CommonResponse) {
		try {
			return await res.text();
		} catch {
			return res.statusText;
		}
	}

	private async _fetchWithAuthRetry(mcpUrl: string, init: MinimalRequestInit, headers: Record<string, string>): Promise<CommonResponse> {
		const doFetch = () => this._fetch(mcpUrl, init);

		let res = await doFetch();
		if (isAuthStatusCode(res.status)) {
			if (!this._authMetadata) {
				this._authMetadata = await createAuthMetadata(mcpUrl, res.headers, {
					sameOriginHeaders: {
						...Object.fromEntries(this._launch.headers),
						'MCP-Protocol-Version': MCP.LATEST_PROTOCOL_VERSION
					},
					fetch: (url, init) => this._fetch(url, init as MinimalRequestInit),
					log: (level, message) => this._log(level, message)
				});
				this._proxy.$logMcpAuthSetup(this._authMetadata.telemetry);
				await this._addAuthHeader(headers);
				if (headers['Authorization']) {
					init.headers = headers;
					res = await doFetch();
				}
			} else {
				if (this._authMetadata.update(res.headers)) {
					await this._addAuthHeader(headers);
					if (headers['Authorization']) {
						init.headers = headers;
						res = await doFetch();
					}
				}
			}
		}
		if (headers['Authorization'] && isAuthStatusCode(res.status)) {
			const errorText = await this._getErrText(res);
			this._log(LogLevel.Info, `Received ${res.status} status with Authorization header, retrying with new auth registration. Error details: ${errorText || 'no additional details'}`);
			await this._addAuthHeader(headers, { forceNewRegistration: true });
			res = await doFetch();
		}
		return res;
	}

	private async _fetch(url: string, init: MinimalRequestInit): Promise<CommonResponse> {
		setHostHeader(init.headers, 'user-agent', `${product.nameLong}/${product.version}`);

		if (canLog(this._logService.getLevel(), LogLevel.Trace)) {
			const traceObj: any = { ...init, headers: { ...init.headers } };
			if (traceObj.body) {
				traceObj.body = new TextDecoder().decode(traceObj.body);
			}
			if (traceObj.headers?.Authorization) {
				traceObj.headers.Authorization = '***';
			}
			this._log(LogLevel.Trace, `Fetching ${url} with options: ${JSON.stringify(traceObj)}`);
		}

		let currentUrl = url;
		let response!: CommonResponse;
		for (let redirectCount = 0; redirectCount < MAX_FOLLOW_REDIRECTS; redirectCount++) {
			response = await this._fetchInternal(currentUrl, {
				...init,
				signal: this._abortCtrl.signal,
				redirect: 'manual'
			});

			if (!REDIRECT_STATUS_CODES.includes(response.status)) {
				break;
			}

			const location = response.headers.get('location');
			if (!location) {
				break;
			}

			const currentUrlParsed = new URL(currentUrl);
			const nextUrlParsed = new URL(location, currentUrl);

			if (!ALLOWED_REDIRECT_PROTOCOLS.has(nextUrlParsed.protocol)) {
				throw new Error(`MCP server redirected to a non-http(s) target (${nextUrlParsed.protocol}), which is not allowed`);
			}

			if (currentUrlParsed.origin !== nextUrlParsed.origin) {
				for (const name of Object.keys(init.headers)) {
					if (CROSS_ORIGIN_STRIPPED_HEADERS.has(name.toLowerCase())) {
						delete init.headers[name];
					}
				}
			}

			const nextUrl = nextUrlParsed.toString();
			this._log(LogLevel.Trace, `Redirect (${response.status}) from ${currentUrl} to ${nextUrl}`);
			currentUrl = nextUrl;
			if (response.status === 303 || ((response.status === 301 || response.status === 302) && init.method === 'POST')) {
				init.method = 'GET';
				delete init.body;
			}
		}

		if (canLog(this._logService.getLevel(), LogLevel.Trace)) {
			const headers: Record<string, string> = {};
			response.headers.forEach((value, key) => { headers[key] = value; });
			this._log(LogLevel.Trace, `Fetched ${currentUrl}: ${JSON.stringify({
				status: response.status,
				headers: headers,
			})}`);
		}

		return response;
	}

	protected _fetchInternal(url: string, init?: CommonRequestInit): Promise<CommonResponse> {
		return fetch(url, init);
	}
}

interface MinimalRequestInit {
	method: string;
	headers: Record<string, string>;
	body?: Uint8Array<ArrayBuffer>;
}

export interface CommonRequestInit extends MinimalRequestInit {
	signal?: AbortSignal;
	redirect?: RequestRedirect;
}

export interface CommonResponse {
	status: number;
	statusText: string;
	headers: Headers;
	body?: ReadableStream | null;
	url: string;
	json(): Promise<any>;
	text(): Promise<string>;
}

function isJSON(str: string): boolean {
	try {
		JSON.parse(str);
		return true;
	} catch (e) {
		return false;
	}
}

function isAuthStatusCode(status: number): boolean {
	return status === 401 || status === 403;
}



export type AuthMetadataLogger = (level: LogLevel, message: string) => void;

export interface IAuthMetadata {
	readonly authorizationServer: URI;
	readonly serverMetadata: IAuthorizationServerMetadata;
	readonly resourceMetadata: IAuthorizationProtectedResourceMetadata | undefined;
	readonly scopes: string[] | undefined;
	readonly telemetry: IAuthMetadataSource;

	update(responseHeaders: Headers): boolean;
}

class AuthMetadata implements IAuthMetadata {
	private _scopes: string[] | undefined;

	constructor(
		public readonly authorizationServer: URI,
		public readonly serverMetadata: IAuthorizationServerMetadata,
		public readonly resourceMetadata: IAuthorizationProtectedResourceMetadata | undefined,
		scopes: string[] | undefined,
		public readonly telemetry: IAuthMetadataSource,
		private readonly _log: AuthMetadataLogger,
	) {
		this._scopes = scopes;
	}

	get scopes(): string[] | undefined {
		return this._scopes;
	}

	update(responseHeaders: Headers): boolean {
		const scopesChallenge = this._parseScopesFromResponse(responseHeaders);
		if (!scopesMatch(scopesChallenge, this._scopes)) {
			this._log(LogLevel.Info, `Scopes changed from ${JSON.stringify(this._scopes)} to ${JSON.stringify(scopesChallenge)}, updating`);
			this._scopes = scopesChallenge;
			return true;
		}
		return false;
	}

	private _parseScopesFromResponse(responseHeaders: Headers): string[] | undefined {
		const authHeader = responseHeaders.get('WWW-Authenticate');
		if (!authHeader) {
			return undefined;
		}
		const challenges = parseWWWAuthenticateHeader(authHeader);
		for (const challenge of challenges) {
			if (challenge.scheme === 'Bearer' && challenge.params['scope']) {
				const scopes = challenge.params['scope'].split(AUTH_SCOPE_SEPARATOR).filter(s => s.trim().length);
				if (scopes.length) {
					this._log(LogLevel.Info, `Found scope challenge in WWW-Authenticate header: ${challenge.params['scope']}`);
					return scopes;
				}
			}
		}
		return undefined;
	}
}

export interface ICreateAuthMetadataOptions {
	sameOriginHeaders?: Record<string, string>;
	fetch: (url: string, init: MinimalRequestInit) => Promise<CommonResponse>;
	log: AuthMetadataLogger;
}

export async function createAuthMetadata(
	resourceUrl: string,
	initialResponseHeaders: Headers,
	options: ICreateAuthMetadataOptions
): Promise<AuthMetadata> {
	const { sameOriginHeaders, fetch, log } = options;

	let resourceMetadataSource = IAuthResourceMetadataSource.None;
	let serverMetadataSource: IAuthServerMetadataSource | undefined;

	const { resourceMetadataChallenge, scopesChallenge: scopesChallengeFromHeader } = parseWWWAuthenticateHeaderForChallenges(initialResponseHeaders.get('WWW-Authenticate') ?? undefined, log);

	let serverMetadataUrl: string | undefined;
	let resource: IAuthorizationProtectedResourceMetadata | undefined;
	let scopesChallenge = scopesChallengeFromHeader;

	try {
		const { metadata, discoveryUrl, errors } = await fetchResourceMetadata(resourceUrl, resourceMetadataChallenge, {
			sameOriginHeaders,
			fetch: (url, init) => fetch(url, init as MinimalRequestInit)
		});
		for (const err of errors) {
			log(LogLevel.Warning, `Error fetching resource metadata: ${err}`);
		}
		log(LogLevel.Info, `Discovered resource metadata at ${discoveryUrl}`);

		resourceMetadataSource = resourceMetadataChallenge ? IAuthResourceMetadataSource.Header : IAuthResourceMetadataSource.WellKnown;

		serverMetadataUrl = metadata.authorization_servers?.[0];
		if (!serverMetadataUrl) {
			log(LogLevel.Warning, `No authorization_servers found in resource metadata ${discoveryUrl} - Is this resource metadata configured correctly?`);
		} else {
			log(LogLevel.Info, `Using auth server metadata url: ${serverMetadataUrl}`);
			serverMetadataSource = IAuthServerMetadataSource.ResourceMetadata;
		}
		scopesChallenge ??= metadata.scopes_supported;
		resource = metadata;
	} catch (e) {
		log(LogLevel.Warning, `Could not fetch resource metadata: ${String(e)}`);
	}

	const baseUrl = new URL(resourceUrl).origin;

	let additionalHeaders: Record<string, string> = {};
	if (!serverMetadataUrl) {
		serverMetadataUrl = baseUrl;
		if (sameOriginHeaders) {
			additionalHeaders = sameOriginHeaders;
		}
	}

	try {
		log(LogLevel.Debug, `Fetching auth server metadata for: ${serverMetadataUrl} ...`);
		const { metadata, discoveryUrl, errors } = await fetchAuthorizationServerMetadata(serverMetadataUrl, {
			additionalHeaders,
			fetch: (url, init) => fetch(url, init as MinimalRequestInit)
		});
		for (const err of errors) {
			log(LogLevel.Warning, `Error fetching authorization server metadata: ${err}`);
		}
		log(LogLevel.Info, `Discovered authorization server metadata at ${discoveryUrl}`);

		serverMetadataSource ??= IAuthServerMetadataSource.WellKnown;

		return new AuthMetadata(
			URI.parse(serverMetadataUrl),
			metadata,
			resource,
			scopesChallenge,
			{ resourceMetadataSource, serverMetadataSource },
			log
		);
	} catch (e) {
		log(LogLevel.Warning, `Error populating auth server metadata for ${serverMetadataUrl}: ${String(e)}`);
	}

	const defaultMetadata = getDefaultMetadataForUrl(new URL(baseUrl));
	log(LogLevel.Info, 'Using default auth metadata');
	return new AuthMetadata(
		URI.parse(baseUrl),
		defaultMetadata,
		resource,
		scopesChallenge,
		{ resourceMetadataSource, serverMetadataSource: IAuthServerMetadataSource.Default },
		log
	);
}

function parseWWWAuthenticateHeaderForChallenges(
	wwwAuthenticateValue: string | undefined,
	log: AuthMetadataLogger
): { resourceMetadataChallenge?: string; scopesChallenge?: string[] } {
	if (!wwwAuthenticateValue) {
		return {};
	}
	let resourceMetadataChallenge: string | undefined;
	let scopesChallenge: string[] | undefined;

	const challenges = parseWWWAuthenticateHeader(wwwAuthenticateValue);
	for (const challenge of challenges) {
		if (challenge.scheme === 'Bearer') {
			if (!resourceMetadataChallenge && challenge.params['resource_metadata']) {
				resourceMetadataChallenge = challenge.params['resource_metadata'];
				log(LogLevel.Debug, `Found resource_metadata challenge in WWW-Authenticate header: ${resourceMetadataChallenge}`);
			}
			if (!scopesChallenge && challenge.params['scope']) {
				const scopes = challenge.params['scope'].split(AUTH_SCOPE_SEPARATOR).filter(s => s.trim().length);
				if (scopes.length) {
					log(LogLevel.Debug, `Found scope challenge in WWW-Authenticate header: ${challenge.params['scope']}`);
					scopesChallenge = scopes;
				}
			}
			if (resourceMetadataChallenge && scopesChallenge) {
				break;
			}
		}
	}
	return { resourceMetadataChallenge, scopesChallenge };
}

