/**
 * Dardcor Code - Extension Gallery Service (Task 151)
 * Mirrors: vs/platform/extensionManagement/common/extensionGalleryService.ts
 */

import { CancellationToken } from '../../core/async/cancellation.js';
import { IRequestService } from '../request/request-service.js';

export interface IGalleryExtension {
	identifier: { id: string; uuid?: string };
	version: string;
	displayName: string;
	publisher: string;
	publisherDisplayName: string;
	description: string;
	installCount: number;
	rating: number;
	assets: {
		manifest: string;
		readme: string;
		icon: string;
		vsix: string;
	};
}

export const IExtensionGalleryService = Symbol('IExtensionGalleryService');

export interface IExtensionGalleryService {
	query(options: { text?: string; pageSize?: number }, token?: CancellationToken): Promise<IGalleryExtension[]>;
	getCompatibleExtension(id: string, version?: string): Promise<IGalleryExtension | null>;
}

export class ExtensionGalleryService implements IExtensionGalleryService {
	constructor(private readonly _requestService: IRequestService) {}

	async query(options: { text?: string; pageSize?: number }, _token?: CancellationToken): Promise<IGalleryExtension[]> {
		return [];
	}

	async getCompatibleExtension(_id: string, _version?: string): Promise<IGalleryExtension | null> {
		return null;
	}
}
