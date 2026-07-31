/**
 * Dardcor Code - Extension Gallery Service (Task 151)
 * Mirrors: vs/platform/extensionManagement/common/extensionGalleryService.ts (marketplace API client)
 */

import { createDecorator } from '../instantiation/annotations.js';
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

export const IExtensionGalleryService = createDecorator<IExtensionGalleryService>('extensionGalleryService');

export interface IExtensionGalleryService {
	readonly _serviceBrand: undefined;
	query(options: { text?: string; pageSize?: number }, token?: CancellationToken): Promise<IGalleryExtension[]>;
	getCompatibleExtension(id: string, version?: string): Promise<IGalleryExtension | null>;
}

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
const MARKETPLACE_HEADERS = {
	'Content-Type': 'application/json',
	Accept: 'application/json;api-version=3.0-preview.1',
};

export class ExtensionGalleryService implements IExtensionGalleryService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly _requestService: IRequestService,
		private readonly _marketplaceUrl: string = MARKETPLACE_URL
	) {}

	async query(options: { text?: string; pageSize?: number }, token?: CancellationToken): Promise<IGalleryExtension[]> {
		try {
			const payload = await this._postQuery(
				[{ filterType: 10, value: options.text ?? '' }],
				options.pageSize ?? 50,
				token
			);
			const rawExtensions = payload?.results?.[0]?.extensions ?? [];
			return rawExtensions
				.map((raw: any) => this._toGalleryExtension(raw))
				.filter((e: IGalleryExtension | null): e is IGalleryExtension => e !== null);
		} catch {
			return [];
		}
	}

	async getCompatibleExtension(id: string, version?: string): Promise<IGalleryExtension | null> {
		try {
			const criteria = [{ filterType: 7, value: id }];
			if (version) {
				criteria.push({ filterType: 8, value: version });
			}
			const payload = await this._postQuery(criteria, 1);
			const raw = payload?.results?.[0]?.extensions?.[0];
			return raw ? this._toGalleryExtension(raw) : null;
		} catch {
			return null;
		}
	}

	private async _postQuery(criteria: Array<{ filterType: number; value: string }>, pageSize: number, token?: CancellationToken): Promise<any> {
		const res = await this._requestService.request({
			url: this._marketplaceUrl,
			method: 'POST',
			headers: MARKETPLACE_HEADERS,
			body: JSON.stringify({
				filters: [{ criteria, pageNumber: 1, pageSize, sortBy: 0, sortOrder: 0 }],
				flags: 914,
			}),
			timeout: 15000,
		}, token);
		if (res.status !== 200) {
			return null;
		}
		return JSON.parse(await res.text());
	}

	private _toGalleryExtension(raw: any): IGalleryExtension | null {
		try {
			const latest = raw.versions?.[0];
			if (!latest) {
				return null;
			}
			const stats: Record<string, number> = {};
			for (const s of raw.statistics ?? []) {
				stats[s.statisticName] = s.value;
			}
			const assets: Record<string, string> = {};
			for (const file of latest.files ?? []) {
				assets[file.assetType] = file.source;
			}
			return {
				identifier: {
					id: `${raw.publisher.publisherName}.${raw.extensionName}`,
					uuid: raw.extensionId,
				},
				version: latest.version,
				displayName: raw.displayName ?? raw.extensionName,
				publisher: raw.publisher.publisherName,
				publisherDisplayName: raw.publisher.displayName ?? raw.publisher.publisherName,
				description: raw.shortDescription ?? '',
				installCount: stats['install'] ?? 0,
				rating: stats['averagerating'] ?? stats['rating'] ?? 0,
				assets: {
					manifest: assets['Microsoft.VisualStudio.Services.Manifest'] ?? '',
					readme: assets['Microsoft.VisualStudio.Services.Content.Details'] ?? '',
					icon: assets['Microsoft.VisualStudio.Services.Icons.Default'] ?? '',
					vsix: assets['Microsoft.VisualStudio.Services.VSIXPackage'] ?? '',
				},
			};
		} catch {
			return null;
		}
	}
}
