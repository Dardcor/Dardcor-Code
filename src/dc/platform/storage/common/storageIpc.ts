/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { UriDto } from '../../../base/common/uri.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IStorageDatabase, IStorageItemsChangeEvent, IUpdateRequest } from '../../../base/parts/storage/common/storage.js';
import { IUserDataProfile } from '../../userDataProfile/common/userDataProfile.js';
import { ISerializedSingleFolderWorkspaceIdentifier, ISerializedWorkspaceIdentifier, IEmptyWorkspaceIdentifier, IAnyWorkspaceIdentifier } from '../../workspace/common/workspace.js';

export type Key = string;
export type Value = string;
export type Item = [Key, Value];

export interface IBaseSerializableStorageRequest {

	readonly profile: UriDto<IUserDataProfile> | undefined;

	readonly workspace: ISerializedWorkspaceIdentifier | ISerializedSingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier | undefined;

	readonly applicationShared?: boolean;

	readonly payload?: unknown;
}

export interface ISerializableUpdateRequest extends IBaseSerializableStorageRequest {
	insert?: Item[];
	delete?: Key[];
}

export interface ISerializableGetValueRequest extends IBaseSerializableStorageRequest {
	readonly key: Key;
}

export interface ISerializableCompareAndSwapRequest extends ISerializableGetValueRequest {
	readonly expectedValue: Value | undefined;
	readonly newValue: Value;
}

export interface ISerializableCompareAndSwapResult {
	readonly swapped: boolean;
	readonly currentValue: Value | undefined;
}

export interface ISerializableItemsChangeEvent {
	readonly changed?: Item[];
	readonly deleted?: Key[];
}

abstract class BaseStorageDatabaseClient extends Disposable implements IStorageDatabase {

	abstract readonly onDidChangeItemsExternal: Event<IStorageItemsChangeEvent>;

	protected get applicationShared(): boolean {
		return false;
	}

	constructor(
		protected channel: IChannel,
		protected profile: UriDto<IUserDataProfile> | undefined,
		protected workspace: IAnyWorkspaceIdentifier | undefined
	) {
		super();
	}

	async getItems(): Promise<Map<string, string>> {
		const serializableRequest: IBaseSerializableStorageRequest = { profile: this.profile, workspace: this.workspace, applicationShared: this.applicationShared };
		const items: Item[] = await this.channel.call('getItems', serializableRequest);

		return new Map(items);
	}

	updateItems(request: IUpdateRequest): Promise<void> {
		const serializableRequest: ISerializableUpdateRequest = { profile: this.profile, workspace: this.workspace, applicationShared: this.applicationShared };

		if (request.insert) {
			serializableRequest.insert = Array.from(request.insert.entries());
		}

		if (request.delete) {
			serializableRequest.delete = Array.from(request.delete.values());
		}

		return this.channel.call('updateItems', serializableRequest);
	}

	optimize(): Promise<void> {
		const serializableRequest: IBaseSerializableStorageRequest = { profile: this.profile, workspace: this.workspace, applicationShared: this.applicationShared };

		return this.channel.call('optimize', serializableRequest);
	}

	abstract close(): Promise<void>;
}

abstract class BaseProfileAwareStorageDatabaseClient extends BaseStorageDatabaseClient {

	private readonly _onDidChangeItemsExternal = this._register(new Emitter<IStorageItemsChangeEvent>());
	readonly onDidChangeItemsExternal = this._onDidChangeItemsExternal.event;

	constructor(channel: IChannel, profile: UriDto<IUserDataProfile> | undefined) {
		super(channel, profile, undefined);

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.channel.listen<ISerializableItemsChangeEvent>('onDidChangeStorage', { profile: this.profile, applicationShared: this.applicationShared })((e: ISerializableItemsChangeEvent) => this.onDidChangeStorage(e)));
	}

	private onDidChangeStorage(e: ISerializableItemsChangeEvent): void {
		if (Array.isArray(e.changed) || Array.isArray(e.deleted)) {
			this._onDidChangeItemsExternal.fire({
				changed: e.changed ? new Map(e.changed) : undefined,
				deleted: e.deleted ? new Set<string>(e.deleted) : undefined
			});
		}
	}
}

export class ApplicationStorageDatabaseClient extends BaseProfileAwareStorageDatabaseClient {

	constructor(channel: IChannel) {
		super(channel, undefined);
	}

	async close(): Promise<void> {


		this.dispose();
	}
}

export class ApplicationSharedStorageDatabaseClient extends BaseProfileAwareStorageDatabaseClient {

	constructor(channel: IChannel) {
		super(channel, undefined);
	}

	protected override get applicationShared(): boolean {
		return true;
	}

	async close(): Promise<void> {


		this.dispose();
	}
}

export class ProfileStorageDatabaseClient extends BaseProfileAwareStorageDatabaseClient {

	async close(): Promise<void> {


		this.dispose();
	}
}

export class WorkspaceStorageDatabaseClient extends BaseStorageDatabaseClient implements IStorageDatabase {

	readonly onDidChangeItemsExternal = Event.None;

	constructor(channel: IChannel, workspace: IAnyWorkspaceIdentifier) {
		super(channel, undefined, workspace);
	}

	async close(): Promise<void> {


		this.dispose();
	}
}

export class StorageClient {

	constructor(private readonly channel: IChannel) { }

	isUsed(path: string): Promise<boolean> {
		const serializableRequest: ISerializableUpdateRequest = { payload: path, profile: undefined, workspace: undefined };

		return this.channel.call('isUsed', serializableRequest);
	}
}

export class FallbackApplicationStorageDatabaseClient extends Disposable implements IStorageDatabase {

	onDidChangeItemsExternal = Event.None;

	constructor(private readonly channel: IChannel) {
		super();
	}

	async getItems(): Promise<Map<string, string>> {
		const serializableRequest: IBaseSerializableStorageRequest = { profile: undefined, workspace: undefined, applicationShared: true };
		const items: Item[] = await this.channel.call('getFallbackApplicationStorageItems', serializableRequest);
		return new Map(items);
	}

	updateItems(): Promise<void> {
		throw new Error('Not supported');
	}

	optimize(): Promise<void> {
		throw new Error('Not supported');
	}

	close(): Promise<void> {
		throw new Error('Not supported');
	}
}
