/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import { dirname, join } from '../../../base/common/path.js';
import { format2 } from '../../../base/common/strings.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';


export const FOUNDRY_LOCAL_SUPPORTED_PLATFORMS: ReadonlySet<string> = new Set([
	'darwin-arm64',
	'linux-x64',
	'linux-arm64',
	'win32-x64',
	'win32-arm64',
]);

export function foundryLocalPlatformKey(): string | undefined {
	const key = `${process.platform}-${process.arch}`;
	return FOUNDRY_LOCAL_SUPPORTED_PLATFORMS.has(key) ? key : undefined;
}

export function isFoundryLocalRuntimeSupported(): boolean {
	return foundryLocalPlatformKey() !== undefined;
}

export type FoundryLocalRuntimeProgress = (message: string) => void;

export interface IFoundryLocalRuntimeDownload {
	readonly urlTemplate: string;
	readonly version: string;
}

const inFlight = new Map<string, Promise<string>>();

const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 60_000;

export async function ensureFoundryLocalRuntime(cacheRoot: string, download: IFoundryLocalRuntimeDownload, token: CancellationToken, onProgress?: FoundryLocalRuntimeProgress): Promise<string> {
	const platformKey = foundryLocalPlatformKey();
	if (!platformKey) {
		throw new Error(`Foundry Local native runtime is not available on ${process.platform}-${process.arch}.`);
	}

	const overrideDir = join(cacheRoot, download.version);

	const existing = inFlight.get(overrideDir);
	if (existing) {
		return existing;
	}
	const promise = doEnsure(overrideDir, platformKey, download, token, onProgress)
		.finally(() => inFlight.delete(overrideDir));
	inFlight.set(overrideDir, promise);
	return promise;
}

async function doEnsure(overrideDir: string, platformKey: string, download: IFoundryLocalRuntimeDownload, token: CancellationToken, onProgress?: FoundryLocalRuntimeProgress): Promise<string> {
	if (isRuntimeProvisioned(overrideDir, platformKey)) {
		return overrideDir;
	}

	assertRuntimeLoadable(platformKey);

	onProgress?.('Downloading dictation runtime…');
	await provisionRuntime(overrideDir, platformKey, download.urlTemplate, download.version, token);
	return overrideDir;
}








export async function provisionRuntime(overrideDir: string, platformKey: string, urlTemplate: string, version: string, token: CancellationToken): Promise<void> {
	const addonPath = foundryAddonPath(overrideDir, platformKey);
	const coreDir = foundryCoreDir(overrideDir, platformKey);

	const url = format2(urlTemplate, { target: platformKey });
	const staging = join(overrideDir, `.staging-${process.pid}-${randomSuffix()}`);
	const stagingAddon = join(staging, 'prebuilds', platformKey, 'foundry_local_napi.node');
	const stagingCore = join(staging, 'foundry-local-core', platformKey);
	try {
		await downloadAndExtractTarball(url, staging, token);
		throwIfCancelled(token);

		if (!fs.existsSync(stagingAddon) || !hasAllCoreLibraries(stagingCore)) {
			throw new Error(`Foundry Local native runtime download from ${url} completed but expected files are missing.`);
		}

		await promoteDir(dirname(stagingAddon), dirname(addonPath));
		await promoteDir(stagingCore, coreDir);
	} finally {
		await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => { });
	}

	if (!fs.existsSync(addonPath) || !hasAllCoreLibraries(coreDir)) {
		throw new Error('Foundry Local native runtime is incomplete after provisioning.');
	}

	await fs.promises.writeFile(foundryMarkerPath(overrideDir, platformKey), `${version}\n`).catch(() => { });
}

function foundryMarkerPath(overrideDir: string, platformKey: string): string {
	return join(overrideDir, `.complete-${platformKey}`);
}

function foundryAddonPath(overrideDir: string, platformKey: string): string {
	return join(overrideDir, 'prebuilds', platformKey, 'foundry_local_napi.node');
}

function foundryCoreDir(overrideDir: string, platformKey: string): string {
	return join(overrideDir, 'foundry-local-core', platformKey);
}

export function isRuntimeProvisioned(overrideDir: string, platformKey: string): boolean {
	return fs.existsSync(foundryMarkerPath(overrideDir, platformKey))
		&& fs.existsSync(foundryAddonPath(overrideDir, platformKey))
		&& hasAllCoreLibraries(foundryCoreDir(overrideDir, platformKey));
}

export async function promoteDir(from: string, to: string): Promise<void> {
	await fs.promises.mkdir(dirname(to), { recursive: true });
	try {
		await fs.promises.rename(from, to);
	} catch (err) {
		if (fs.existsSync(to)) {
			return;
		}
		throw err;
	}
}

function randomSuffix(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const MIN_GLIBC: readonly [number, number] = [2, 34];

function assertRuntimeLoadable(platformKey: string): void {
	if (!platformKey.startsWith('linux-')) {
		return;
	}
	const glibc = detectGlibcVersion();
	if (glibc && (glibc[0] < MIN_GLIBC[0] || (glibc[0] === MIN_GLIBC[0] && glibc[1] < MIN_GLIBC[1]))) {
		const err = new Error(`On-device dictation requires glibc ${MIN_GLIBC[0]}.${MIN_GLIBC[1]} or newer, but this system has glibc ${glibc[0]}.${glibc[1]}.`);
		(err as Error & { code?: string }).code = 'ERR_FOUNDRY_UNSUPPORTED_LIBC';
		throw err;
	}
}

function detectGlibcVersion(): [number, number] | undefined {
	try {
		const report = (process as unknown as { report?: { getReport?(): { header?: { glibcVersionRuntime?: string } } } }).report;
		const version = report?.getReport?.()?.header?.glibcVersionRuntime;
		const match = typeof version === 'string' ? /^(\d+)\.(\d+)/.exec(version) : null;
		if (match) {
			return [Number(match[1]), Number(match[2])];
		}
	} catch {
	}
	return undefined;
}

async function downloadAndExtractTarball(url: string, stagingDir: string, token: CancellationToken): Promise<void> {
	await fs.promises.mkdir(stagingDir, { recursive: true });
	const tmpDir = await fs.promises.mkdtemp(join(os.tmpdir(), 'vscode-foundry-runtime-'));
	try {
		const tarballPath = join(tmpDir, 'runtime.tgz');
		await downloadFile(url, tarballPath, token);
		throwIfCancelled(token);

		const tar = await import('tar');
		await tar.x({ file: tarballPath, cwd: stagingDir });
	} finally {
		await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
	}
}

export function requiredCoreLibraryNames(): string[] {
	const ext = process.platform === 'win32' ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so';
	const prefix = process.platform === 'win32' ? '' : 'lib';
	return [
		`Microsoft.AI.Foundry.Local.Core${ext}`,
		`${prefix}onnxruntime${ext}`,
		`${prefix}onnxruntime-genai${ext}`,
	];
}

function hasAllCoreLibraries(coreDir: string): boolean {
	return requiredCoreLibraryNames().every(name => fs.existsSync(join(coreDir, name)));
}












export function resolveProxyUrl(targetUrl: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(targetUrl);
	} catch {
		return undefined;
	}
	const scheme = parsed.protocol === 'http:'
		? (env.HTTP_PROXY ?? env.http_proxy)
		: (env.HTTPS_PROXY ?? env.https_proxy);
	const proxy = scheme ?? env.ALL_PROXY ?? env.all_proxy;
	if (!proxy) {
		return undefined;
	}
	const noProxy = env.NO_PROXY ?? env.no_proxy;
	if (noProxy && isNoProxyHost(noProxy, parsed.hostname)) {
		return undefined;
	}
	return proxy;
}

function isNoProxyHost(noProxy: string, hostname: string): boolean {
	const host = hostname.toLowerCase();
	return noProxy.split(',').some(raw => {
		const entry = raw.trim().toLowerCase().replace(/^\./, '');
		if (!entry) {
			return false;
		}
		return entry === '*' || host === entry || host.endsWith(`.${entry}`);
	});
}

async function resolveProxyAgent(targetUrl: string): Promise<import('http').Agent | undefined> {
	const proxyUrl = resolveProxyUrl(targetUrl);
	if (!proxyUrl) {
		return undefined;
	}
	const { HttpsProxyAgent } = await import('https-proxy-agent');
	return new HttpsProxyAgent(proxyUrl);
}

async function downloadFile(url: string, dest: string, token: CancellationToken): Promise<void> {
	const [https, http] = await Promise.all([import('https'), import('http')]);
	const getFor = (u: string) => (new URL(u).protocol === 'http:' ? http.get : https.get);
	const agent = await resolveProxyAgent(url);
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let activeRequest: import('http').ClientRequest | undefined;
		const file = fs.createWriteStream(dest);

		const finish = (err?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
			}
			activeRequest?.destroy();
			if (!err) {
				resolve();
				return;
			}
			file.close(() => fs.promises.rm(dest, { force: true }).catch(() => { }).finally(() => reject(err)));
		};
		const armTimeout = () => {
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => finish(new Error(`Timed out downloading ${url}.`)), DOWNLOAD_INACTIVITY_TIMEOUT_MS);
		};

		const request = (currentUrl: string, redirectsLeft: number): void => {
			if (token.isCancellationRequested) {
				finish(new CancellationError());
				return;
			}
			armTimeout();
			activeRequest = getFor(currentUrl)(currentUrl, { agent }, response => {
				armTimeout();
				const status = response.statusCode ?? 0;
				if (status >= 300 && status < 400 && response.headers.location) {
					response.resume();
					if (redirectsLeft <= 0) {
						finish(new Error(`Too many redirects downloading ${url}.`));
						return;
					}
					request(new URL(response.headers.location, currentUrl).toString(), redirectsLeft - 1);
					return;
				}
				if (status !== 200) {
					response.resume();
					finish(new Error(`Download failed with status ${status}: ${currentUrl}`));
					return;
				}
				response.on('data', armTimeout);
				response.on('error', err => finish(err));
				response.pipe(file);
				file.on('finish', () => file.close(err => err ? finish(err) : finish()));
			});
			activeRequest.on('error', err => finish(err));
		};
		file.on('error', err => finish(err));
		request(url, 5);
	});
}

function throwIfCancelled(token: CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new CancellationError();
	}
}
