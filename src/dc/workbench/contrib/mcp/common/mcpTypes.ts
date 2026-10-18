/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals as arraysEqual } from '../../../../base/common/arrays.js';
import { assertNever } from '../../../../base/common/assert.js';
import { decodeHex, encodeHex, VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { equals as objectsEqual } from '../../../../base/common/objects.js';
import { IObservable, ObservableMap } from '../../../../base/common/observable.js';
import { IIterativePager } from '../../../../base/common/paging.js';
import { isEqual } from '../../../../base/common/resources.js';
import Severity from '../../../../base/common/severity.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { Location } from '../../../../editor/common/languages.js';
import { localize } from '../../../../nls.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { McpGalleryManifestStatus } from '../../../../platform/mcp/common/mcpGalleryManifest.js';
import { IGalleryMcpServer, IGalleryMcpServerConfiguration, IInstallableMcpServer, IQueryOptions } from '../../../../platform/mcp/common/mcpManagement.js';
import { IMcpDevModeConfig, IMcpSandboxConfiguration, IMcpServerConfiguration, McpServerType } from '../../../../platform/mcp/common/mcpPlatformTypes.js';
import { StorageScope } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceFolder, IWorkspaceFolderData } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchLocalMcpServer, IWorkbencMcpServerInstallOptions, WORKSPACE_FOLDER_CONFIG_ID_PREFIX } from '../../../services/mcp/common/mcpWorkbenchManagementService.js';
import { ContributionEnablementState, IEnablementModel } from '../../chat/common/enablement.js';
import { ToolProgress } from '../../chat/common/tools/languageModelToolsService.js';
import { ExternalDiscoverySource, IMcpServerSamplingConfiguration } from './mcpConfiguration.js';
import { McpServerRequestHandler } from './mcpServerRequestHandler.js';
import { MCP } from './modelContextProtocol.js';
import { UriTemplate } from '../../../../base/common/uriTemplate.js';

export const extensionMcpCollectionPrefix = 'ext.';

export const MCP_CONFIGURATION_COLLECTION_ID_PREFIX = 'mcp.config.';
export const MCP_PLUGIN_COLLECTION_ID_PREFIX = 'plugin.';
export const CURSOR_WORKSPACE_MCP_COLLECTION_ID_PREFIX = 'cursor-workspace.';

export const enum McpCollectionProvenance {
	UserProfile = 'userProfile',
	RemoteUser = 'remoteUser',
	WorkspaceConfiguration = 'workspaceConfiguration',
	WorkspaceFolderConfiguration = 'workspaceFolderConfiguration',
	WorkspaceDotMcp = 'workspaceDotMcp',
	ExternalConfiguration = 'externalConfiguration',
	Extension = 'extension',
	Plugin = 'plugin',
}

export function getMcpCollectionProvenance(target: ConfigurationTarget | undefined): McpCollectionProvenance | undefined {
	switch (target) {
		case ConfigurationTarget.USER:
		case ConfigurationTarget.USER_LOCAL:
			return McpCollectionProvenance.UserProfile;
		case ConfigurationTarget.USER_REMOTE:
			return McpCollectionProvenance.RemoteUser;
		case ConfigurationTarget.WORKSPACE:
			return McpCollectionProvenance.WorkspaceConfiguration;
		case ConfigurationTarget.WORKSPACE_FOLDER:
			return McpCollectionProvenance.WorkspaceFolderConfiguration;
		default:
			return undefined;
	}
}

export const WORKSPACE_DOT_MCP_COLLECTION_ID_PREFIX = 'workspace-dot-mcp.';

export function extensionPrefixedIdentifier(identifier: ExtensionIdentifier, id: string): string {
	return ExtensionIdentifier.toKey(identifier) + '/' + id;
}

export interface McpCollectionDefinition {
	readonly remoteAuthority: string | null;
	readonly id: string;
	readonly provenance?: McpCollectionProvenance;
	readonly discoverySource?: ExternalDiscoverySource;
	readonly label: string;
	readonly serverDefinitions: IObservable<readonly McpServerDefinition[]>;
	readonly trustBehavior: McpServerTrust.Kind.Trusted | McpServerTrust.Kind.TrustedOnNonce;
	readonly scope: StorageScope;
	readonly configTarget: ConfigurationTarget;
	readonly sandbox?: IMcpSandboxConfiguration;

	resolveServerLanch?(definition: McpServerDefinition): Promise<McpServerLaunch | undefined>;

	readonly lazy?: {
		isCached: boolean;
		load(): Promise<void>;
		removed?(): void;
	};

	readonly source?: IWorkbenchMcpServer | ExtensionIdentifier;

	readonly order: number;

	readonly presentation?: {
		readonly origin?: URI;
	};
}

export const enum McpCollectionSortOrder {
	WorkspaceFolder = 0,
	Workspace = 100,
	User = 200,
	Extension = 300,
	Plugin = 350,
	Filesystem = 400,

	RemoteBoost = -50,
}

export namespace McpCollectionDefinition {
	export interface FromExtHost {
		readonly id: string;
		readonly label: string;
		readonly isTrustedByDefault: boolean;
		readonly scope: StorageScope;
		readonly canResolveLaunch: boolean;
		readonly extensionId: string;
		readonly configTarget: ConfigurationTarget;
	}

	export function equals(a: McpCollectionDefinition, b: McpCollectionDefinition): boolean {
		return a.id === b.id
			&& a.remoteAuthority === b.remoteAuthority
			&& a.label === b.label
			&& a.provenance === b.provenance
			&& a.discoverySource === b.discoverySource
			&& a.trustBehavior === b.trustBehavior
			&& objectsEqual(a.sandbox, b.sandbox);
	}

	export function isWorkspaceDiscovered(collection: McpCollectionDefinition): boolean {
		return collection.configTarget === ConfigurationTarget.WORKSPACE
			|| collection.configTarget === ConfigurationTarget.WORKSPACE_FOLDER;
	}

	export function isVscodeMcpJson(collection: McpCollectionDefinition): boolean {
		return collection.id.startsWith(`${MCP_CONFIGURATION_COLLECTION_ID_PREFIX}${WORKSPACE_FOLDER_CONFIG_ID_PREFIX}`);
	}
}

export interface McpServerDefinition {
	readonly id: string;
	readonly label: string;
	readonly launch: McpServerLaunch;
	readonly defaultCwd?: URI;
	readonly roots?: URI[] | undefined;
	readonly variableReplacement?: McpServerDefinitionVariableReplacement;
	readonly cacheNonce: string;
	readonly devMode?: IMcpDevModeConfig;
	readonly staticMetadata?: McpServerStaticMetadata;
	readonly sandboxEnabled?: boolean;


	readonly presentation?: {
		readonly order?: number;
		readonly origin?: Location;
	};
}

export const enum McpServerStaticToolAvailability {
	Initial,
	Dynamic,
}

export interface McpServerStaticMetadata {
	tools?: { availability: McpServerStaticToolAvailability; definition: MCP.Tool }[];
	instructions?: string;
	capabilities?: MCP.ServerCapabilities;
	serverInfo?: MCP.Implementation;
}

function objectsEqualWithUris(one: unknown, other: unknown): boolean {
	if (one === other) {
		return true;
	}
	if (URI.isUri(one) || URI.isUri(other)) {
		return URI.isUri(one) && URI.isUri(other) && isEqual(one, other);
	}
	if (one === null || one === undefined || other === null || other === undefined) {
		return false;
	}
	if (typeof one !== typeof other || typeof one !== 'object') {
		return false;
	}
	if (Array.isArray(one) !== Array.isArray(other)) {
		return false;
	}
	if (Array.isArray(one) && Array.isArray(other)) {
		return arraysEqual(one, other, objectsEqualWithUris);
	}

	const oneKeys: string[] = [];
	for (const key in one) {
		oneKeys.push(key);
	}
	oneKeys.sort();

	const otherKeys: string[] = [];
	for (const key in other) {
		otherKeys.push(key);
	}
	otherKeys.sort();

	if (!arraysEqual(oneKeys, otherKeys)) {
		return false;
	}
	for (const key of oneKeys) {
		if (!objectsEqualWithUris(Reflect.get(one, key), Reflect.get(other, key))) {
			return false;
		}
	}
	return true;
}

export namespace McpServerDefinition {
	export interface Serialized {
		readonly id: string;
		readonly label: string;
		readonly cacheNonce: string;
		readonly launch: McpServerLaunch.Serialized;
		readonly defaultCwd?: UriComponents;
		readonly variableReplacement?: McpServerDefinitionVariableReplacement.Serialized;
		readonly staticMetadata?: McpServerStaticMetadata;
		readonly sandboxEnabled?: boolean;
	}

	export function toSerialized(def: McpServerDefinition): McpServerDefinition.Serialized {
		return def;
	}

	export function fromSerialized(def: McpServerDefinition.Serialized): McpServerDefinition {
		return {
			id: def.id,
			label: def.label,
			cacheNonce: def.cacheNonce,
			staticMetadata: def.staticMetadata,
			launch: McpServerLaunch.fromSerialized(def.launch),
			defaultCwd: def.defaultCwd ? URI.revive(def.defaultCwd) : undefined,
			sandboxEnabled: def.sandboxEnabled,
			variableReplacement: def.variableReplacement ? McpServerDefinitionVariableReplacement.fromSerialized(def.variableReplacement) : undefined,
		};
	}

	export function equals(a: McpServerDefinition, b: McpServerDefinition): boolean {
		return a.id === b.id
			&& a.label === b.label
			&& a.cacheNonce === b.cacheNonce
			&& isEqual(a.defaultCwd, b.defaultCwd)
			&& arraysEqual(a.roots, b.roots, (a, b) => a.toString() === b.toString())
			&& objectsEqualWithUris(a.launch, b.launch)
			&& objectsEqualWithUris(a.presentation, b.presentation)
			&& objectsEqualWithUris(a.variableReplacement, b.variableReplacement)
			&& objectsEqual(a.devMode, b.devMode)
			&& a.sandboxEnabled === b.sandboxEnabled;

	}
}


export interface McpServerDefinitionVariableReplacement {
	section?: string;
	folder?: IWorkspaceFolderData;
	target: ConfigurationTarget;
}

export namespace McpServerDefinitionVariableReplacement {
	export interface Serialized {
		target: ConfigurationTarget;
		section?: string;
		folder?: { name: string; index: number; uri: UriComponents };
	}

	export function toSerialized(def: McpServerDefinitionVariableReplacement): McpServerDefinitionVariableReplacement.Serialized {
		return def;
	}

	export function fromSerialized(def: McpServerDefinitionVariableReplacement.Serialized): McpServerDefinitionVariableReplacement {
		return {
			section: def.section,
			folder: def.folder ? { ...def.folder, uri: URI.revive(def.folder.uri) } : undefined,
			target: def.target,
		};
	}
}

export interface IAutostartResult {
	working: boolean;
	starting: McpDefinitionReference[];
	serversRequiringInteraction: Array<McpDefinitionReference & { errorMessage?: string }>;
}

export namespace IAutostartResult {
	export const Empty: IAutostartResult = { working: false, starting: [], serversRequiringInteraction: [] };
}

export interface IMcpService {
	_serviceBrand: undefined;
	readonly servers: IObservable<readonly IMcpServer[]>;

	readonly enablementModel: IEnablementModel;

	resetCaches(): void;

	resetTrust(): void;

	readonly lazyCollectionState: IObservable<{ state: LazyCollectionState; collections: McpCollectionDefinition[] }>;

	autostart(token?: CancellationToken): IObservable<IAutostartResult>;

	/** Cancels any current autostart @internal */
	cancelAutostart(): void;

	activateCollections(): Promise<void>;
}

export const enum LazyCollectionState {
	HasUnknown,
	LoadingUnknown,
	AllKnown,
}

export const IMcpService = createDecorator<IMcpService>('IMcpService');

export interface McpCollectionReference {
	id: string;
	label: string;
	order: number;
	presentation?: McpCollectionDefinition['presentation'];
}

export interface McpDefinitionReference {
	id: string;
	label: string;
}

export class McpStartServerInteraction {
	/** @internal */
	public readonly participants = new ObservableMap< string, { s: 'unknown' | 'resolved' } | { s: 'waiting'; definition: McpServerDefinition; collection: McpCollectionDefinition }>();
	choice?: Promise<string[] | undefined>;
}

export interface IMcpServerStartOpts {
	autoTrustChanges?: boolean;
	promptType?: 'only-new' | 'all-untrusted' | 'never';
	debug?: boolean;
	interaction?: McpStartServerInteraction;
	errorOnUserInteraction?: boolean;
}

export namespace McpServerTrust {
	export const enum Kind {
		Trusted,
		TrustedOnNonce,
		Untrusted,
		Unknown,
	}
}

export interface IMcpServer extends IDisposable {
	readonly collection: McpCollectionReference;
	readonly definition: McpDefinitionReference;
	readonly enablement: IObservable<ContributionEnablementState>;
	readonly connection: IObservable<IMcpServerConnection | undefined>;
	readonly connectionState: IObservable<McpConnectionState>;
	readonly serverMetadata: IObservable<{
		serverName?: string;
		serverInstructions?: string;
		icons: IMcpIcons;
	} | undefined>;

	readDefinitions(): IObservable<{ server: McpServerDefinition | undefined; collection: McpCollectionDefinition | undefined }>;

	showOutput(preserveFocus?: boolean): Promise<void>;
	start(opts?: IMcpServerStartOpts): Promise<McpConnectionState>;
	stop(): Promise<void>;

	readonly cacheState: IObservable<McpServerCacheState>;
	readonly tools: IObservable<readonly IMcpTool[]>;
	readonly prompts: IObservable<readonly IMcpPrompt[]>;
	readonly capabilities: IObservable<McpCapability | undefined>;

	resources(token?: CancellationToken): AsyncIterable<IMcpResource[]>;

	resourceTemplates(token?: CancellationToken): Promise<IMcpResourceTemplate[]>;
}

export interface IMcpResource {
	readonly uri: URI;
	readonly mcpUri: string;
	readonly name: string;
	readonly title?: string;
	readonly description?: string;
	readonly mimeType?: string;
	readonly sizeInBytes?: number;
	readonly icons: IMcpIcons;
}

export interface IMcpResourceTemplate {
	readonly name: string;
	readonly title?: string;
	readonly description?: string;
	readonly mimeType?: string;
	readonly template: UriTemplate;
	readonly icons: IMcpIcons;

	complete(templatePart: string, prefix: string, alreadyResolved: Record<string, string | string[]>, token: CancellationToken): Promise<string[]>;

	resolveURI(vars: Record<string, unknown>): URI;
}

export const isMcpResourceTemplate = (obj: IMcpResource | IMcpResourceTemplate): obj is IMcpResourceTemplate => {
	return (obj as IMcpResourceTemplate).template !== undefined;
};
export const isMcpResource = (obj: IMcpResource | IMcpResourceTemplate): obj is IMcpResource => {
	return (obj as IMcpResource).mcpUri !== undefined;
};

export const enum McpServerCacheState {
	Unknown,
	Cached,
	Outdated,
	RefreshingFromUnknown,
	RefreshingFromCached,
	Live,
}

export interface IMcpPrompt {
	readonly id: string;
	readonly name: string;
	readonly title?: string;
	readonly description?: string;
	readonly arguments: readonly MCP.PromptArgument[];

	complete(argument: string, prefix: string, alreadyResolved: Record<string, string>, token: CancellationToken): Promise<string[]>;

	resolve(args: Record<string, string | undefined>, token?: CancellationToken): Promise<IMcpPromptMessage[]>;
}

export const mcpPromptReplaceSpecialChars = (s: string) => s.replace(/[^a-z0-9_.-]/gi, '_');

export const mcpPromptPrefix = (definition: McpDefinitionReference) =>
	`/mcp.` + mcpPromptReplaceSpecialChars(definition.label);

export interface IMcpPromptMessage extends MCP.PromptMessage { }

export interface IMcpToolCallContext {
	chatSessionResource: URI | undefined;
	chatRequestId?: string;
	traceparent?: string;
	tracestate?: string;
}

export const enum McpToolVisibility {
	Model = 1 << 0,
	App = 1 << 1,
}

export type IMcpToolCallUIData =
	| {
		readonly kind: 'local';
		readonly resourceUri: string;
		readonly serverDefinitionId: string;
		readonly collectionId: string;
	}
	| {
		readonly kind: 'agentHost';
		readonly resourceUri: string;
		readonly connectionAuthority: string;
		readonly channel: string;
		readonly serverId: string;
	};

export interface IMcpTool {

	readonly id: string;
	readonly referenceName: string;
	readonly icons: IMcpIcons;
	readonly definition: MCP.Tool;
	readonly visibility: McpToolVisibility;
	readonly uiResourceUri?: string;

	call(params: Record<string, unknown>, context?: IMcpToolCallContext, token?: CancellationToken): Promise<MCP.CallToolResult>;

	callWithProgress(params: Record<string, unknown>, progress: ToolProgress, context?: IMcpToolCallContext, token?: CancellationToken): Promise<MCP.CallToolResult>;
}

export const enum McpServerTransportType {
	Stdio = 1 << 0,
	HTTP = 1 << 1,
}

export interface McpServerTransportStdio {
	readonly type: McpServerTransportType.Stdio;
	readonly cwd: string | undefined;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Record<string, string | number | null>;
	readonly envFile: string | undefined;
	readonly sandbox: IMcpSandboxConfiguration | undefined;
}

export interface McpServerTransportHTTPAuthentication {
	readonly providerId: string;
	readonly scopes: string[];
}

export interface McpServerTransportHTTPOAuth {
	readonly clientId?: string;
	readonly enterpriseManaged?: boolean;
}

export function mcpOAuthClientSecretStorageKey(mcpServerUrl: string, clientId: string): string {
	return `mcp.oauth.clientSecret:${mcpServerUrl}:${clientId}`;
}

export interface McpServerTransportHTTP {
	readonly type: McpServerTransportType.HTTP;
	readonly transport?: 'sse' | 'streamable-http';
	readonly uri: URI;
	readonly headers: [string, string][];
	readonly oauth?: McpServerTransportHTTPOAuth;
	readonly authentication?: McpServerTransportHTTPAuthentication;
}

export type McpServerLaunch =
	| McpServerTransportStdio
	| McpServerTransportHTTP;

export namespace McpServerLaunch {
	export type Serialized =
		| { type: McpServerTransportType.HTTP; transport?: 'sse' | 'streamable-http'; uri: UriComponents; headers: [string, string][]; oauth?: McpServerTransportHTTPOAuth; authentication?: McpServerTransportHTTPAuthentication }
		| { type: McpServerTransportType.Stdio; cwd: string | undefined; command: string; args: readonly string[]; env: Record<string, string | number | null>; envFile: string | undefined; sandbox: IMcpSandboxConfiguration | undefined };

	export function toSerialized(launch: McpServerLaunch): McpServerLaunch.Serialized {
		return launch;
	}

	export function fromSerialized(launch: McpServerLaunch.Serialized): McpServerLaunch {
		switch (launch.type) {
			case McpServerTransportType.HTTP:
				return { type: launch.type, transport: launch.transport, uri: URI.revive(launch.uri), headers: launch.headers, oauth: launch.oauth, authentication: launch.authentication };
			case McpServerTransportType.Stdio:
				return {
					type: launch.type,
					cwd: launch.cwd,
					command: launch.command,
					args: launch.args,
					env: launch.env,
					envFile: launch.envFile,
					sandbox: launch.sandbox
				};
		}
	}

	export function fromServerConfiguration(configuration: IMcpServerConfiguration, sandbox?: IMcpSandboxConfiguration): McpServerLaunch | undefined {
		if (configuration.type === McpServerType.LOCAL) {
			return {
				type: McpServerTransportType.Stdio,
				command: configuration.command,
				args: configuration.args ? [...configuration.args] : [],
				env: configuration.env ? { ...configuration.env } : {},
				envFile: configuration.envFile,
				cwd: configuration.cwd,
				sandbox,
			};
		}

		try {
			return {
				type: McpServerTransportType.HTTP,
				...(configuration.transport === 'sse' ? { transport: 'sse' as const } : {}),
				uri: URI.parse(configuration.url),
				headers: Object.entries(configuration.headers ?? {}),
				oauth: configuration.oauth,
			};
		} catch {
			return undefined;
		}
	}

	export async function hash(launch: McpServerLaunch): Promise<string> {
		const nonce = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(launch)));
		return encodeHex(VSBuffer.wrap(new Uint8Array(nonce)));
	}
}

export interface IMcpPotentialSandboxBlock {
	readonly kind: 'network' | 'filesystem';
	readonly message: string;
	readonly host?: string;
	readonly path?: string;
}

export interface IMcpServerConnection extends IDisposable {
	readonly definition: McpServerDefinition;
	readonly state: IObservable<McpConnectionState>;
	readonly handler: IObservable<McpServerRequestHandler | undefined>;
	readonly onPotentialSandboxBlock: Event<IMcpPotentialSandboxBlock>;

	readonly launchDefinition: McpServerLaunch;

	start(methods: IMcpClientMethods): Promise<McpConnectionState>;

	stop(): Promise<void>;
}

export interface IMcpClientMethods {
	createMessageRequestHandler?(req: MCP.CreateMessageRequest['params'], token?: CancellationToken): Promise<MCP.CreateMessageResult>;
	elicitationRequestHandler?(req: MCP.ElicitRequest['params'], token?: CancellationToken): Promise<MCP.ElicitResult>;
}

export namespace McpConnectionState {
	export const enum Kind {
		Stopped,
		Starting,
		Running,
		Error,
	}

	export const toString = (s: McpConnectionState): string => {
		switch (s.state) {
			case Kind.Stopped:
				return localize('mcpstate.stopped', 'Stopped');
			case Kind.Starting:
				return localize('mcpstate.starting', 'Starting');
			case Kind.Running:
				return localize('mcpstate.running', 'Running');
			case Kind.Error:
				return localize('mcpstate.error', 'Error {0}', s.message);
			default:
				assertNever(s);
		}
	};

	export const toKindString = (s: McpConnectionState.Kind): string => {
		switch (s) {
			case Kind.Stopped:
				return 'stopped';
			case Kind.Starting:
				return 'starting';
			case Kind.Running:
				return 'running';
			case Kind.Error:
				return 'error';
			default:
				assertNever(s);
		}
	};

	export const canBeStarted = (s: Kind) => s === Kind.Error || s === Kind.Stopped;

	export const isRunning = (s: McpConnectionState) => !canBeStarted(s.state);

	export interface Stopped {
		readonly state: Kind.Stopped;
		readonly reason?: 'needs-user-interaction';
	}

	export interface Starting {
		readonly state: Kind.Starting;
	}

	export interface Running {
		readonly state: Kind.Running;
	}

	export interface Error {
		readonly state: Kind.Error;
		readonly code?: string;
		readonly shouldRetry?: boolean;
		readonly message: string;
	}
}

export type McpConnectionState =
	| McpConnectionState.Stopped
	| McpConnectionState.Starting
	| McpConnectionState.Running
	| McpConnectionState.Error;

export class MpcResponseError extends Error {
	constructor(message: string, public readonly code: number, public readonly data: unknown) {
		super(`MPC ${code}: ${message}`);
	}
}

export class McpConnectionFailedError extends Error { }

export class UserInteractionRequiredError extends Error {
	private static readonly prefix = 'User interaction required: ';

	public static is(error: Error): boolean {
		return error.message.startsWith(this.prefix);
	}

	constructor(public readonly reason: string) {
		super(`${UserInteractionRequiredError.prefix}${reason}`);
	}
}

export interface IMcpConfigPath {
	id: string;
	key: 'userLocalValue' | 'userRemoteValue' | 'workspaceValue' | 'workspaceFolderValue';
	label: string;
	scope: StorageScope;
	target: ConfigurationTarget;
	order: number;
	remoteAuthority?: string;
	uri: URI | undefined;
	section?: string[];
	workspaceFolder?: IWorkspaceFolder;
}

export interface IMcpServerContainer extends IDisposable {
	mcpServer: IWorkbenchMcpServer | null;
	update(): void;
}

export interface IMcpServerEditorOptions extends IEditorOptions {
	tab?: McpServerEditorTab;
	sideByside?: boolean;
}

export const enum McpServerEnablementState {
	Disabled,
	DisabledByAccess,
	DisabledProfile,
	DisabledWorkspace,
	Enabled,
}

export const enum McpServerInstallState {
	Installing,
	Installed,
	Uninstalling,
	Uninstalled
}

export const enum McpServerEditorTab {
	Readme = 'readme',
	Manifest = 'manifest',
	Configuration = 'configuration',
}

export type McpServerEnablementStatus = {
	readonly state: McpServerEnablementState;
	readonly message?: {
		readonly severity: Severity;
		readonly text: IMarkdownString;
	};
};

export interface IWorkbenchMcpServer {
	readonly gallery: IGalleryMcpServer | undefined;
	readonly local: IWorkbenchLocalMcpServer | undefined;
	readonly installable: IInstallableMcpServer | undefined;
	readonly installState: McpServerInstallState;
	readonly runtimeStatus: McpServerEnablementStatus | undefined;
	readonly id: string;
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly icon?: {
		readonly dark: string;
		readonly light: string;
	};
	readonly codicon?: string;
	readonly publisherUrl?: string;
	readonly publisherDisplayName?: string;
	readonly starsCount?: number;
	readonly license?: string;
	readonly repository?: string;
	readonly config?: IMcpServerConfiguration | undefined;
	readonly readmeUrl?: URI;
	getReadme(token: CancellationToken): Promise<string>;
	getManifest(token: CancellationToken): Promise<IGalleryMcpServerConfiguration>;
}

export const IMcpWorkbenchService = createDecorator<IMcpWorkbenchService>('IMcpWorkbenchService');
export interface IMcpWorkbenchService {
	readonly _serviceBrand: undefined;
	readonly onChange: Event<IWorkbenchMcpServer | undefined>;
	readonly onReset: Event<void>;
	readonly local: readonly IWorkbenchMcpServer[];
	readonly whenInitialLocalMcpServersLoaded: Promise<void>;
	getEnabledLocalMcpServers(): IWorkbenchLocalMcpServer[];
	queryLocal(): Promise<IWorkbenchMcpServer[]>;
	queryGallery(options?: IQueryOptions, token?: CancellationToken): Promise<IIterativePager<IWorkbenchMcpServer>>;
	canInstall(mcpServer: IWorkbenchMcpServer): true | IMarkdownString;
	install(server: IWorkbenchMcpServer, installOptions?: IWorkbencMcpServerInstallOptions): Promise<IWorkbenchMcpServer>;
	uninstall(mcpServer: IWorkbenchMcpServer): Promise<void>;
	getMcpConfigPath(arg: IWorkbenchLocalMcpServer): IMcpConfigPath | undefined;
	getMcpConfigPath(arg: URI): Promise<IMcpConfigPath | undefined>;
	openSearch(searchValue: string, preserveFocus?: boolean): Promise<void>;
	open(extension: IWorkbenchMcpServer | string, options?: IMcpServerEditorOptions): Promise<void>;
}

export class McpServerContainers extends Disposable {
	constructor(
		private readonly containers: IMcpServerContainer[],
		@IMcpWorkbenchService mcpWorkbenchService: IMcpWorkbenchService
	) {
		super();
		this._register(mcpWorkbenchService.onChange(this.update, this));
	}

	set mcpServer(extension: IWorkbenchMcpServer | null) {
		this.containers.forEach(c => c.mcpServer = extension);
	}

	update(server: IWorkbenchMcpServer | undefined): void {
		for (const container of this.containers) {
			if (server && container.mcpServer) {
				if (server.id === container.mcpServer.id) {
					container.mcpServer = server;
				}
			} else {
				container.update();
			}
		}
	}
}

export const McpServersGalleryStatusContext = new RawContextKey<string>('mcpServersGalleryStatus', McpGalleryManifestStatus.Unavailable);
export const HasInstalledMcpServersContext = new RawContextKey<boolean>('hasInstalledMcpServers', true);
export const InstalledMcpServersViewId = 'workbench.views.mcp.installed';

export namespace McpResourceURI {
	export const scheme = 'mcp-resource';

	const emptyAuthorityPlaceholder = 'dylo78gyp';

	export function fromServer(def: McpDefinitionReference, resourceURI: URI | string): URI {
		if (typeof resourceURI === 'string') {
			resourceURI = URI.parse(resourceURI);
		}
		return resourceURI.with({
			scheme,
			authority: encodeHex(VSBuffer.fromString(def.id)),
			path: ['', resourceURI.scheme, resourceURI.authority || emptyAuthorityPlaceholder].join('/') + resourceURI.path,
		});
	}

	export function toServer(uri: URI | string): { definitionId: string; resourceURL: URL } {
		if (typeof uri === 'string') {
			uri = URI.parse(uri);
		}
		if (uri.scheme !== scheme) {
			throw new Error(`Invalid MCP resource URI: ${uri.toString()}`);
		}
		const parts = uri.path.split('/');
		if (parts.length < 3) {
			throw new Error(`Invalid MCP resource URI: ${uri.toString()}`);
		}
		const [, serverScheme, authority, ...path] = parts;

		const url = new URL(`${serverScheme}://${authority.toLowerCase() === emptyAuthorityPlaceholder ? '' : authority}`);
		url.pathname = path.length ? ('/' + path.join('/')) : '';
		url.search = uri.query;
		url.hash = uri.fragment;

		return {
			definitionId: decodeHex(uri.authority).toString(),
			resourceURL: url,
		};
	}

}

export const enum McpCapability {
	Logging = 1 << 0,
	Completions = 1 << 1,
	Prompts = 1 << 2,
	PromptsListChanged = 1 << 3,
	Resources = 1 << 4,
	ResourcesSubscribe = 1 << 5,
	ResourcesListChanged = 1 << 6,
	Tools = 1 << 7,
	ToolsListChanged = 1 << 8,
}

export interface ISamplingOptions {
	server: IMcpServer;
	isDuringToolCall: boolean;
	params: MCP.CreateMessageRequest['params'];
}

export interface ISamplingResult {
	sample: MCP.CreateMessageResult;
}

export interface IMcpSamplingService {
	_serviceBrand: undefined;

	sample(opts: ISamplingOptions, token?: CancellationToken): Promise<ISamplingResult>;

	hasLogs(server: IMcpServer): boolean;
	getLogText(server: IMcpServer): string;

	getConfig(server: IMcpServer): IMcpServerSamplingConfiguration;
	updateConfig(server: IMcpServer, mutate: (r: IMcpServerSamplingConfiguration) => unknown): Promise<IMcpServerSamplingConfiguration>;
}

export const IMcpSamplingService = createDecorator<IMcpSamplingService>('IMcpServerSampling');

export class McpError extends Error {
	public static methodNotFound(method: string) {
		return new McpError(MCP.METHOD_NOT_FOUND, `Method not found: ${method}`);
	}

	public static notAllowed() {
		return new McpError(-32000, 'The user has denied permission to call this method.');
	}

	public static unknown(e: Error) {
		const mcpError = new McpError(MCP.INTERNAL_ERROR, `Unknown error: ${e.stack}`);
		mcpError.cause = e;
		return mcpError;
	}

	constructor(
		public readonly code: number,
		message: string,
		public readonly data?: unknown
	) {
		super(message);
	}
}

export const enum McpToolName {
	Prefix = 'mcp_',
	MaxPrefixLen = 18,
	MaxLength = 64,
}


export interface IMcpElicitationService {
	_serviceBrand: undefined;

	elicit(server: IMcpServer, context: IMcpToolCallContext | undefined, elicitation: MCP.ElicitRequest['params'], token: CancellationToken): Promise<ElicitResult>;
}

export const enum ElicitationKind {
	Form,
	URL,
}

export interface IUrlModeElicitResult extends IDisposable {
	kind: ElicitationKind.URL;
	value: MCP.ElicitResult;
	wait: Promise<void>;
}

export interface IFormModeElicitResult extends IDisposable {
	kind: ElicitationKind.Form;
	value: MCP.ElicitResult;
}

export type ElicitResult = IUrlModeElicitResult | IFormModeElicitResult;

export const IMcpElicitationService = createDecorator<IMcpElicitationService>('IMcpElicitationService');

export const McpToolResourceLinkMimeType = 'application/vnd.code.resource-link';

export interface IMcpToolResourceLinkContents {
	uri: UriComponents;
	underlyingMimeType?: string;
}

export interface IMcpIcons {
	getUrl(size: number): { dark: URI; light?: URI } | undefined;
}
