/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { AllowedExtension } from '../common/authentication.js';

export const IAuthenticationAccessService = createDecorator<IAuthenticationAccessService>('IAuthenticationAccessService');
export interface IAuthenticationAccessService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeExtensionSessionAccess: Event<{ providerId: string; accountName: string }>;

	isAccessAllowed(providerId: string, accountName: string, extensionId: string): boolean | undefined;
	readAllowedExtensions(providerId: string, accountName: string): AllowedExtension[];
	updateAllowedExtensions(providerId: string, accountName: string, extensions: AllowedExtension[]): void;
	removeAllowedExtensions(providerId: string, accountName: string): void;
}

export class AuthenticationAccessService extends Disposable implements IAuthenticationAccessService {
	_serviceBrand: undefined;

	private _onDidChangeExtensionSessionAccess: Emitter<{ providerId: string; accountName: string }> = this._register(new Emitter<{ providerId: string; accountName: string }>());
	readonly onDidChangeExtensionSessionAccess: Event<{ providerId: string; accountName: string }> = this._onDidChangeExtensionSessionAccess.event;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IProductService private readonly _productService: IProductService
	) {
		super();
	}

	isAccessAllowed(providerId: string, accountName: string, extensionId: string): boolean | undefined {
		const trustedExtensionAuthAccess = this._productService.trustedExtensionAuthAccess;
		const extensionKey = ExtensionIdentifier.toKey(extensionId);
		if (Array.isArray(trustedExtensionAuthAccess)) {
			if (trustedExtensionAuthAccess.includes(extensionKey)) {
				return true;
			}
		} else if (trustedExtensionAuthAccess?.[providerId]?.includes(extensionKey)) {
			return true;
		}

		const allowList = this.readAllowedExtensions(providerId, accountName);
		const extensionData = allowList.find(extension => extension.id === extensionKey);
		if (!extensionData) {
			return undefined;
		}
		return extensionData.allowed !== undefined
			? extensionData.allowed
			: true;
	}

	readAllowedExtensions(providerId: string, accountName: string): AllowedExtension[] {
		let trustedExtensions: AllowedExtension[] = [];
		try {
			const trustedExtensionSrc = this._storageService.get(`${providerId}-${accountName}`, StorageScope.APPLICATION);
			if (trustedExtensionSrc) {
				trustedExtensions = JSON.parse(trustedExtensionSrc);
			}
		} catch (err) { }

		const trustedExtensionAuthAccess = this._productService.trustedExtensionAuthAccess;
		const trustedExtensionIds =
			Array.isArray(trustedExtensionAuthAccess)
				? trustedExtensionAuthAccess
				: typeof trustedExtensionAuthAccess === 'object'
					? trustedExtensionAuthAccess[providerId] ?? []
					: [];

		for (const extensionId of trustedExtensionIds) {
			const extensionKey = ExtensionIdentifier.toKey(extensionId);
			const existingExtension = trustedExtensions.find(extension => extension.id === extensionKey);
			if (!existingExtension) {
				trustedExtensions.push({
					id: extensionKey,
					name: extensionId,
					allowed: true,
					trusted: true
				});
			} else {
				existingExtension.allowed = true;
				existingExtension.trusted = true;
			}
		}

		return trustedExtensions;
	}

	updateAllowedExtensions(providerId: string, accountName: string, extensions: AllowedExtension[]): void {
		const allowList = this.readAllowedExtensions(providerId, accountName);
		for (const extension of extensions) {
			const extensionKey = ExtensionIdentifier.toKey(extension.id);
			const index = allowList.findIndex(e => e.id === extensionKey);
			if (index === -1) {
				allowList.push({
					...extension,
					id: extensionKey
				});
			} else {
				allowList[index].allowed = extension.allowed;
				if (extension.name && extension.name !== extensionKey && allowList[index].name !== extension.name) {
					allowList[index].name = extension.name;
				}
			}
		}

		const userManagedExtensions = allowList.filter(extension => !extension.trusted);
		this._storageService.store(`${providerId}-${accountName}`, JSON.stringify(userManagedExtensions), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeExtensionSessionAccess.fire({ providerId, accountName });
	}

	removeAllowedExtensions(providerId: string, accountName: string): void {
		this._storageService.remove(`${providerId}-${accountName}`, StorageScope.APPLICATION);
		this._onDidChangeExtensionSessionAccess.fire({ providerId, accountName });
	}
}

registerSingleton(IAuthenticationAccessService, AuthenticationAccessService, InstantiationType.Delayed);
