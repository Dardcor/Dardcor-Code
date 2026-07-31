/**
 * Dardcor Code - IFileService & FileSystem Gateway
 */

import { createDecorator } from '../instantiation/annotations';
import { URI } from '../../core/types/uri';
import { DataBuffer } from '../../core/binary/buffer';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

export interface IFileStat {
	readonly resource: URI;
	readonly name: string;
	readonly isDirectory: boolean;
	readonly isFile: boolean;
	readonly size: number;
	readonly mtime: number;
	readonly children?: IFileStat[];
}

export interface IFileSystemProvider {
	readonly onDidChangeFile: Event<FileChangeEvent[]>;
	stat(resource: URI): Promise<IFileStat>;
	readdir(resource: URI): Promise<[string, IFileStat][]>;
	readFile(resource: URI): Promise<Uint8Array>;
	writeFile(resource: URI, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void>;
	delete(resource: URI, options: { recursive: boolean }): Promise<void>;
	mkdir(resource: URI): Promise<void>;
}

export interface FileChangeEvent {
	readonly resource: URI;
	readonly type: FileChangeType;
}

export enum FileChangeType {
	Updated = 0,
	Added = 1,
	Deleted = 2
}

export const IFileService = createDecorator<IFileService>('fileService');

export interface IFileService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeFileSystemProviderRegistrations: Event<void>;
	registerProvider(scheme: string, provider: IFileSystemProvider): void;
	getProvider(scheme: string): IFileSystemProvider | undefined;
	readFile(resource: URI): Promise<{ content: DataBuffer }>;
	writeFile(resource: URI, buffer: DataBuffer): Promise<void>;
	stat(resource: URI): Promise<IFileStat>;
}

export class FileService extends Disposable implements IFileService {
	declare readonly _serviceBrand: undefined;

	private readonly _providers = new Map<string, IFileSystemProvider>();
	private readonly _onDidChangeFileSystemProviderRegistrations = this._register(new Emitter<void>());

	readonly onDidChangeFileSystemProviderRegistrations = this._onDidChangeFileSystemProviderRegistrations.event;

	public registerProvider(scheme: string, provider: IFileSystemProvider): void {
		this._providers.set(scheme, provider);
		this._onDidChangeFileSystemProviderRegistrations.fire();
	}

	public getProvider(scheme: string): IFileSystemProvider | undefined {
		return this._providers.get(scheme);
	}

	public async readFile(resource: URI): Promise<{ content: DataBuffer }> {
		const provider = this._getProviderOrThrow(resource.scheme);
		const bytes = await provider.readFile(resource);
		return { content: DataBuffer.wrap(bytes) };
	}

	public async writeFile(resource: URI, buffer: DataBuffer): Promise<void> {
		const provider = this._getProviderOrThrow(resource.scheme);
		await provider.writeFile(resource, buffer.buffer, { create: true, overwrite: true });
	}

	public async stat(resource: URI): Promise<IFileStat> {
		const provider = this._getProviderOrThrow(resource.scheme);
		return provider.stat(resource);
	}

	private _getProviderOrThrow(scheme: string): IFileSystemProvider {
		const p = this._providers.get(scheme);
		if (!p) {
			throw new Error(`No file provider registered for scheme '${scheme}'`);
		}
		return p;
	}
}
