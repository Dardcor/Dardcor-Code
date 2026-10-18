/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as tar from 'tar';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import * as path from '../../../base/common/path.js';
import { format2 } from '../../../base/common/strings.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { detectLibcSync, type LibcFamily } from '../../../base/node/libc.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { FileOperationError, FileOperationResult, IFileService, toFileOperationResult } from '../../files/common/files.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService } from '../../request/common/request.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { IRequestContext } from '../../../base/parts/request/common/request.js';
import { IAgentHostStorageService } from './agentHostStorageService.js';
import { reportAgentSdkDownload } from './agentSdkDownloadTelemetry.js';


export interface IAgentSdkPackage {
	readonly id: string;
	readonly displayName: string;
	readonly devOverrideEnvVar: string;
	readonly hasSeparateMuslLinuxPackage: boolean;
}

export interface ISdkTargetHost {
	readonly platform: NodeJS.Platform;
	readonly arch: string;
	readonly libc: LibcFamily | undefined;
}

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['linux', 'darwin', 'win32']);
const SUPPORTED_ARCHES = new Set<string>(['x64', 'arm64']);

export function resolveSdkTarget(
	pkg: Pick<IAgentSdkPackage, 'hasSeparateMuslLinuxPackage'>,
	host: ISdkTargetHost = { platform: process.platform, arch: process.arch, libc: detectLibcSync() },
): string | undefined {
	if (!SUPPORTED_PLATFORMS.has(host.platform) || !SUPPORTED_ARCHES.has(host.arch)) {
		return undefined;
	}
	if (host.platform === 'linux' && pkg.hasSeparateMuslLinuxPackage && host.libc === 'musl') {
		return `linux-${host.arch}-musl`;
	}
	return `${host.platform}-${host.arch}`;
}



export const IAgentSdkDownloader = createDecorator<IAgentSdkDownloader>('agentSdkDownloader');

export type AgentSdkDownloadPhase = 'started' | 'progress' | 'completed' | 'failed';

/**
 * A process-global download-progress sample fired on
 * {@link IAgentSdkDownloader.onDidDownloadProgress}. The downloader owns the
 * lifecycle: one `started`, throttled `progress` frames, then exactly one
 * terminal `completed` / `failed` — all sharing a `downloadId`. Concurrent
 * `loadSdkRoot` callers for the same tarball are deduped, so they observe one
 * shared download (one `downloadId`).
 */
export interface IAgentSdkDownloadProgress {
	readonly downloadId: string;
	readonly packageId: string;
	readonly displayName: string;
	readonly phase: AgentSdkDownloadPhase;
	readonly receivedBytes: number;
	readonly totalBytes: number | undefined;
	readonly explicitlyRequested: boolean;
	readonly error?: string;
}

export interface IAgentSdkDownloader {
	readonly _serviceBrand: undefined;

	/**
	 * Fires while a tarball is being fetched (cold cache only): one `started`,
	 * throttled `progress` samples, then one terminal `completed` / `failed`.
	 * Never fires for dev-override or cache-hit resolutions (no bytes move).
	 * Process-global so a single subscriber (the protocol server) can forward
	 * progress to clients regardless of which session triggered the fetch.
	 */
	readonly onDidDownloadProgress: Event<IAgentSdkDownloadProgress>;

	hasDownloadConsent(pkg: IAgentSdkPackage): boolean;

	recordDownloadConsent(pkg: IAgentSdkPackage): Promise<void>;

	acquireDownloadProgressInterest(pkg: IAgentSdkPackage): IDisposable;

	loadSdkRoot(pkg: IAgentSdkPackage, token: CancellationToken): Promise<string>;

	isAvailable(pkg: IAgentSdkPackage): boolean;

	isSdkResolvableWithoutDownload(pkg: IAgentSdkPackage): Promise<boolean>;
}



const LOAD_FAILURE_NEGATIVE_CACHE_MS = 30_000;
const AGENT_SDK_DOWNLOAD_CONSENT_STORAGE_KEY = 'agentSdkDownloadConsent';

const PROGRESS_EMIT_THROTTLE_MS = 250;

function parseContentLength(header: string | string[] | undefined): number | undefined {
	if (typeof header !== 'string' || !/^\d+$/.test(header)) {
		return undefined;
	}
	const parsed = parseInt(header, 10);
	return parsed > 0 ? parsed : undefined;
}

export class AgentSdkDownloader extends Disposable implements IAgentSdkDownloader {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidDownloadProgress = this._register(new Emitter<IAgentSdkDownloadProgress>());
	readonly onDidDownloadProgress: Event<IAgentSdkDownloadProgress> = this._onDidDownloadProgress.event;

	private readonly _pendingDownloads = new Map<string, Promise<string>>();
	private readonly _explicitProgressInterest = new Map<string, number>();

	/**
	 * Negative cache: most recent failure per package id, with an expiry.
	 * While within the window, `loadSdkRoot` re-throws the cached error
	 * immediately instead of re-attempting the download. Without this, a
	 * broken CDN causes every SDK method call (poll-driven UIs hit this
	 * hard) to fire a fresh request.
	 *
	 * Keyed by `pkg.id` (not the finer cacheDir): CDN failures are
	 * effectively global per SDK (DNS, proxy auth, 5xx) and per-target
	 * latching wouldn't protect against the actual failure modes — the
	 * broader latch is intentional.
	 */
	private readonly _failureLatch = new Map<string, { error: Error; expiresAt: number }>();

	constructor(
		@INativeEnvironmentService private readonly _environmentService: INativeEnvironmentService,
		@IProductService private readonly _productService: IProductService,
		@IRequestService private readonly _requestService: IRequestService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IAgentHostStorageService private readonly _storageService: IAgentHostStorageService,
	) {
		super();
	}

	isAvailable(pkg: IAgentSdkPackage): boolean {
		if (process.env[pkg.devOverrideEnvVar]) {
			return true;
		}
		return !!this._productService.agentSdks?.[pkg.id] && resolveSdkTarget(pkg) !== undefined;
	}

	hasDownloadConsent(pkg: IAgentSdkPackage): boolean {
		return this._readDownloadConsents().includes(pkg.id);
	}

	async recordDownloadConsent(pkg: IAgentSdkPackage): Promise<void> {
		const consented = this._readDownloadConsents();
		if (!consented.includes(pkg.id)) {
			await this._storageService.setAndFlush(AGENT_SDK_DOWNLOAD_CONSENT_STORAGE_KEY, [...consented, pkg.id]);
		}
	}

	private _readDownloadConsents(): readonly string[] {
		const stored = this._storageService.get<unknown>(AGENT_SDK_DOWNLOAD_CONSENT_STORAGE_KEY);
		return Array.isArray(stored) ? stored.filter(packageId => typeof packageId === 'string') : [];
	}

	acquireDownloadProgressInterest(pkg: IAgentSdkPackage): IDisposable {
		this._explicitProgressInterest.set(pkg.id, (this._explicitProgressInterest.get(pkg.id) ?? 0) + 1);
		return toDisposable(() => {
			const count = this._explicitProgressInterest.get(pkg.id) ?? 0;
			if (count <= 1) {
				this._explicitProgressInterest.delete(pkg.id);
			} else {
				this._explicitProgressInterest.set(pkg.id, count - 1);
			}
		});
	}

	async isSdkResolvableWithoutDownload(pkg: IAgentSdkPackage): Promise<boolean> {
		if (process.env[pkg.devOverrideEnvVar]) {
			return true;
		}
		const config = this._productService.agentSdks?.[pkg.id];
		if (!config) {
			return false;
		}
		const sdkTarget = resolveSdkTarget(pkg);
		if (!sdkTarget) {
			return false;
		}
		const sentinel = URI.joinPath(URI.file(this._cacheDir(pkg.id, config.version, sdkTarget)), '.complete');
		return this._fileService.exists(sentinel);
	}

	async loadSdkRoot(pkg: IAgentSdkPackage, token: CancellationToken): Promise<string> {
		const override = process.env[pkg.devOverrideEnvVar];
		if (override) {
			this._logService.info(`[AgentSdkDownloader] ${pkg.id}: using dev override at ${override}`);
			return override;
		}

		const latched = this._failureLatch.get(pkg.id);
		if (latched && latched.expiresAt > Date.now() && !this._explicitProgressInterest.has(pkg.id)) {
			throw latched.error;
		}

		try {
			const root = await this._resolveOrDownload(pkg, token);
			this._failureLatch.delete(pkg.id);
			return root;
		} catch (err) {
			if (token.isCancellationRequested) {
				throw err;
			}
			const error = err instanceof Error ? err : new Error(String(err));
			this._failureLatch.set(pkg.id, {
				error,
				expiresAt: Date.now() + LOAD_FAILURE_NEGATIVE_CACHE_MS,
			});
			throw error;
		}
	}

	private async _resolveOrDownload(pkg: IAgentSdkPackage, token: CancellationToken): Promise<string> {
		const config = this._productService.agentSdks?.[pkg.id];
		if (!config) {
			throw new Error(
				`Cannot load ${pkg.id} SDK: no \`product.agentSdks.${pkg.id}\` configured and ` +
				`no ${pkg.devOverrideEnvVar} dev override set.`,
			);
		}
		const sdkTarget = resolveSdkTarget(pkg);
		if (!sdkTarget) {
			throw new Error(
				`Cannot load ${pkg.id} SDK: no SDK target for this host ` +
				`(${process.platform}/${process.arch}). ` +
				`Set ${pkg.devOverrideEnvVar} to a local SDK root to bypass.`,
			);
		}
		const url = format2(config.urlTemplate, { sdkTarget });
		const stray = /{[^}]+}/.exec(url);
		if (stray) {
			throw new Error(
				`Cannot load ${pkg.id} SDK: \`product.agentSdks.${pkg.id}.urlTemplate\` ` +
				`contains an unknown placeholder ${stray[0]} — only {sdkTarget} is substituted. ` +
				`Template: ${config.urlTemplate}`,
			);
		}

		const cacheDir = this._cacheDir(pkg.id, config.version, sdkTarget);
		const sentinel = URI.joinPath(URI.file(cacheDir), '.complete');

		if (await this._fileService.exists(sentinel)) {
			this._logService.trace(`[AgentSdkDownloader] ${pkg.id}: cache hit at ${cacheDir}`);
			return cacheDir;
		}
		this._logService.info(`[AgentSdkDownloader] ${pkg.id}: cache miss for version ${config.version} (${sdkTarget}); a download is required`);

		let pending = this._pendingDownloads.get(cacheDir);
		if (!pending) {
			pending = this._download(pkg, url, cacheDir, sentinel, token).finally(() => {
				this._pendingDownloads.delete(cacheDir);
			});
			this._pendingDownloads.set(cacheDir, pending);
		}
		return pending;
	}

	private _cacheDir(packageId: string, sdkVersion: string, sdkTarget: string): string {
		return path.join(
			this._environmentService.userDataPath,
			'agent-host',
			'sdk-cache',
			packageId,
			sdkVersion,
			sdkTarget,
		);
	}

	private async _download(
		pkg: IAgentSdkPackage,
		url: string,
		cacheDir: string,
		sentinel: URI,
		token: CancellationToken,
	): Promise<string> {
		this._logService.info(`[AgentSdkDownloader] ${pkg.id}: downloading from ${url}`);
		const start = Date.now();
		const parent = path.dirname(cacheDir);
		await this._fileService.createFolder(URI.file(parent));

		const tmpDir = `${cacheDir}.tmp.${process.pid}`;
		const tmpDirUri = URI.file(tmpDir);
		await this._delIgnoringMissing(tmpDirUri);
		await this._fileService.createFolder(tmpDirUri);

		// Fire the download lifecycle on the process-global event so a single
		const downloadId = generateUuid();
		let lastReceived = 0;
		let lastTotal: number | undefined;
		this._fireProgress(pkg, downloadId, start, 'started', 0, undefined);

		try {
			const tarballPath = path.join(tmpDir, 'sdk.tgz');
			await this._fetch(url, tarballPath, token, (receivedBytes, totalBytes) => {
				lastReceived = receivedBytes;
				lastTotal = totalBytes;
				this._fireProgress(pkg, downloadId, start, 'progress', receivedBytes, totalBytes);
			});
			await this._extractTarGz(tarballPath, tmpDir);
			await this._fileService.del(URI.file(tarballPath));

			await this._fileService.writeFile(
				URI.joinPath(tmpDirUri, '.complete'),
				VSBuffer.fromString(''),
			);

			try {
				await this._fileService.move(tmpDirUri, URI.file(cacheDir));
			} catch (err) {
				if (await this._handleRenameLoser(err, sentinel, tmpDirUri)) {
					this._logService.info(`[AgentSdkDownloader] ${pkg.id}: lost rename race, using existing cache`);
					this._fireProgress(pkg, downloadId, start, 'completed', lastReceived, lastTotal);
					return cacheDir;
				}
				throw err;
			}

			const elapsed = Math.round((Date.now() - start) / 1000);
			this._logService.info(`[AgentSdkDownloader] ${pkg.id}: downloaded ${lastTotal ?? lastReceived} bytes in ${elapsed}s`);
			this._fireProgress(pkg, downloadId, start, 'completed', lastTotal ?? lastReceived, lastTotal);
			return cacheDir;
		} catch (err) {
			await this._delIgnoringMissing(tmpDirUri);
			if (token.isCancellationRequested) {
				this._fireProgress(pkg, downloadId, start, 'failed', lastReceived, lastTotal, 'cancelled');
				throw new CancellationError();
			}
			const message = err instanceof Error ? err.message : String(err);
			this._fireProgress(pkg, downloadId, start, 'failed', lastReceived, lastTotal, message);
			throw new Error(
				`Failed to download ${pkg.id} SDK from ${url} ` +
				`(cache target: ${cacheDir}). ` +
				`Set ${pkg.devOverrideEnvVar} to a local SDK root to bypass. ` +
				`Cause: ${message}`,
			);
		}
	}

	private _fireProgress(
		pkg: IAgentSdkPackage,
		downloadId: string,
		startedAt: number,
		phase: AgentSdkDownloadPhase,
		receivedBytes: number,
		totalBytes: number | undefined,
		error?: string,
	): void {
		const progress: IAgentSdkDownloadProgress = {
			downloadId,
			packageId: pkg.id,
			displayName: pkg.displayName,
			phase,
			receivedBytes,
			totalBytes,
			explicitlyRequested: this._explicitProgressInterest.has(pkg.id),
			...(error !== undefined ? { error } : {}),
		};
		this._onDidDownloadProgress.fire(progress);
		if (phase !== 'progress') {
			reportAgentSdkDownload(this._telemetryService, this._logService, progress, Date.now() - startedAt);
		}
	}

	private async _handleRenameLoser(
		err: unknown,
		sentinel: URI,
		tmpDirUri: URI,
	): Promise<boolean> {
		if (!(err instanceof FileOperationError) || err.fileOperationResult !== FileOperationResult.FILE_MOVE_CONFLICT) {
			return false;
		}
		if (!(await this._fileService.exists(sentinel))) {
			return false;
		}
		await this._delIgnoringMissing(tmpDirUri);
		return true;
	}

	private async _fetch(
		url: string,
		dest: string,
		token: CancellationToken,
		onBytes?: (receivedBytes: number, totalBytes: number | undefined) => void,
	): Promise<void> {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const context: IRequestContext = await this._requestService.request({
			url,
			type: 'GET',
			callSite: 'agentSdkDownloader',
		}, token);
		if (token.isCancellationRequested) {
			context.stream.destroy();
			throw new CancellationError();
		}

		const statusCode = context.res.statusCode ?? 0;
		if (statusCode < 200 || statusCode >= 300) {
			context.stream.destroy();
			throw new Error(`HTTP ${statusCode} fetching ${url}`);
		}

		const totalBytes = parseContentLength(context.res.headers['content-length']);

		await new Promise<void>((resolve, reject) => {
			const out = fs.createWriteStream(dest);
			let settled = false;
			let receivedBytes = 0;
			let lastEmitTime = 0;
			const emitBytes = (force: boolean) => {
				if (!onBytes) {
					return;
				}
				const now = Date.now();
				if (!force && now - lastEmitTime < PROGRESS_EMIT_THROTTLE_MS) {
					return;
				}
				lastEmitTime = now;
				onBytes(receivedBytes, totalBytes);
			};
			const settleResolve = () => {
				if (settled) { return; }
				settled = true;
				cancelSub.dispose();
				resolve();
			};
			const settleReject = (err: unknown) => {
				if (settled) { return; }
				settled = true;
				cancelSub.dispose();
				context.stream.destroy();
				out.destroy();
				reject(err);
			};
			const cancelSub = token.onCancellationRequested(() => settleReject(new CancellationError()));
			out.on('error', settleReject);
			out.on('finish', settleResolve);
			out.on('drain', () => context.stream.resume());
			context.stream.on('data', chunk => {
				receivedBytes += chunk.byteLength;
				emitBytes(false);
				if (!out.write(chunk.buffer)) {
					context.stream.pause();
				}
			});
			context.stream.on('end', () => {
				emitBytes(true);
				out.end();
			});
			context.stream.on('error', settleReject);
		});
	}

	private async _extractTarGz(tarball: string, dest: string): Promise<void> {
		await tar.x({ file: tarball, cwd: dest });
	}

	private async _delIgnoringMissing(uri: URI): Promise<void> {
		try {
			await this._fileService.del(uri, { recursive: true });
		} catch (err) {
			if (toFileOperationResult(err as Error) !== FileOperationResult.FILE_NOT_FOUND) {
				throw err;
			}
		}
	}
}

