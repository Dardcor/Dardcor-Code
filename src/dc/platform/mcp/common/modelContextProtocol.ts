/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-unexternalized-strings */

export namespace MCP {


}


export namespace MCP {

	export type JSONRPCMessage =
		| JSONRPCRequest
		| JSONRPCNotification
		| JSONRPCResponse;

	/** @internal */
	export const LATEST_PROTOCOL_VERSION = "2025-11-25";
	/** @internal */
	export const JSONRPC_VERSION = "2.0";

	export type MetaObject = Record<string, unknown>;

	export interface RequestMetaObject extends MetaObject {
		progressToken?: ProgressToken;
	}

	export type ProgressToken = string | number;

	export type Cursor = string;

	/**
	 * Common params for any task-augmented request.
	 *
	 * @internal
	 */
	export interface TaskAugmentedRequestParams extends RequestParams {
		task?: TaskMetadata;
	}

	export interface RequestParams {
		_meta?: RequestMetaObject;
	}

	/** @internal */
	export interface Request {
		method: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		params?: { [key: string]: any };
	}

	export interface NotificationParams {
		_meta?: MetaObject;
	}

	/** @internal */
	export interface Notification {
		method: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		params?: { [key: string]: any };
	}

	export interface Result {
		_meta?: MetaObject;
		[key: string]: unknown;
	}

	export interface Error {
		code: number;
		message: string;
		data?: unknown;
	}

	export type RequestId = string | number;

	export interface JSONRPCRequest extends Request {
		jsonrpc: typeof JSONRPC_VERSION;
		id: RequestId;
	}

	export interface JSONRPCNotification extends Notification {
		jsonrpc: typeof JSONRPC_VERSION;
	}

	export interface JSONRPCResultResponse {
		jsonrpc: typeof JSONRPC_VERSION;
		id: RequestId;
		result: Result;
	}

	export interface JSONRPCErrorResponse {
		jsonrpc: typeof JSONRPC_VERSION;
		id?: RequestId;
		error: Error;
	}

	export type JSONRPCResponse = JSONRPCResultResponse | JSONRPCErrorResponse;

	export const PARSE_ERROR = -32700;
	export const INVALID_REQUEST = -32600;
	export const METHOD_NOT_FOUND = -32601;
	export const INVALID_PARAMS = -32602;
	export const INTERNAL_ERROR = -32603;

	export interface ParseError extends Error {
		code: typeof PARSE_ERROR;
	}

	export interface InvalidRequestError extends Error {
		code: typeof INVALID_REQUEST;
	}

	export interface MethodNotFoundError extends Error {
		code: typeof METHOD_NOT_FOUND;
	}

	export interface InvalidParamsError extends Error {
		code: typeof INVALID_PARAMS;
	}

	export interface InternalError extends Error {
		code: typeof INTERNAL_ERROR;
	}

	/** @internal */
	export const URL_ELICITATION_REQUIRED = -32042;

	/**
	 * An error response that indicates that the server requires the client to provide additional information via an elicitation request.
	 *
	 * @example Authorization required
	 * {@includeCode ./examples/URLElicitationRequiredError/authorization-required.json}
	 *
	 * @internal
	 */
	export interface URLElicitationRequiredError extends Omit<
		JSONRPCErrorResponse,
		"error"
	> {
		error: Error & {
			code: typeof URL_ELICITATION_REQUIRED;
			data: {
				elicitations: ElicitRequestURLParams[];
				[key: string]: unknown;
			};
		};
	}

	export type EmptyResult = Result;

	export interface CancelledNotificationParams extends NotificationParams {
		requestId?: RequestId;

		reason?: string;
	}

	export interface CancelledNotification extends JSONRPCNotification {
		method: "notifications/cancelled";
		params: CancelledNotificationParams;
	}

	export interface InitializeRequestParams extends RequestParams {
		protocolVersion: string;
		capabilities: ClientCapabilities;
		clientInfo: Implementation;
	}

	export interface InitializeRequest extends JSONRPCRequest {
		method: "initialize";
		params: InitializeRequestParams;
	}

	export interface InitializeResult extends Result {
		protocolVersion: string;
		capabilities: ServerCapabilities;
		serverInfo: Implementation;

		instructions?: string;
	}

	export interface InitializeResultResponse extends JSONRPCResultResponse {
		result: InitializeResult;
	}

	export interface InitializedNotification extends JSONRPCNotification {
		method: "notifications/initialized";
		params?: NotificationParams;
	}

	export interface ClientCapabilities {
		experimental?: { [key: string]: object };
		roots?: {
			listChanged?: boolean;
		};
		sampling?: {
			context?: object;
			tools?: object;
		};
		elicitation?: { form?: object; url?: object };

		tasks?: {
			list?: object;
			cancel?: object;
			requests?: {
				sampling?: {
					createMessage?: object;
				};
				elicitation?: {
					create?: object;
				};
			};
		};
		extensions?: { [key: string]: object };
	}

	export interface ServerCapabilities {
		experimental?: { [key: string]: object };
		logging?: object;
		completions?: object;
		prompts?: {
			listChanged?: boolean;
		};
		resources?: {
			subscribe?: boolean;
			listChanged?: boolean;
		};
		tools?: {
			listChanged?: boolean;
		};
		tasks?: {
			list?: object;
			cancel?: object;
			requests?: {
				tools?: {
					call?: object;
				};
			};
		};
		extensions?: { [key: string]: object };
	}

	export interface Icon {
		src: string;

		mimeType?: string;

		sizes?: string[];

		theme?: "light" | "dark";
	}

	/**
	 * Base interface to add `icons` property.
	 *
	 * @internal
	 */
	export interface Icons {
		icons?: Icon[];
	}

	/**
	 * Base interface for metadata with name (identifier) and title (display name) properties.
	 *
	 * @internal
	 */
	export interface BaseMetadata {
		name: string;

		title?: string;
	}

	export interface Implementation extends BaseMetadata, Icons {
		version: string;

		description?: string;

		websiteUrl?: string;
	}

	export interface PingRequest extends JSONRPCRequest {
		method: "ping";
		params?: RequestParams;
	}

	export interface PingResultResponse extends JSONRPCResultResponse {
		result: EmptyResult;
	}


	export interface ProgressNotificationParams extends NotificationParams {
		progressToken: ProgressToken;
		progress: number;
		total?: number;
		message?: string;
	}

	export interface ProgressNotification extends JSONRPCNotification {
		method: "notifications/progress";
		params: ProgressNotificationParams;
	}

	export interface PaginatedRequestParams extends RequestParams {
		cursor?: Cursor;
	}

	/** @internal */
	export interface PaginatedRequest extends JSONRPCRequest {
		params?: PaginatedRequestParams;
	}

	/** @internal */
	export interface PaginatedResult extends Result {
		nextCursor?: Cursor;
	}

	export interface ListResourcesRequest extends PaginatedRequest {
		method: "resources/list";
	}

	export interface ListResourcesResult extends PaginatedResult {
		resources: Resource[];
	}

	export interface ListResourcesResultResponse extends JSONRPCResultResponse {
		result: ListResourcesResult;
	}

	export interface ListResourceTemplatesRequest extends PaginatedRequest {
		method: "resources/templates/list";
	}

	export interface ListResourceTemplatesResult extends PaginatedResult {
		resourceTemplates: ResourceTemplate[];
	}

	export interface ListResourceTemplatesResultResponse extends JSONRPCResultResponse {
		result: ListResourceTemplatesResult;
	}

	/**
	 * Common params for resource-related requests.
	 *
	 * @internal
	 */
	export interface ResourceRequestParams extends RequestParams {
		uri: string;
	}

	export interface ReadResourceRequestParams extends ResourceRequestParams { }

	export interface ReadResourceRequest extends JSONRPCRequest {
		method: "resources/read";
		params: ReadResourceRequestParams;
	}

	export interface ReadResourceResult extends Result {
		contents: (TextResourceContents | BlobResourceContents)[];
	}

	export interface ReadResourceResultResponse extends JSONRPCResultResponse {
		result: ReadResourceResult;
	}

	export interface ResourceListChangedNotification extends JSONRPCNotification {
		method: "notifications/resources/list_changed";
		params?: NotificationParams;
	}

	export interface SubscribeRequestParams extends ResourceRequestParams { }

	export interface SubscribeRequest extends JSONRPCRequest {
		method: "resources/subscribe";
		params: SubscribeRequestParams;
	}

	export interface SubscribeResultResponse extends JSONRPCResultResponse {
		result: EmptyResult;
	}

	export interface UnsubscribeRequestParams extends ResourceRequestParams { }

	export interface UnsubscribeRequest extends JSONRPCRequest {
		method: "resources/unsubscribe";
		params: UnsubscribeRequestParams;
	}

	export interface UnsubscribeResultResponse extends JSONRPCResultResponse {
		result: EmptyResult;
	}

	export interface ResourceUpdatedNotificationParams extends NotificationParams {
		uri: string;
	}

	export interface ResourceUpdatedNotification extends JSONRPCNotification {
		method: "notifications/resources/updated";
		params: ResourceUpdatedNotificationParams;
	}

	export interface Resource extends BaseMetadata, Icons {
		uri: string;

		description?: string;

		mimeType?: string;

		annotations?: Annotations;

		size?: number;

		_meta?: MetaObject;
	}

	export interface ResourceTemplate extends BaseMetadata, Icons {
		uriTemplate: string;

		description?: string;

		mimeType?: string;

		annotations?: Annotations;

		_meta?: MetaObject;
	}

	/**
	 * The contents of a specific resource or sub-resource.
	 *
	 * @internal
	 */
	export interface ResourceContents {
		uri: string;
		mimeType?: string;

		_meta?: MetaObject;
	}

	export interface TextResourceContents extends ResourceContents {
		text: string;
	}

	export interface BlobResourceContents extends ResourceContents {
		blob: string;
	}

	export interface ListPromptsRequest extends PaginatedRequest {
		method: "prompts/list";
	}

	export interface ListPromptsResult extends PaginatedResult {
		prompts: Prompt[];
	}

	export interface ListPromptsResultResponse extends JSONRPCResultResponse {
		result: ListPromptsResult;
	}

	export interface GetPromptRequestParams extends RequestParams {
		name: string;
		arguments?: { [key: string]: string };
	}

	export interface GetPromptRequest extends JSONRPCRequest {
		method: "prompts/get";
		params: GetPromptRequestParams;
	}

	export interface GetPromptResult extends Result {
		description?: string;
		messages: PromptMessage[];
	}

	export interface GetPromptResultResponse extends JSONRPCResultResponse {
		result: GetPromptResult;
	}

	export interface Prompt extends BaseMetadata, Icons {
		description?: string;

		arguments?: PromptArgument[];

		_meta?: MetaObject;
	}

	export interface PromptArgument extends BaseMetadata {
		description?: string;
		required?: boolean;
	}

	export type Role = "user" | "assistant";

	export interface PromptMessage {
		role: Role;
		content: ContentBlock;
	}

	export interface ResourceLink extends Resource {
		type: "resource_link";
	}

	export interface EmbeddedResource {
		type: "resource";
		resource: TextResourceContents | BlobResourceContents;

		annotations?: Annotations;

		_meta?: MetaObject;
	}
	export interface PromptListChangedNotification extends JSONRPCNotification {
		method: "notifications/prompts/list_changed";
		params?: NotificationParams;
	}

	export interface ListToolsRequest extends PaginatedRequest {
		method: "tools/list";
	}

	export interface ListToolsResult extends PaginatedResult {
		tools: Tool[];
	}

	export interface ListToolsResultResponse extends JSONRPCResultResponse {
		result: ListToolsResult;
	}

	export interface CallToolResult extends Result {
		content: ContentBlock[];

		structuredContent?: { [key: string]: unknown };

		isError?: boolean;
	}

	export interface CallToolResultResponse extends JSONRPCResultResponse {
		result: CallToolResult;
	}

	export interface CallToolRequestParams extends TaskAugmentedRequestParams {
		name: string;
		arguments?: { [key: string]: unknown };
	}

	export interface CallToolRequest extends JSONRPCRequest {
		method: "tools/call";
		params: CallToolRequestParams;
	}

	export interface ToolListChangedNotification extends JSONRPCNotification {
		method: "notifications/tools/list_changed";
		params?: NotificationParams;
	}

	export interface ToolAnnotations {
		title?: string;

		readOnlyHint?: boolean;

		destructiveHint?: boolean;

		idempotentHint?: boolean;

		openWorldHint?: boolean;
	}

	export interface ToolExecution {
		taskSupport?: "forbidden" | "optional" | "required";
	}

	export interface Tool extends BaseMetadata, Icons {
		description?: string;

		inputSchema: {
			$schema?: string;
			type: "object";
			properties?: { [key: string]: object };
			required?: string[];
		};

		execution?: ToolExecution;

		outputSchema?: {
			$schema?: string;
			type: "object";
			properties?: { [key: string]: object };
			required?: string[];
		};

		annotations?: ToolAnnotations;

		_meta?: MetaObject;
	}


	export type TaskStatus =
		| "working"
		| "input_required"
		| "completed"
		| "failed"
		| "cancelled";

	export interface TaskMetadata {
		ttl?: number;
	}

	export interface RelatedTaskMetadata {
		taskId: string;
	}

	export interface Task {
		taskId: string;

		status: TaskStatus;

		statusMessage?: string;

		createdAt: string;

		lastUpdatedAt: string;

		ttl: number | null;

		pollInterval?: number;
	}

	export interface CreateTaskResult extends Result {
		task: Task;
	}

	export interface CreateTaskResultResponse extends JSONRPCResultResponse {
		result: CreateTaskResult;
	}

	export interface GetTaskRequest extends JSONRPCRequest {
		method: "tasks/get";
		params: {
			taskId: string;
		};
	}

	export type GetTaskResult = Result & Task;

	export interface GetTaskResultResponse extends JSONRPCResultResponse {
		result: GetTaskResult;
	}

	export interface GetTaskPayloadRequest extends JSONRPCRequest {
		method: "tasks/result";
		params: {
			taskId: string;
		};
	}

	export interface GetTaskPayloadResult extends Result {
		[key: string]: unknown;
	}

	export interface GetTaskPayloadResultResponse extends JSONRPCResultResponse {
		result: GetTaskPayloadResult;
	}

	export interface CancelTaskRequest extends JSONRPCRequest {
		method: "tasks/cancel";
		params: {
			taskId: string;
		};
	}

	export type CancelTaskResult = Result & Task;

	export interface CancelTaskResultResponse extends JSONRPCResultResponse {
		result: CancelTaskResult;
	}

	export interface ListTasksRequest extends PaginatedRequest {
		method: "tasks/list";
	}

	export interface ListTasksResult extends PaginatedResult {
		tasks: Task[];
	}

	export interface ListTasksResultResponse extends JSONRPCResultResponse {
		result: ListTasksResult;
	}

	export type TaskStatusNotificationParams = NotificationParams & Task;

	export interface TaskStatusNotification extends JSONRPCNotification {
		method: "notifications/tasks/status";
		params: TaskStatusNotificationParams;
	}


	export interface SetLevelRequestParams extends RequestParams {
		level: LoggingLevel;
	}

	export interface SetLevelRequest extends JSONRPCRequest {
		method: "logging/setLevel";
		params: SetLevelRequestParams;
	}

	export interface SetLevelResultResponse extends JSONRPCResultResponse {
		result: EmptyResult;
	}

	export interface LoggingMessageNotificationParams extends NotificationParams {
		level: LoggingLevel;
		logger?: string;
		data: unknown;
	}

	export interface LoggingMessageNotification extends JSONRPCNotification {
		method: "notifications/message";
		params: LoggingMessageNotificationParams;
	}

	export type LoggingLevel =
		| "debug"
		| "info"
		| "notice"
		| "warning"
		| "error"
		| "critical"
		| "alert"
		| "emergency";

	export interface CreateMessageRequestParams extends TaskAugmentedRequestParams {
		messages: SamplingMessage[];
		modelPreferences?: ModelPreferences;
		systemPrompt?: string;
		includeContext?: "none" | "thisServer" | "allServers";
		temperature?: number;
		maxTokens: number;
		stopSequences?: string[];
		metadata?: object;
		tools?: Tool[];
		toolChoice?: ToolChoice;
	}

	export interface ToolChoice {
		mode?: "auto" | "required" | "none";
	}

	export interface CreateMessageRequest extends JSONRPCRequest {
		method: "sampling/createMessage";
		params: CreateMessageRequestParams;
	}

	export interface CreateMessageResult extends Result, SamplingMessage {
		model: string;

		stopReason?: "endTurn" | "stopSequence" | "maxTokens" | "toolUse" | string;
	}

	export interface CreateMessageResultResponse extends JSONRPCResultResponse {
		result: CreateMessageResult;
	}

	export interface SamplingMessage {
		role: Role;
		content: SamplingMessageContentBlock | SamplingMessageContentBlock[];
		_meta?: MetaObject;
	}

	export type SamplingMessageContentBlock =
		| TextContent
		| ImageContent
		| AudioContent
		| ToolUseContent
		| ToolResultContent;

	export interface Annotations {
		audience?: Role[];

		priority?: number;

		lastModified?: string;
	}

	export type ContentBlock =
		| TextContent
		| ImageContent
		| AudioContent
		| ResourceLink
		| EmbeddedResource;

	export interface TextContent {
		type: "text";

		text: string;

		annotations?: Annotations;

		_meta?: MetaObject;
	}

	export interface ImageContent {
		type: "image";

		data: string;

		mimeType: string;

		annotations?: Annotations;

		_meta?: MetaObject;
	}

	export interface AudioContent {
		type: "audio";

		data: string;

		mimeType: string;

		annotations?: Annotations;

		_meta?: MetaObject;
	}

	export interface ToolUseContent {
		type: "tool_use";

		id: string;

		name: string;

		input: { [key: string]: unknown };

		_meta?: MetaObject;
	}

	export interface ToolResultContent {
		type: "tool_result";

		toolUseId: string;

		content: ContentBlock[];

		structuredContent?: { [key: string]: unknown };

		isError?: boolean;

		_meta?: MetaObject;
	}

	export interface ModelPreferences {
		hints?: ModelHint[];

		costPriority?: number;

		speedPriority?: number;

		intelligencePriority?: number;
	}

	export interface ModelHint {
		name?: string;
	}

	export interface CompleteRequestParams extends RequestParams {
		ref: PromptReference | ResourceTemplateReference;
		argument: {
			name: string;
			value: string;
		};

		context?: {
			arguments?: { [key: string]: string };
		};
	}

	export interface CompleteRequest extends JSONRPCRequest {
		method: "completion/complete";
		params: CompleteRequestParams;
	}

	export interface CompleteResult extends Result {
		completion: {
			values: string[];
			total?: number;
			hasMore?: boolean;
		};
	}

	export interface CompleteResultResponse extends JSONRPCResultResponse {
		result: CompleteResult;
	}

	export interface ResourceTemplateReference {
		type: "ref/resource";
		uri: string;
	}

	export interface PromptReference extends BaseMetadata {
		type: "ref/prompt";
	}

	export interface ListRootsRequest extends JSONRPCRequest {
		method: "roots/list";
		params?: RequestParams;
	}

	export interface ListRootsResult extends Result {
		roots: Root[];
	}

	export interface ListRootsResultResponse extends JSONRPCResultResponse {
		result: ListRootsResult;
	}

	export interface Root {
		uri: string;
		name?: string;

		_meta?: MetaObject;
	}

	export interface RootsListChangedNotification extends JSONRPCNotification {
		method: "notifications/roots/list_changed";
		params?: NotificationParams;
	}

	export interface ElicitRequestFormParams extends TaskAugmentedRequestParams {
		mode?: "form";

		message: string;

		requestedSchema: {
			$schema?: string;
			type: "object";
			properties: {
				[key: string]: PrimitiveSchemaDefinition;
			};
			required?: string[];
		};
	}

	export interface ElicitRequestURLParams extends TaskAugmentedRequestParams {
		mode: "url";

		message: string;

		elicitationId: string;

		url: string;
	}

	export type ElicitRequestParams =
		| ElicitRequestFormParams
		| ElicitRequestURLParams;

	export interface ElicitRequest extends JSONRPCRequest {
		method: "elicitation/create";
		params: ElicitRequestParams;
	}

	export type PrimitiveSchemaDefinition =
		| StringSchema
		| NumberSchema
		| BooleanSchema
		| EnumSchema;

	export interface StringSchema {
		type: "string";
		title?: string;
		description?: string;
		minLength?: number;
		maxLength?: number;
		format?: "email" | "uri" | "date" | "date-time";
		default?: string;
	}

	export interface NumberSchema {
		type: "number" | "integer";
		title?: string;
		description?: string;
		minimum?: number;
		maximum?: number;
		default?: number;
	}

	export interface BooleanSchema {
		type: "boolean";
		title?: string;
		description?: string;
		default?: boolean;
	}

	export interface UntitledSingleSelectEnumSchema {
		type: "string";
		title?: string;
		description?: string;
		enum: string[];
		default?: string;
	}

	export interface TitledSingleSelectEnumSchema {
		type: "string";
		title?: string;
		description?: string;
		oneOf: Array<{
			const: string;
			title: string;
		}>;
		default?: string;
	}

	export type SingleSelectEnumSchema =
		| UntitledSingleSelectEnumSchema
		| TitledSingleSelectEnumSchema;

	export interface UntitledMultiSelectEnumSchema {
		type: "array";
		title?: string;
		description?: string;
		minItems?: number;
		maxItems?: number;
		items: {
			type: "string";
			enum: string[];
		};
		default?: string[];
	}

	export interface TitledMultiSelectEnumSchema {
		type: "array";
		title?: string;
		description?: string;
		minItems?: number;
		maxItems?: number;
		items: {
			anyOf: Array<{
				const: string;
				title: string;
			}>;
		};
		default?: string[];
	}

	export type MultiSelectEnumSchema =
		| UntitledMultiSelectEnumSchema
		| TitledMultiSelectEnumSchema;

	export interface LegacyTitledEnumSchema {
		type: "string";
		title?: string;
		description?: string;
		enum: string[];
		enumNames?: string[];
		default?: string;
	}

	export type EnumSchema =
		| SingleSelectEnumSchema
		| MultiSelectEnumSchema
		| LegacyTitledEnumSchema;

	export interface ElicitResult extends Result {
		action: "accept" | "decline" | "cancel";

		content?: { [key: string]: string | number | boolean | string[] };
	}

	export interface ElicitResultResponse extends JSONRPCResultResponse {
		result: ElicitResult;
	}

	export interface ElicitationCompleteNotification extends JSONRPCNotification {
		method: "notifications/elicitation/complete";
		params: {
			elicitationId: string;
		};
	}

	/** @internal */
	export type ClientRequest =
		| PingRequest
		| InitializeRequest
		| CompleteRequest
		| SetLevelRequest
		| GetPromptRequest
		| ListPromptsRequest
		| ListResourcesRequest
		| ListResourceTemplatesRequest
		| ReadResourceRequest
		| SubscribeRequest
		| UnsubscribeRequest
		| CallToolRequest
		| ListToolsRequest
		| GetTaskRequest
		| GetTaskPayloadRequest
		| ListTasksRequest
		| CancelTaskRequest;

	/** @internal */
	export type ClientNotification =
		| CancelledNotification
		| ProgressNotification
		| InitializedNotification
		| RootsListChangedNotification
		| TaskStatusNotification;

	/** @internal */
	export type ClientResult =
		| EmptyResult
		| CreateMessageResult
		| ListRootsResult
		| ElicitResult
		| GetTaskResult
		| GetTaskPayloadResult
		| ListTasksResult
		| CancelTaskResult;

	/** @internal */
	export type ServerRequest =
		| PingRequest
		| CreateMessageRequest
		| ListRootsRequest
		| ElicitRequest
		| GetTaskRequest
		| GetTaskPayloadRequest
		| ListTasksRequest
		| CancelTaskRequest;

	/** @internal */
	export type ServerNotification =
		| CancelledNotification
		| ProgressNotification
		| LoggingMessageNotification
		| ResourceUpdatedNotification
		| ResourceListChangedNotification
		| ToolListChangedNotification
		| PromptListChangedNotification
		| ElicitationCompleteNotification
		| TaskStatusNotification;

	/** @internal */
	export type ServerResult =
		| EmptyResult
		| InitializeResult
		| CompleteResult
		| GetPromptResult
		| ListPromptsResult
		| ListResourceTemplatesResult
		| ListResourcesResult
		| ReadResourceResult
		| CallToolResult
		| CreateTaskResult
		| ListToolsResult
		| GetTaskResult
		| GetTaskPayloadResult
		| ListTasksResult
		| CancelTaskResult;
}
