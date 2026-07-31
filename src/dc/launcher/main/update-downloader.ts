import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter } from '../../core/events/emitter.js';
import { verifySignature } from './update-signature.js';

export interface DownloadProgress {
	received: number;
	total: number;
	percent: number;
	speed: number;
	startedAt: number;
}

export interface UpdateDownloaderOptions {
	timeoutMs?: number;
	onProgress?: (progress: DownloadProgress) => void;
	signatureHex?: string;
	publicKeyPem?: string;
}

export class UpdateDownloader extends Disposable {
	private _abort = false;
	private _active: { destroy: () => void } | null = null;
	private _downloaded = 0;
	private _total = 0;
	private _startedAt = 0;
	private readonly _options: UpdateDownloaderOptions;
	private readonly _onProgress = new Emitter<DownloadProgress>();
	public readonly onProgress = this._onProgress.event;

	constructor(options: UpdateDownloaderOptions = {}) {
		super();
		this._options = options;
		this._register(this._onDidProgressHandler());
	}

	public download(url: string, destination: string, onProgress?: (progress: DownloadProgress) => void): Promise<boolean> {
		this._abort = false;
		this._downloaded = 0;
		this._total = 0;
		this._startedAt = Date.now();
		if (onProgress) {
			this._progressSubscriptions.add(onProgress);
		}
		const timeoutMs = this._options.timeoutMs ?? 300000;

		return new Promise((resolve, reject) => {
			const protocol = url.startsWith('https:') ? https : url.startsWith('http:') ? http : null;
			if (!protocol) {
				reject(new Error(`Unsupported protocol for download URL: ${url}`));
				return;
			}
			fs.mkdirSync(path.dirname(destination), { recursive: true });

			const request = protocol.get(url, (response) => {
				const statusCode = response.statusCode ?? 0;
				if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
					request.destroy();
					this.download(response.headers.location, destination, onProgress).then(resolve, reject);
					return;
				}
				if (statusCode !== 200) {
					response.resume();
					reject(new Error(`Download failed with status ${statusCode}`));
					return;
				}
				this._total = Number(response.headers['content-length'] ?? 0);
				const stream = fs.createWriteStream(destination);
				this._active = {
					destroy: () => {
						response.destroy();
						stream.destroy();
					}
				};
				response.on('data', (chunk: Buffer) => {
					if (this._abort) {
						response.destroy();
						return;
					}
					this._downloaded += chunk.length;
					this._emitProgress();
				});
				response.pipe(stream);
				stream.on('finish', () => {
					this._active = null;
					if (this._abort) {
						reject(new Error('Download aborted'));
						return;
					}
					this._verify(destination)
						.then((ok) => {
							if (ok) {
								resolve(true);
							} else {
								reject(new Error('Signature verification failed'));
							}
						})
						.catch((err: unknown) => {
							reject(err);
						});
				});
				stream.on('error', (err: Error) => {
					this._active = null;
					reject(err);
				});
			});

			this._active = {
				destroy: () => request.destroy()
			};

			request.setTimeout(timeoutMs, () => {
				request.destroy(new Error(`Download timed out after ${timeoutMs}ms`));
			});
			request.on('error', (err: Error) => {
				this._active = null;
				reject(err);
			});
		}).finally(() => {
			this._progressSubscriptions.clear();
		});
	}

	public cancel(): void {
		this._abort = true;
		this._active?.destroy();
		this._active = null;
	}

	public isCancelled(): boolean {
		return this._abort;
	}

	public getProgress(): DownloadProgress | null {
		return {
			received: this._downloaded,
			total: this._total,
			percent: this._total > 0 ? this._downloaded / this._total : 0,
			speed: this._startedAt > 0 ? this._downloaded / ((Date.now() - this._startedAt) / 1000) : 0,
			startedAt: this._startedAt
		};
	}

	public override dispose(): void {
		this.cancel();
		super.dispose();
	}

	private readonly _progressSubscriptions = new Set<(progress: DownloadProgress) => void>();

	private _emitProgress(): void {
		const progress = this.getProgress();
		if (!progress) {
			return;
		}
		this._onProgress.fire(progress);
		this._options.onProgress?.(progress);
		for (const subscription of this._progressSubscriptions) {
			try {
				subscription(progress);
			} catch {
				// Ignore.
			}
		}
	}

	private _onDidProgressHandler() {
		return this._onProgress;
	}

	private async _verify(filePath: string): Promise<boolean> {
		if (!this._options.signatureHex && !this._options.publicKeyPem) {
			return true;
		}
		return verifySignature(filePath, this._options.signatureHex, this._options.publicKeyPem);
	}
}

export function createUpdateDownloader(options?: UpdateDownloaderOptions): UpdateDownloader {
	return new UpdateDownloader(options);
}
