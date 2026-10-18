/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, VSBuffer } from '../../../base/common/buffer.js';
import { disposableTimeout } from '../../../base/common/async.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createFileSystemProviderError, FileChangeType, FilePermission, FileSystemProviderCapabilities, FileSystemProviderErrorCode, FileType, IFileChange, IFileDeleteOptions, IFileOverwriteOptions, IFileSystemProvider, IFileSystemProviderWithFileRealpathCapability, IFileWriteOptions, IStat, IWatchOptions } from '../../files/common/files.js';
import { fromAgentHostUri, isAgentHostContentRefUri, toAgentHostUri } from './agentHostUri.js';
import { ContentEncoding, type CreateResourceWatchParams, type DirectoryEntry, type ResourceCopyParams, type ResourceCopyResult, type ResourceDeleteParams, type ResourceDeleteResult, type ResourceListResult, type ResourceMkdirParams, type ResourceMkdirResult, type ResourceMoveParams, type ResourceMoveResult, type ResourceReadResult, type ResourceRequestParams, type ResourceRequestResult, type ResourceResolveParams, type ResourceResolveResult, type ResourceWriteParams, type ResourceWriteResult } from './state/protocol/commands.js';
import { AhpErrorCodes } from './state/protocol/errors.js';
import { ProtocolError } from './state/sessionProtocol.js';
import { ActionType, type ActionEnvelope } from './state/sessionActions.js';
import { ROOT_STATE_URI } from './state/sessionState.js';

export interface IRemoteFilesystemConnection {
	resourceList(uri: URI): Promise<ResourceListResult>;
	resourceRead(uri: URI, encoding?: ContentEncoding): Promise<ResourceReadResult>;
	resourceWrite(params: ResourceWriteParams): Promise<ResourceWriteResult>;
	resourceDelete(params: ResourceDeleteParams): Promise<ResourceDeleteResult>;
	resourceMove(params: ResourceMoveParams): Promise<ResourceMoveResult>;
	resourceCopy(params: ResourceCopyParams): Promise<ResourceCopyResult>;
	resourceRequest?(params: ResourceRequestParams): Promise<ResourceRequestResult>;
	resourceResolve(params: ResourceResolveParams): Promise<ResourceResolveResult>;
	resourceMkdir(params: ResourceMkdirParams): Promise<ResourceMkdirResult>;
	watchResource?(params: CreateResourceWatchParams): Promise<IRemoteWatchHandle>;
}

export interface IRemoteWatchHandle extends IDisposable {
	readonly onDidChange: Event<readonly IFileChange[]>;
}

export async function createRemoteWatchHandle(
	primitives: {
		createResourceWatch(params: CreateResourceWatchParams): Promise<{ channel: string }>;
		subscribe(channel: URI): Promise<unknown>;
		unsubscribe(channel: URI): void;
		onDidAction: Event<ActionEnvelope>;
	},
	params: CreateResourceWatchParams,
): Promise<IRemoteWatchHandle> {
	const { channel } = await primitives.createResourceWatch(params);
	const channelUri = URI.parse(channel);
	await primitives.subscribe(channelUri);
	const onDidChangeEmitter = new Emitter<readonly IFileChange[]>();
	const listener = primitives.onDidAction(envelope => {
		if (envelope.channel !== channel || envelope.action.type !== ActionType.ResourceWatchChanged) {
			return;
		}
		const items = envelope.action.changes?.items ?? [];
		if (items.length === 0) {
			return;
		}
		onDidChangeEmitter.fire(items.map(item => ({
			resource: URI.parse(item.uri),
			type: item.type === 'added' ? FileChangeType.ADDED
				: item.type === 'deleted' ? FileChangeType.DELETED
					: FileChangeType.UPDATED,
		})));
	});
	let disposed = false;
	return {
		onDidChange: onDidChangeEmitter.event,
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			listener.dispose();
			onDidChangeEmitter.dispose();
			try {
				primitives.unsubscribe(channelUri);
			} catch {
			}
		},
	};
}

export function agentHostUri(authority: string, path: string): URI {
	return toAgentHostUri(URI.file(path), authority);
}

export function agentHostRemotePath(uri: URI): string {
	return fromAgentHostUri(uri).path;
}


interface IAuthorityEntry {
	connections: IRemoteFilesystemConnection[];
	readonly expiry: MutableDisposable<IDisposable>;
}

export abstract class AHPFileSystemProvider extends Disposable implements IFileSystemProvider, IFileSystemProviderWithFileRealpathCapability {

	readonly capabilities =
		FileSystemProviderCapabilities.PathCaseSensitive |
		FileSystemProviderCapabilities.FileReadWrite |
		FileSystemProviderCapabilities.FileFolderCopy |
		FileSystemProviderCapabilities.FileRealpath;

	private readonly _onDidChangeCapabilities = this._register(new Emitter<void>());
	readonly onDidChangeCapabilities = this._onDidChangeCapabilities.event;

	private readonly _onDidChangeFile = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile = this._onDidChangeFile.event;
	private readonly _onDidWatchError = this._register(new Emitter<string>());
	readonly onDidWatchError = this._onDidWatchError.event;

	private readonly _authorities = new Map<string, IAuthorityEntry>();

	private readonly _onDidChangeConnection = this._register(new Emitter<string>());

	private static readonly _DEFAULT_CONNECTION_GRACE_MS = 5000;

	constructor(
		private readonly _connectionGraceMs: number = AHPFileSystemProvider._DEFAULT_CONNECTION_GRACE_MS,
	) {
		super();
	}

	registerAuthority(authority: string, connection: IRemoteFilesystemConnection): IDisposable {
		let entry = this._authorities.get(authority);
		if (!entry) {
			entry = {
				connections: [connection],
				expiry: new MutableDisposable<IDisposable>(),
			};
			this._authorities.set(authority, entry);
		} else {
			entry.expiry.clear();
			entry.connections.push(connection);
		}
		const adopted = entry;
		this._onDidChangeConnection.fire(authority);

		return toDisposable(() => {
			const idx = adopted.connections.indexOf(connection);
			if (idx === -1) {
				return;
			}
			const wasActive = idx === adopted.connections.length - 1;
			adopted.connections.splice(idx, 1);
			if (adopted.connections.length === 0) {
				adopted.expiry.value = disposableTimeout(
					() => this._expireAuthority(authority, adopted),
					this._connectionGraceMs,
					this._store,
				);
			}

			if (wasActive) {
				this._onDidChangeConnection.fire(authority);
			}
		});
	}

	private _expireAuthority(authority: string, entry: IAuthorityEntry): void {
		if (this._authorities.get(authority) !== entry || entry.connections.length > 0) {
			return;
		}
		this._authorities.delete(authority);
		entry.expiry.dispose();
		this._onDidChangeConnection.fire(authority);
	}

	override dispose(): void {
		for (const entry of this._authorities.values()) {
			entry.expiry.dispose();
			entry.connections.length = 0;
		}
		this._authorities.clear();
		super.dispose();
	}

	protected abstract _decodeUri(resource: URI): URI;

	protected abstract _encodeUri(resource: URI, authority: string): URI;

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		const store = new DisposableStore();
		const handleHolder = store.add(new MutableDisposable<IDisposable>());
		const authority = resource.authority;
		const params: CreateResourceWatchParams = {
			channel: ROOT_STATE_URI,
			uri: this._decodeUri(resource).toString(),
			recursive: opts.recursive,
			...(opts.excludes.length > 0 ? { excludes: { items: [...opts.excludes] } } : {}),
			...(opts.includes && opts.includes.length > 0
				? { includes: { items: opts.includes.map(p => typeof p === 'string' ? p : p.pattern) } }
				: {}),
		};

		let attached: IRemoteFilesystemConnection | undefined;
		let attaching = false;
		let pendingReattach = false;

		const reattach = async (): Promise<void> => {
			if (store.isDisposed) {
				return;
			}
			if (attaching) {
				pendingReattach = true;
				return;
			}
			const entry = this._authorities.get(authority);
			const next = entry?.connections.at(-1);
			if (next === attached) {
				return;
			}
			handleHolder.clear();
			attached = undefined;
			const watchResource = next?.watchResource;
			if (!next || !watchResource) {
				return;
			}
			attaching = true;
			const target = next;
			try {
				const handle = await watchResource.call(target, params);
				if (store.isDisposed) {
					handle.dispose();
					return;
				}
				const current = this._authorities.get(authority);
				if (!current || current.connections.at(-1) !== target) {
					handle.dispose();
					return;
				}
				const sub = handle.onDidChange(changes => this._onDidChangeFile.fire(changes.map(c => ({
					resource: this._encodeUri(c.resource, resource.authority),
					type: c.type,
				}))));
				handleHolder.value = toDisposable(() => {
					sub.dispose();
					handle.dispose();
				});
				attached = target;
			} catch (err) {
				this._onDidWatchError.fire(err instanceof Error ? err.message : String(err));
			} finally {
				attaching = false;
				if (pendingReattach) {
					pendingReattach = false;
					void reattach();
				}
			}
		};

		store.add(this._onDidChangeConnection.event(a => {
			if (a === authority) {
				void reattach();
			}
		}));
		void reattach();

		return store;
	}

	private _isContentRef(resource: URI, decoded: URI): boolean {
		return isAgentHostContentRefUri(resource)
			|| decoded.scheme === 'session-db'
			|| decoded.scheme === 'git-blob';
	}

	async stat(resource: URI): Promise<IStat> {
		const path = resource.path;

		const decoded = this._decodeUri(resource);
		if (this._isContentRef(resource, decoded)) {
			return { type: FileType.File, mtime: 0, ctime: 0, size: 0, permissions: FilePermission.Readonly };
		}

		if (path === '/' || path === '') {
			return { type: FileType.Directory, mtime: 0, ctime: 0, size: 0, permissions: FilePermission.Readonly };
		}

		if (decoded.path === '/' || decoded.path === '') {
			return { type: FileType.Directory, mtime: 0, ctime: 0, size: 0, permissions: FilePermission.Readonly };
		}

		const connection = await this._getConnection(resource.authority);
		try {
			const resolved = await this._resolve(connection, decoded);

			return {
				type: resolved.type === 'directory' ? FileType.Directory
					: resolved.type === 'symlink' ? FileType.SymbolicLink
						: FileType.File,
				mtime: resolved.mtime ? Date.parse(resolved.mtime) : 0,
				ctime: resolved.ctime ? Date.parse(resolved.ctime) : 0,
				size: resolved.size ?? 0,
			};
		} catch (err) {
			throw this._mapError(err, FileSystemProviderErrorCode.FileNotFound);
		}
	}

	async realpath(resource: URI): Promise<string> {
		const path = resource.path;
		if (path === '/' || path === '') {
			return path;
		}
		const decoded = this._decodeUri(resource);
		if (this._isContentRef(resource, decoded) || decoded.path === '/' || decoded.path === '') {
			return path;
		}
		const connection = await this._getConnection(resource.authority);
		try {
			const resolved = await this._resolve(connection, decoded);
			return this._encodeUri(URI.parse(resolved.uri), resource.authority).path;
		} catch (err) {
			throw this._mapError(err, FileSystemProviderErrorCode.FileNotFound);
		}
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		const entries = await this._listDirectory(resource.authority, resource);
		return entries.map(e => [e.name, e.type === 'directory' ? FileType.Directory : FileType.File]);
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const connection = await this._getConnection(resource.authority);
		try {
			const originalUri = this._decodeUri(resource);
			const result = await connection.resourceRead(originalUri, ContentEncoding.Base64);
			if (result.encoding === ContentEncoding.Base64) {
				return decodeBase64(result.data).buffer;
			}
			return VSBuffer.fromString(result.data).buffer;
		} catch (err) {
			throw this._mapError(err, FileSystemProviderErrorCode.FileNotFound);
		}
	}

	async writeFile(resource: URI, content: Uint8Array, _opts: IFileWriteOptions): Promise<void> {
		const connection = await this._getConnection(resource.authority);
		try {
			const originalUri = this._decodeUri(resource);
			await connection.resourceWrite({
				channel: ROOT_STATE_URI,
				uri: originalUri.toString(),
				data: VSBuffer.wrap(content).toString(),
				encoding: ContentEncoding.Utf8,
			});
		} catch (err) {
			throw this._mapError(err, FileSystemProviderErrorCode.NoPermissions);
		}
	}

	async mkdir(resource: URI): Promise<void> {
		const connection = await this._getConnection(resource.authority);
		try {
			const originalUri = this._decodeUri(resource);
			await connection.resourceMkdir({ channel: ROOT_STATE_URI, uri: originalUri.toString() });
		} catch (err) {
			throw this._mapError(err, FileSystemProviderErrorCode.NoPermissions);
		}
	}

	async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		const connection = await this._getConnection(resource.authority);
		try {
			const originalUri = this._decodeUri(resource);
			await connection.resourceDelete({ channel: ROOT_STATE_URI, uri: originalUri.toString(), recursive: opts.recursive });
		} catch (err) {
			throw this._mapError(err, FileSystemProviderErrorCode.NoPermissions);
		}
	}

	async rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
		const connection = await this._getConnection(from.authority);
		try {
			const originalFrom = this._decodeUri(from);
			const originalTo = this._decodeUri(to);
			await connection.resourceMove({ channel: ROOT_STATE_URI, source: originalFrom.toString(), destination: originalTo.toString(), failIfExists: !opts.overwrite });
		} catch (err) {
			throw this._mapError(err, FileSystemProviderErrorCode.NoPermissions);
		}
	}

	async copy(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
		const connection = await this._getConnection(from.authority);
		try {
			const originalFrom = this._decodeUri(from);
			const originalTo = this._decodeUri(to);
			await connection.resourceCopy({ channel: ROOT_STATE_URI, source: originalFrom.toString(), destination: originalTo.toString(), failIfExists: !opts.overwrite });
		} catch (err) {
			throw this._mapError(err, FileSystemProviderErrorCode.NoPermissions);
		}
	}

	async requestResourceAccess(resource: URI, opts: { readonly read?: boolean; readonly write?: boolean }): Promise<void> {
		const connection = await this._getConnection(resource.authority);
		if (!connection.resourceRequest) {
			throw createFileSystemProviderError(
				`Connection for ${resource.authority} does not support resourceRequest`,
				FileSystemProviderErrorCode.Unavailable,
			);
		}
		const originalUri = this._decodeUri(resource);
		try {
			await connection.resourceRequest({
				channel: ROOT_STATE_URI,
				uri: originalUri.toString(),
				read: opts.read,
				write: opts.write,
			});
		} catch (err) {
			throw this._mapError(err, FileSystemProviderErrorCode.NoPermissions);
		}
	}


	private _getConnection(authority: string): Promise<IRemoteFilesystemConnection> {
		const entry = this._authorities.get(authority);
		if (!entry) {
			return Promise.reject(createFileSystemProviderError(
				`No connection for authority: ${authority}`,
				FileSystemProviderErrorCode.Unavailable,
			));
		}

		const active = entry.connections.at(-1);
		if (active) {
			return Promise.resolve(active);
		}
		return new Promise((resolve, reject) => {
			const settle = (): void => {
				const current = this._authorities.get(authority);
				if (!current) {
					sub.dispose();
					reject(createFileSystemProviderError(
						`No connection for authority: ${authority}`,
						FileSystemProviderErrorCode.Unavailable,
					));
					return;
				}
				const c = current.connections.at(-1);
				if (c) {
					sub.dispose();
					resolve(c);
				}
			};
			const sub = this._onDidChangeConnection.event(a => {
				if (a === authority) {
					settle();
				}
			});
			settle();
		});
	}

	private _mapError(err: unknown, defaultCode: FileSystemProviderErrorCode): Error {
		if (err instanceof ProtocolError && err.code === AhpErrorCodes.PermissionDenied) {
			return createFileSystemProviderError(err.message, FileSystemProviderErrorCode.NoPermissions);
		}
		return createFileSystemProviderError(
			err instanceof Error ? err.message : String(err),
			defaultCode,
		);
	}

	private _resolve(connection: IRemoteFilesystemConnection, decoded: URI): Promise<ResourceResolveResult> {
		return connection.resourceResolve({ channel: ROOT_STATE_URI, uri: decoded.toString() });
	}

	private async _listDirectory(authority: string, resource: URI): Promise<readonly DirectoryEntry[]> {
		const connection = await this._getConnection(authority);
		try {
			const originalUri = this._decodeUri(resource);
			const result = await connection.resourceList(originalUri);
			return result.entries;
		} catch (err) {
			throw this._mapError(err, FileSystemProviderErrorCode.Unavailable);
		}
	}
}


export class AgentHostFileSystemProvider extends AHPFileSystemProvider {
	protected _decodeUri(resource: URI): URI {
		return fromAgentHostUri(resource);
	}

	protected _encodeUri(resource: URI, authority: string): URI {
		return toAgentHostUri(resource, authority);
	}
}
