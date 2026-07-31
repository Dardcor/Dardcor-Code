/**
 * Dardcor Code - IFileSystemProvider Adapter For Remote Server Filesystem (Task 804)
 */

import { IFileSystemProvider, IFileStat, FileChangeEvent, FileChangeType } from '../../services/files/file-service.js';
import { URI } from '../../core/types/uri.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { IRemoteChannelClient } from '../transport/connection-multiplexer.js';

export interface IRemoteFileChangeEvent {
	readonly path: string;
	readonly type: FileChangeType;
}

export function toBase64(data: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < data.length; i += chunkSize) {
		binary += String.fromCharCode(...data.subarray(i, Math.min(i + chunkSize, data.length)));
	}
	return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export class RemoteFileProvider extends Disposable implements IFileSystemProvider {
	private readonly _onDidChangeFile = this._register(new Emitter<FileChangeEvent[]>());
	readonly onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

	constructor(private readonly _channel: IRemoteChannelClient, private readonly _scheme = 'remote') {
		super();
		this._register(this._channel.onEvent(payload => {
			if (!payload || payload.type !== 'change' || !Array.isArray(payload.events)) {
				return;
			}
			const events: FileChangeEvent[] = payload.events
				.filter((e: IRemoteFileChangeEvent) => e && typeof e.path === 'string')
				.map((e: IRemoteFileChangeEvent) => ({
					resource: URI.from({ scheme: this._scheme, path: e.path }),
					type: e.type as FileChangeType
				}));
			if (events.length > 0) {
				this._onDidChangeFile.fire(events);
			}
		}));
	}

	get scheme(): string {
		return this._scheme;
	}

	async stat(resource: URI): Promise<IFileStat> {
		const result = await this._channel.call({ op: 'stat', resource: resource.path });
		return normalizeStat(result, resource, this._scheme);
	}

	async readdir(resource: URI): Promise<[string, IFileStat][]> {
		const result = await this._channel.call({ op: 'readdir', resource: resource.path });
		if (!Array.isArray(result)) {
			throw new Error('Invalid readdir response from remote server');
		}
		return result.map((entry: { name: string; stat: IFileStat }) => [
			entry.name,
			normalizeStat(entry.stat, URI.from({ scheme: this._scheme, path: joinPaths(resource.path, entry.name) }), this._scheme)
		]);
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const result = await this._channel.call({ op: 'readFile', resource: resource.path });
		if (!result || typeof result.content !== 'string') {
			throw new Error('Invalid readFile response from remote server');
		}
		return fromBase64(result.content);
	}

	async writeFile(resource: URI, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
		await this._channel.call({
			op: 'writeFile',
			resource: resource.path,
			content: toBase64(content),
			options
		});
	}

	async delete(resource: URI, options: { recursive: boolean }): Promise<void> {
		await this._channel.call({ op: 'delete', resource: resource.path, options });
	}

	async mkdir(resource: URI): Promise<void> {
		await this._channel.call({ op: 'mkdir', resource: resource.path });
	}

	rename(source: URI, target: URI): Promise<void> {
		return this._channel.call({ op: 'rename', source: source.path, target: target.path });
	}
}

function normalizeStat(raw: any, resource: URI, scheme: string): IFileStat {
	if (!raw) {
		throw new Error('Remote stat returned no data');
	}
	return {
		resource,
		name: raw.name ?? resource.path.split('/').pop() ?? '',
		isDirectory: !!raw.isDirectory,
		isFile: !!raw.isFile,
		size: raw.size ?? 0,
		mtime: raw.mtime ?? 0
	};
}

function joinPaths(base: string, name: string): string {
	return `${base.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`;
}
