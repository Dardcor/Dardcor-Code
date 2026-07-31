/**
 * Dardcor Code - Update Checker (Task 176)
 * Mirrors: vs/platform/update/common/update.ts manifest poll engine
 */

import { IRequestService } from '../request/request-service.js';

export interface IUpdateManifest {
	version: string;
	url: string;
	sha256hash: string;
	releaseNotesUrl?: string;
}

export class UpdateChecker {
	constructor(
		private readonly _updateServerUrl: string,
		private readonly _requestService: IRequestService
	) {}

	async check(currentVersion: string): Promise<IUpdateManifest | null> {
		try {
			const res = await this._requestService.request({
				url: `${this._updateServerUrl}/api/update?version=${encodeURIComponent(currentVersion)}`
			});
			if (res.status === 200) {
				const text = await res.text();
				const manifest: IUpdateManifest = JSON.parse(text);
				if (manifest.version !== currentVersion) {
					return manifest;
				}
			}
		} catch {
			return null;
		}
		return null;
	}
}
