/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface MessageOptions {
		useCustom?: boolean;
	}

	export interface RemoteAuthorityResolverContext {
		resolveAttempt: number;
		execServer?: ExecServer;
	}

	export class ResolvedAuthority {
		readonly host: string;
		readonly port: number;
		readonly connectionToken: string | undefined;

		constructor(host: string, port: number, connectionToken?: string);
	}

	export interface ManagedMessagePassing {
		readonly onDidReceiveMessage: Event<Uint8Array>;
		readonly onDidClose: Event<Error | undefined>;
		readonly onDidEnd: Event<void>;

		send: (data: Uint8Array) => void;
		end: () => void;
		drain?: () => Thenable<void>;
	}

	export class ManagedResolvedAuthority {
		readonly makeConnection: () => Thenable<ManagedMessagePassing>;
		readonly connectionToken: string | undefined;

		constructor(makeConnection: () => Thenable<ManagedMessagePassing>, connectionToken?: string);
	}

	export interface ResolvedOptions {
		extensionHostEnv?: { [key: string]: string | null };

		isTrusted?: boolean;

		authenticationSessionForInitializingExtensions?: AuthenticationSession & { providerId: string };
	}

	export interface TunnelPrivacy {
		themeIcon: string;
		id: string;
		label: string;
	}

	export namespace env {
		export const appQuality: string | undefined;
		export const appCommit: string | undefined;
	}

	export interface TunnelOptions {
		remoteAddress: { port: number; host: string };
		localAddressPort?: number;
		label?: string;
		public?: boolean;
		privacy?: string;
		protocol?: string;
	}

	export interface TunnelDescription {
		remoteAddress: { port: number; host: string };
		localAddress: { port: number; host: string } | string;
		public?: boolean;
		privacy?: string;
		protocol?: string;
	}

	export interface Tunnel extends TunnelDescription {
		readonly onDidDispose: Event<void>;
		dispose(): void | Thenable<void>;
	}

	export interface TunnelInformation {
		environmentTunnels?: TunnelDescription[];

		tunnelFeatures?: {
			elevation: boolean;
			privacyOptions: TunnelPrivacy[];
			protocol?: boolean;
		};
	}

	export interface TunnelCreationOptions {
		elevationRequired?: boolean;
	}

	export enum CandidatePortSource {
		None = 0,
		Process = 1,
		Output = 2,
		Hybrid = 3
	}

	export type ResolverResult = (ResolvedAuthority | ManagedResolvedAuthority) & ResolvedOptions & TunnelInformation;

	export class RemoteAuthorityResolverError extends Error {
		static NotAvailable(message?: string, handled?: boolean): RemoteAuthorityResolverError;
		static TemporarilyNotAvailable(message?: string): RemoteAuthorityResolverError;

		constructor(message?: string);
	}

	export interface ExecServer {
		spawn(command: string, args: string[], options?: ExecServerSpawnOptions): Thenable<SpawnedCommand>;

		spawnRemoteServerConnector?(command: string, args: string[], options?: ExecServerSpawnOptions): Thenable<RemoteServerConnector>;

		downloadCliExecutable?(buildTarget: CliBuild, command: string, args: string[], options?: ExecServerSpawnOptions): Thenable<ProcessExit>;

		env(): Thenable<ExecEnvironment>;

		kill(processId: number): Thenable<void>;

		tcpConnect(
			host: string,
			port: number,
		): Thenable<{ stream: WriteStream & ReadStream; done: Thenable<void> }>;

		readonly fs: RemoteFileSystem;
	}

	export type ProcessEnv = Record<string, string>;

	export interface ExecServerSpawnOptions {
		readonly env?: ProcessEnv;
		readonly cwd?: string;
	}

	export interface SpawnedCommand {
		readonly stdin: WriteStream;
		readonly stdout: ReadStream;
		readonly stderr: ReadStream;
		readonly onExit: Thenable<ProcessExit>;
	}

	export interface RemoteServerConnector {
		readonly logs: ReadStream;
		readonly onExit: Thenable<ProcessExit>;
		connect(params: ServeParams): Thenable<ManagedMessagePassing>;
	}

	export interface ProcessExit {
		readonly status: number;
		readonly message?: string;
	}

	export interface ReadStream {
		readonly onDidReceiveMessage: Event<Uint8Array>;
		readonly onEnd: Thenable<void>;
	}

	export interface WriteStream {
		write(data: Uint8Array): void;
		end(): void;
	}

	export interface ServeParams {
		readonly socketId: number;
		readonly commit?: string;
		readonly quality: string;
		readonly extensions: string[];
		readonly compress?: boolean;
		readonly connectionToken?: string;
	}

	export interface CliBuild {
		readonly quality: string;
		readonly buildTarget: string;
		readonly commit: string;
	}

	export interface ExecEnvironment {
		readonly env: ProcessEnv;
		readonly osPlatform: string;
		readonly osRelease?: string;
	}

	export interface RemoteFileSystem {
		stat(path: string): Thenable<FileStat>;

		mkdirp(path: string): Thenable<void>;

		rm(path: string): Thenable<void>;

		read(path: string): Thenable<ReadStream>;

		write(path: string): Thenable<{ stream: WriteStream; done: Thenable<void> }>;

		connect(path: string): Thenable<{ stream: WriteStream & ReadStream; done: Thenable<void> }>;

		rename(fromPath: string, toPath: string): Thenable<void>;

		readdir(path: string): Thenable<DirectoryEntry[]>;
	}

	export interface DirectoryEntry {
		type: FileType;

		name: string;
	}

	export interface RemoteAuthorityResolver {
		resolve(authority: string, context: RemoteAuthorityResolverContext): ResolverResult | Thenable<ResolverResult>;

		resolveExecServer?(remoteAuthority: string, context: RemoteAuthorityResolverContext): ExecServer | Thenable<ExecServer>;

		getCanonicalURI?(uri: Uri): ProviderResult<Uri>;

		tunnelFactory?: (tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions) => Thenable<Tunnel> | undefined;

		showCandidatePort?: (host: string, port: number, detail: string) => Thenable<boolean>;

		tunnelFeatures?: {
			elevation: boolean;
			public: boolean;
			privacyOptions: TunnelPrivacy[];
		};

		candidatePortSource?: CandidatePortSource;
	}

	export interface ResourceLabelFormatter {
		scheme: string;
		authority?: string;
		formatting: ResourceLabelFormatting;
	}

	export interface ResourceLabelFormatting {
		label: string;
		// eslint-disable-next-line local/vscode-dts-literal-or-types, local/vscode-dts-string-type-literals
		separator: '/' | '\\' | '';
		tildify?: boolean;
		normalizeDriveLetter?: boolean;
		workspaceSuffix?: string;
		workspaceTooltip?: string;
		authorityPrefix?: string;
		stripPathStartingSeparator?: boolean;
	}

	export namespace workspace {
		export function registerRemoteAuthorityResolver(authorityPrefix: string, resolver: RemoteAuthorityResolver): Disposable;
		export function registerResourceLabelFormatter(formatter: ResourceLabelFormatter): Disposable;
		export function getRemoteExecServer(authority: string): Thenable<ExecServer | undefined>;
	}

	export namespace env {

		export const remoteAuthority: string | undefined;

	}
}
