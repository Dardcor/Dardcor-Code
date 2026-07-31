/**
 * Dardcor Code - Update Server Manifest Poll Engine (Task 176)
 * Mirrors: vs/platform/update/common/update.ts manifest poll engine
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { IRequestService } from '../request/request-service.js';

export interface IUpdateManifest {
	version: string;
	url: string;
	sha256hash: string;
	releaseNotesUrl?: string;
}

export interface IUpdateCheckerOptions {
	readonly pollIntervalMs?: number;
	readonly onUpdate?: (manifest: IUpdateManifest) => void;
	readonly onError?: (error: Error) => void;
}

export class UpdateChecker extends Disposable {
	private _timer: ReturnType<typeof setTimeout> | null = null;
	private _polling = false;
	private _lastCheckedVersion: string | null = null;

	constructor(
		private readonly _updateServerUrl: string,
		private readonly _requestService: IRequestService,
		private readonly _options: IUpdateCheckerOptions = {}
	) {
		super();
	}

	async check(currentVersion: string): Promise<IUpdateManifest | null> {
		try {
			const res = await this._requestService.request({
				url: `${this._updateServerUrl}/api/update?version=${encodeURIComponent(currentVersion)}`
			});
			if (res.status === 200) {
				const text = await res.text();
				const manifest: IUpdateManifest = JSON.parse(text);
				if (manifest.version && manifest.version !== currentVersion) {
					this._lastCheckedVersion = manifest.version;
					return manifest;
				}
			}
		} catch (err) {
			this._options.onError?.(err instanceof Error ? err : new Error(String(err)));
			return null;
		}
		return null;
	}

	async poll(currentVersion: string): Promise<void> {
		const manifest = await this.check(currentVersion);
		if (manifest) {
			this._options.onUpdate?.(manifest);
		}
	}

	start(currentVersion: string): void {
		if (this._polling) {
			return;
		}
		this._polling = true;
		const interval = this._options.pollIntervalMs ?? 3600_000;
		this._timer = setInterval(() => {
			this.poll(currentVersion).catch((err) => this._options.onError?.(err));
		}, interval);
	}

	stop(): void {
		this._polling = false;
		if (this._timer !== null) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}

	get lastCheckedVersion(): string | null {
		return this._lastCheckedVersion;
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}
}
