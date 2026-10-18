/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from '../../../../base/common/arrays.js';
import { assertNever, softAssertNever } from '../../../../base/common/assert.js';
import { DeferredPromise, disposableTimeout, IntervalTimer, isThenable } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { JsonRpcError, JsonRpcProtocol } from '../../../../base/common/jsonRpcProtocol.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { autorun, ISettableObservable, ObservablePromise, observableValue, transaction } from '../../../../base/common/observable.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { canLog, ILogger, log, LogLevel } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IMcpMessageTransport } from './mcpRegistryTypes.js';
import { IMcpTaskInternal, McpTaskManager } from './mcpTaskManager.js';
import { IMcpClientMethods, McpConnectionState, McpError, MpcResponseError } from './mcpTypes.js';
import { isTaskResult, translateMcpLogMessage } from './mcpTypesUtils.js';
import { MCP } from './modelContextProtocol.js';

export interface McpRoot {
	uri: string;
	name?: string;
}

export interface IMcpServerRequestHandlerOptions extends IMcpClientMethods {
	launch: IMcpMessageTransport;
	logger: ILogger;
	requestLogLevel?: LogLevel;
	taskManager: McpTaskManager;
}

export class McpServerRequestHandler extends Disposable {
	private readonly _rpc: JsonRpcProtocol;

	private _hasAnnouncedRoots = false;
	private _roots: MCP.Root[] = [];

	public set roots(roots: MCP.Root[]) {
		if (!equals(this._roots, roots)) {
			this._roots = roots;
			if (this._hasAnnouncedRoots) {
				this.sendNotification({ method: 'notifications/roots/list_changed' });
				this._hasAnnouncedRoots = false;
			}
		}
	}

	private _serverInit!: MCP.InitializeResult;
	public get capabilities(): MCP.ServerCapabilities {
		return this._serverInit.capabilities;
	}

	public get serverInfo(): MCP.Implementation {
		return this._serverInit.serverInfo;
	}

	public get serverInstructions(): string | undefined {
		return this._serverInit.instructions;
	}

	private readonly _onDidReceiveCancelledNotification = this._register(new Emitter<MCP.CancelledNotification>());
	readonly onDidReceiveCancelledNotification = this._onDidReceiveCancelledNotification.event;

	private readonly _onDidReceiveProgressNotification = this._register(new Emitter<MCP.ProgressNotification>());
	readonly onDidReceiveProgressNotification = this._onDidReceiveProgressNotification.event;

	private readonly _onDidReceiveElicitationCompleteNotification = this._register(new Emitter<MCP.ElicitationCompleteNotification>());
	readonly onDidReceiveElicitationCompleteNotification = this._onDidReceiveElicitationCompleteNotification.event;

	private readonly _onDidChangeResourceList = this._register(new Emitter<void>());
	readonly onDidChangeResourceList = this._onDidChangeResourceList.event;

	private readonly _onDidUpdateResource = this._register(new Emitter<MCP.ResourceUpdatedNotification>());
	readonly onDidUpdateResource = this._onDidUpdateResource.event;

	private readonly _onDidChangeToolList = this._register(new Emitter<void>());
	readonly onDidChangeToolList = this._onDidChangeToolList.event;

	private readonly _onDidChangePromptList = this._register(new Emitter<void>());
	readonly onDidChangePromptList = this._onDidChangePromptList.event;

	public static async create(instaService: IInstantiationService, opts: IMcpServerRequestHandlerOptions, token?: CancellationToken) {
		const mcp = new McpServerRequestHandler(opts);
		const store = new DisposableStore();
		try {
			const timer = store.add(new IntervalTimer());
			timer.cancelAndSet(() => {
				opts.logger.info('Waiting for server to respond to `initialize` request...');
			}, 5000);

			await instaService.invokeFunction(async accessor => {
				const productService = accessor.get(IProductService);
				const initialized = await mcp.sendRequest<MCP.InitializeRequest, MCP.InitializeResult>({
					method: 'initialize',
					params: {
						protocolVersion: MCP.LATEST_PROTOCOL_VERSION,
						capabilities: {
							roots: { listChanged: true },
							sampling: opts.createMessageRequestHandler ? {} : undefined,
							elicitation: opts.elicitationRequestHandler ? { form: {}, url: {} } : undefined,
							tasks: {
								list: {},
								cancel: {},
								requests: {
									sampling: opts.createMessageRequestHandler ? { createMessage: {} } : undefined,
									elicitation: opts.elicitationRequestHandler ? { create: {} } : undefined,
								},
							},
							extensions: {
								'io.modelcontextprotocol/ui': {
									mimeTypes: ['text/html;profile=mcp-app']
								}
							}
						},
						clientInfo: {
							name: productService.nameLong,
							version: productService.version,
						}
					}
				}, token);
				mcp._serverInit = initialized;
				mcp._sendLogLevelToServer(opts.logger.getLevel());

				mcp.sendNotification<MCP.InitializedNotification>({
					method: 'notifications/initialized'
				});
			});

			return mcp;
		} catch (e) {
			mcp.dispose();
			throw e;
		} finally {
			store.dispose();
		}
	}

	public readonly logger: ILogger;
	private readonly _launch: IMcpMessageTransport;
	private readonly _requestLogLevel: LogLevel;
	private readonly _createMessageRequestHandler: IMcpServerRequestHandlerOptions['createMessageRequestHandler'];
	private readonly _elicitationRequestHandler: IMcpServerRequestHandlerOptions['elicitationRequestHandler'];
	private readonly _taskManager: McpTaskManager;

	protected constructor({
		launch,
		logger,
		createMessageRequestHandler,
		elicitationRequestHandler,
		requestLogLevel = LogLevel.Debug,
		taskManager,
	}: IMcpServerRequestHandlerOptions) {
		super();
		this._launch = launch;
		this.logger = logger;
		this._requestLogLevel = requestLogLevel;
		this._createMessageRequestHandler = createMessageRequestHandler;
		this._elicitationRequestHandler = elicitationRequestHandler;
		this._taskManager = taskManager;

		this._rpc = this._register(new JsonRpcProtocol(
			message => this.send(message as MCP.JSONRPCMessage),
			{
				handleRequest: (request, token) => this.handleServerRequest(request as MCP.JSONRPCRequest & MCP.ServerRequest, token),
				handleNotification: notification => this.handleServerNotification(notification as MCP.JSONRPCNotification & MCP.ServerNotification),
			}
		));

		this._taskManager.setHandler(this);
		this._register(this._taskManager.onDidUpdateTask(task => {
			this.send({
				jsonrpc: MCP.JSONRPC_VERSION,
				method: 'notifications/tasks/status',
				params: task
			} satisfies MCP.TaskStatusNotification);
		}));
		this._register(toDisposable(() => this._taskManager.setHandler(undefined)));

		this._register(launch.onDidReceiveMessage(message => {
			if (canLog(this.logger.getLevel(), this._requestLogLevel)) {
				log(this.logger, this._requestLogLevel, `[server -> editor] ${JSON.stringify(message)}`);
			}
			void this._rpc.handleMessage(message);
		}));
		this._register(autorun(reader => {
			const state = launch.state.read(reader).state;
			if (state === McpConnectionState.Kind.Error || state === McpConnectionState.Kind.Stopped) {
				this.cancelAllRequests();
			}
		}));

		this._register(logger.onDidChangeLogLevel((logLevel) => {
			this._sendLogLevelToServer(logLevel);
		}));
	}

	private async sendRequest<T extends MCP.ClientRequest, R extends MCP.ServerResult>(
		request: Pick<T, 'params' | 'method'>,
		token: CancellationToken = CancellationToken.None
	): Promise<R> {
		if (this._store.isDisposed) {
			return Promise.reject(new CancellationError());
		}

		return this._rpc.sendRequest<R>(
			request,
			token,
			id => this.sendNotification({ method: 'notifications/cancelled', params: { requestId: id } })
		).catch(error => {
			if (error instanceof JsonRpcError) {
				throw new MpcResponseError(error.message, error.code, error.data);
			}
			throw error;
		});
	}

	private send(mcp: MCP.JSONRPCMessage) {
		if (canLog(this.logger.getLevel(), this._requestLogLevel)) {
			log(this.logger, this._requestLogLevel, `[editor -> server] ${JSON.stringify(mcp)}`);
		}

		this._launch.send(mcp);
	}

	private async *sendRequestPaginated<T extends MCP.PaginatedRequest & MCP.ClientRequest, R extends MCP.PaginatedResult, I>(method: T['method'], getItems: (result: R) => I[], initialParams?: Omit<T['params'], 'jsonrpc' | 'id'>, token: CancellationToken = CancellationToken.None): AsyncIterable<I[]> {
		let nextCursor: MCP.Cursor | undefined = undefined;

		do {
			const params: T['params'] = {
				...initialParams,
				cursor: nextCursor
			};

			const result: R = await this.sendRequest<T, R>({ method, params }, token);
			yield getItems(result);
			nextCursor = result.nextCursor;
		} while (nextCursor !== undefined && !token.isCancellationRequested);
	}

	private sendNotification<N extends MCP.ClientNotification>(notification: Omit<N, 'jsonrpc'>): void {
		this.send({ ...notification, jsonrpc: MCP.JSONRPC_VERSION });
	}

	private handleServerRequest(request: MCP.JSONRPCRequest & MCP.ServerRequest, token: CancellationToken): MCP.Result | Promise<MCP.Result> {
		const mapError = (error: unknown): JsonRpcError => {
			if (error instanceof McpError) {
				return new JsonRpcError(error.code, error.message, error.data);
			}

			this.logger.error(`Error handling request ${request.method}:`, error);
			const mcpError = McpError.unknown(error instanceof Error ? error : new Error(String(error)));
			return new JsonRpcError(mcpError.code, mcpError.message, mcpError.data);
		};

		try {
			let result: MCP.Result | Promise<MCP.Result>;
			if (request.method === 'ping') {
				result = this.handlePing(request);
			} else if (request.method === 'roots/list') {
				result = this.handleRootsList(request);
			} else if (request.method === 'sampling/createMessage' && this._createMessageRequestHandler) {
				if (request.params.task) {
					const taskResult = this._taskManager.createTask(
						request.params.task.ttl ?? null,
						(token) => this._createMessageRequestHandler!(request.params, token)
					);
					taskResult._meta ??= {};
					taskResult._meta['io.modelcontextprotocol/related-task'] = { taskId: taskResult.task.taskId };
					result = taskResult;
				} else {
					result = this._createMessageRequestHandler(request.params, token);
				}
			} else if (request.method === 'elicitation/create' && this._elicitationRequestHandler) {
				if (request.params.task) {
					const taskResult = this._taskManager.createTask(
						request.params.task.ttl ?? null,
						(token) => this._elicitationRequestHandler!(request.params, token)
					);
					taskResult._meta ??= {};
					taskResult._meta['io.modelcontextprotocol/related-task'] = { taskId: taskResult.task.taskId };
					result = taskResult;
				} else {
					result = this._elicitationRequestHandler(request.params, token);
				}
			} else if (request.method === 'tasks/get') {
				result = this._taskManager.getTask(request.params.taskId);
			} else if (request.method === 'tasks/result') {
				result = this._taskManager.getTaskResult(request.params.taskId);
			} else if (request.method === 'tasks/cancel') {
				result = this._taskManager.cancelTask(request.params.taskId);
			} else if (request.method === 'tasks/list') {
				result = this._taskManager.listTasks();
			} else {
				throw McpError.methodNotFound(request.method);
			}

			if (isThenable(result)) {
				return result.then(undefined, (error: unknown) => {
					throw mapError(error);
				});
			}

			return result;
		} catch (e) {
			throw mapError(e);
		}
	}
	private handleServerNotification(request: MCP.JSONRPCNotification & MCP.ServerNotification): void {
		try {
			switch (request.method) {
				case 'notifications/message':
					return this.handleLoggingNotification(request);
				case 'notifications/cancelled':
					this._onDidReceiveCancelledNotification.fire(request);
					return this.handleCancelledNotification(request);
				case 'notifications/progress':
					this._onDidReceiveProgressNotification.fire(request);
					return;
				case 'notifications/resources/list_changed':
					this._onDidChangeResourceList.fire();
					return;
				case 'notifications/resources/updated':
					this._onDidUpdateResource.fire(request);
					return;
				case 'notifications/tools/list_changed':
					this._onDidChangeToolList.fire();
					return;
				case 'notifications/prompts/list_changed':
					this._onDidChangePromptList.fire();
					return;
				case 'notifications/elicitation/complete':
					this._onDidReceiveElicitationCompleteNotification.fire(request);
					return;
				case 'notifications/tasks/status':
					this._taskManager.getClientTask(request.params.taskId)?.onDidUpdateState(request.params);
					return;
				default:
					softAssertNever(request);
			}
		} catch (error) {
			this.logger.error(`Error handling notification ${request.method}:`, error);
		}
	}

	private handleCancelledNotification(request: MCP.CancelledNotification): void {
		if (request.params.requestId) {
			this._rpc.cancelPendingRequest(request.params.requestId);
		}
	}

	private handleLoggingNotification(request: MCP.LoggingMessageNotification): void {
		translateMcpLogMessage(this.logger, request.params);
	}

	private handlePing(_request: MCP.PingRequest): {} {
		return {};
	}

	private handleRootsList(_request: MCP.ListRootsRequest): MCP.ListRootsResult {
		this._hasAnnouncedRoots = true;
		return { roots: this._roots };
	}

	private cancelAllRequests() {
		this._rpc.cancelAllRequests();
	}

	public override dispose(): void {
		this.cancelAllRequests();
		super.dispose();
	}

	private async _sendLogLevelToServer(logLevel: LogLevel): Promise<void> {
		try {
			if (!this.capabilities.logging) {
				return;
			}

			await this.setLevel({ level: mapLogLevelToMcp(logLevel) });
		} catch (error) {
			this.logger.error(`Failed to set MCP server log level: ${error}`);
		}
	}

	initialize(params: MCP.InitializeRequest['params'], token?: CancellationToken): Promise<MCP.InitializeResult> {
		return this.sendRequest<MCP.InitializeRequest, MCP.InitializeResult>({ method: 'initialize', params }, token);
	}

	listResources(params?: MCP.ListResourcesRequest['params'], token?: CancellationToken): Promise<MCP.Resource[]> {
		return Iterable.asyncToArrayFlat(this.listResourcesIterable(params, token));
	}

	listResourcesIterable(params?: MCP.ListResourcesRequest['params'], token?: CancellationToken): AsyncIterable<MCP.Resource[]> {
		return this.sendRequestPaginated<MCP.ListResourcesRequest, MCP.ListResourcesResult, MCP.Resource>('resources/list', result => result.resources, params, token);
	}

	readResource(params: MCP.ReadResourceRequest['params'], token?: CancellationToken): Promise<MCP.ReadResourceResult> {
		return this.sendRequest<MCP.ReadResourceRequest, MCP.ReadResourceResult>({ method: 'resources/read', params }, token);
	}

	listResourceTemplates(params?: MCP.ListResourceTemplatesRequest['params'], token?: CancellationToken): Promise<MCP.ResourceTemplate[]> {
		return Iterable.asyncToArrayFlat(this.sendRequestPaginated<MCP.ListResourceTemplatesRequest, MCP.ListResourceTemplatesResult, MCP.ResourceTemplate>('resources/templates/list', result => result.resourceTemplates, params, token));
	}

	subscribe(params: MCP.SubscribeRequest['params'], token?: CancellationToken): Promise<MCP.EmptyResult> {
		return this.sendRequest<MCP.SubscribeRequest, MCP.EmptyResult>({ method: 'resources/subscribe', params }, token);
	}

	unsubscribe(params: MCP.UnsubscribeRequest['params'], token?: CancellationToken): Promise<MCP.EmptyResult> {
		return this.sendRequest<MCP.UnsubscribeRequest, MCP.EmptyResult>({ method: 'resources/unsubscribe', params }, token);
	}

	listPrompts(params?: MCP.ListPromptsRequest['params'], token?: CancellationToken): Promise<MCP.Prompt[]> {
		return Iterable.asyncToArrayFlat(this.sendRequestPaginated<MCP.ListPromptsRequest, MCP.ListPromptsResult, MCP.Prompt>('prompts/list', result => result.prompts, params, token));
	}

	getPrompt(params: MCP.GetPromptRequest['params'], token?: CancellationToken): Promise<MCP.GetPromptResult> {
		return this.sendRequest<MCP.GetPromptRequest, MCP.GetPromptResult>({ method: 'prompts/get', params }, token);
	}

	listTools(params?: MCP.ListToolsRequest['params'], token?: CancellationToken): Promise<MCP.Tool[]> {
		return Iterable.asyncToArrayFlat(this.sendRequestPaginated<MCP.ListToolsRequest, MCP.ListToolsResult, MCP.Tool>('tools/list', result => result.tools, params, token));
	}

	async callTool(params: MCP.CallToolRequest['params'] & MCP.Request['params'], token?: CancellationToken, onStatusMessage?: (message: string) => void): Promise<MCP.CallToolResult> {
		const response = await this.sendRequest<MCP.CallToolRequest, MCP.CallToolResult | MCP.CreateTaskResult>({ method: 'tools/call', params }, token);

		if (isTaskResult(response)) {
			const task = new McpTask<MCP.CallToolResult>(response.task, token, onStatusMessage);
			this._taskManager.adoptClientTask(task);
			task.setHandler(this);
			return task.result.finally(() => {
				this._taskManager.abandonClientTask(task.id);
			});
		}

		return response;

	}

	setLevel(params: MCP.SetLevelRequest['params'], token?: CancellationToken): Promise<MCP.EmptyResult> {
		return this.sendRequest<MCP.SetLevelRequest, MCP.EmptyResult>({ method: 'logging/setLevel', params }, token);
	}

	complete(params: MCP.CompleteRequest['params'], token?: CancellationToken): Promise<MCP.CompleteResult> {
		return this.sendRequest<MCP.CompleteRequest, MCP.CompleteResult>({ method: 'completion/complete', params }, token);
	}

	getTask(params: { taskId: string }, token?: CancellationToken): Promise<MCP.GetTaskResult> {
		return this.sendRequest<MCP.GetTaskRequest, MCP.GetTaskResult>({ method: 'tasks/get', params }, token);
	}

	getTaskResult(params: { taskId: string }, token?: CancellationToken): Promise<MCP.GetTaskPayloadResult> {
		return this.sendRequest<MCP.GetTaskPayloadRequest, MCP.GetTaskPayloadResult>({ method: 'tasks/result', params }, token);
	}

	cancelTask(params: { taskId: string }, token?: CancellationToken): Promise<MCP.CancelTaskResult> {
		return this.sendRequest<MCP.CancelTaskRequest, MCP.CancelTaskResult>({ method: 'tasks/cancel', params }, token);
	}

	listTasks(params?: MCP.ListTasksRequest['params'], token?: CancellationToken): Promise<MCP.Task[]> {
		return Iterable.asyncToArrayFlat(
			this.sendRequestPaginated<MCP.ListTasksRequest, MCP.ListTasksResult, MCP.Task>(
				'tasks/list', result => result.tasks, params, token
			)
		);
	}
}

function isTaskInTerminalState(task: MCP.Task): boolean {
	return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
}

/**
 * Implementation of a task that handles polling, status notifications, and handler reconnections. It implements the task polling loop internally and can also be
 * updated externally via `onDidUpdateState`, when notifications are received
 * for example.
 * @internal
 */
export class McpTask<T extends MCP.Result> extends Disposable implements IMcpTaskInternal {
	private readonly promise = new DeferredPromise<T>();

	public get result(): Promise<T> {
		return this.promise.p;
	}

	public get id() {
		return this._task.taskId;
	}

	private _lastTaskState: ISettableObservable<MCP.Task>;
	private _handler = observableValue<McpServerRequestHandler | undefined>('mcpTaskHandler', undefined);

	constructor(
		private readonly _task: MCP.Task,
		_token: CancellationToken = CancellationToken.None,
		private readonly _onStatusMessage?: (message: string) => void,
	) {
		super();

		const expiresAt = _task.ttl ? (Date.now() + _task.ttl) : undefined;
		this._lastTaskState = observableValue('lastTaskState', this._task);

		const store = this._register(new DisposableStore());

		if (_token.isCancellationRequested) {
			this._lastTaskState.set({ ...this._task, status: 'cancelled' }, undefined);
		} else {
			store.add(_token.onCancellationRequested(() => {
				const current = this._lastTaskState.get();
				if (!isTaskInTerminalState(current)) {
					this._lastTaskState.set({ ...current, status: 'cancelled' }, undefined);
				}
			}));
		}

		if (expiresAt) {
			const ttlTimeout = expiresAt - Date.now();
			if (ttlTimeout <= 0) {
				this._lastTaskState.set({ ...this._task, status: 'cancelled', statusMessage: 'Task timed out.' }, undefined);
			} else {
				store.add(disposableTimeout(() => {
					const current = this._lastTaskState.get();
					if (!isTaskInTerminalState(current)) {
						this._lastTaskState.set({ ...current, status: 'cancelled', statusMessage: 'Task timed out.' }, undefined);
					}
				}, ttlTimeout));
			}
		}

		const inputRequiredLookup = observableValue<ObservablePromise<MCP.Task> | undefined>('activeResultLookup', undefined);

		store.add(autorun(reader => {
			const current = this._lastTaskState.read(reader);
			if (isTaskInTerminalState(current)) {
				return;
			}

			const lookup = inputRequiredLookup.read(reader);
			if (lookup) {
				const result = lookup.promiseResult.read(reader);
				return transaction(tx => {
					if (!result) {
					} else if (result.data) {
						inputRequiredLookup.set(undefined, tx);
						this._lastTaskState.set(result.data, tx);
					} else {
						inputRequiredLookup.set(undefined, tx);
						if (result.error instanceof McpError && result.error.code === MCP.INVALID_PARAMS) {
							this._lastTaskState.set({ ...current, status: 'cancelled' }, undefined);
						} else {
							this._lastTaskState.set({ ...current, status: 'working' }, undefined);
						}
					}
				});
			}

			const handler = this._handler.read(reader);
			if (!handler) {
				return;
			}

			const pollInterval = _task.pollInterval ?? 2000;
			const cts = new CancellationTokenSource(_token);
			reader.store.add(toDisposable(() => cts.dispose(true)));
			reader.store.add(disposableTimeout(() => {
				handler.getTask({ taskId: current.taskId }, cts.token)
					.catch((e): MCP.Task | undefined => {
						if (e instanceof McpError && e.code === MCP.INVALID_PARAMS) {
							return { ...current, status: 'cancelled' };
						} else {
							return { ...current };
						}
					})
					.then(r => {
						if (r && !cts.token.isCancellationRequested) {
							this._lastTaskState.set(r, undefined);
						}
					});
			}, pollInterval));
		}));

		const lastStatus = this._lastTaskState.map(task => task.status);
		store.add(autorun(reader => {
			const status = lastStatus.read(reader);
			if (status === 'failed') {
				const current = this._lastTaskState.read(undefined);
				this.promise.error(new Error(`Task ${current.taskId} failed: ${current.statusMessage ?? 'unknown error'}`));
				store.dispose();
			} else if (status === 'cancelled') {
				this.promise.cancel();
				store.dispose();
			} else if (status === 'input_required') {
				const handler = this._handler.read(reader);
				if (handler) {
					const current = this._lastTaskState.read(undefined);
					const cts = new CancellationTokenSource(_token);
					reader.store.add(toDisposable(() => cts.dispose(true)));
					inputRequiredLookup.set(new ObservablePromise<MCP.Task>(handler.getTask({ taskId: current.taskId }, cts.token)), undefined);
				}
			} else if (status === 'completed') {
				const handler = this._handler.read(reader);
				if (handler) {
					this.promise.settleWith(handler.getTaskResult({ taskId: _task.taskId }, _token) as Promise<T>);
					store.dispose();
				}
			} else if (status === 'working') {
			} else {
				softAssertNever(status);
			}
		}));
	}

	onDidUpdateState(task: MCP.Task) {
		this._lastTaskState.set(task, undefined);
		if (task.statusMessage && this._onStatusMessage) {
			this._onStatusMessage(task.statusMessage);
		}
	}

	setHandler(handler: McpServerRequestHandler | undefined): void {
		this._handler.set(handler, undefined);
	}
}

function mapLogLevelToMcp(logLevel: LogLevel): MCP.LoggingLevel {
	switch (logLevel) {
		case LogLevel.Trace:
			return 'debug';
		case LogLevel.Debug:
			return 'debug';
		case LogLevel.Info:
			return 'info';
		case LogLevel.Warning:
			return 'warning';
		case LogLevel.Error:
			return 'error';
		case LogLevel.Off:
			return 'emergency';
		default:
			return assertNever(logLevel);
	}
}
