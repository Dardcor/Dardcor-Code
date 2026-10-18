/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

const ROOT_PACKAGE_JSON = path.join(THIS_DIR, '..', '..', 'package.json');

export const SDK_PACKAGE_NAME = 'foundry-local-sdk';

export const RUNTIME_ID = 'foundry-local';

interface IRootPackageJson {
	readonly dependencies?: Readonly<Record<string, string>>;
}

let _versionCache: string | undefined;

export function getRuntimeVersion(): string {
	if (_versionCache) {
		return _versionCache;
	}
	const json = JSON.parse(fs.readFileSync(ROOT_PACKAGE_JSON, 'utf8')) as IRootPackageJson;
	const version = json.dependencies?.[SDK_PACKAGE_NAME];
	if (!version) {
		throw new Error(`Expected a '${SDK_PACKAGE_NAME}' entry in ${ROOT_PACKAGE_JSON} dependencies.`);
	}
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`Refusing to use ${SDK_PACKAGE_NAME}@${version} from ${ROOT_PACKAGE_JSON}: must be an exact version (no ^ or ~ ranges).`);
	}
	_versionCache = version;
	return version;
}

export type VscodeBuildPlatform = 'darwin' | 'linux' | 'win32';

export const KNOWN_VSCODE_PLATFORMS: ReadonlySet<string> = new Set<VscodeBuildPlatform>([
	'darwin', 'linux', 'win32',
]);

export const SUPPORTED_TARGETS: ReadonlySet<string> = new Set([
	'darwin-arm64',
	'linux-x64',
	'linux-arm64',
	'win32-x64',
	'win32-arm64',
]);

export function getRuntimeTargetForBuild(vscodePlatform: string, arch: string): string | undefined {
	if (vscodePlatform === 'alpine' || arch === 'alpine' || arch === 'musl') {
		return undefined;
	}
	const target = `${vscodePlatform}-${arch}`;
	return SUPPORTED_TARGETS.has(target) ? target : undefined;
}

export function shouldStampRuntime(vscodePlatform: string, arch: string): boolean {
	if (getRuntimeTargetForBuild(vscodePlatform, arch)) {
		return true;
	}
	return vscodePlatform === 'darwin' && arch === 'x64';
}

export function buildCdnUrl(version: string, target: string): string {
	return `https://main.vscode-cdn.net/dictation-runtime/${RUNTIME_ID}/${version}/${target}.tgz`;
}

export function buildCdnUrlTemplate(version: string): string {
	return `https://main.vscode-cdn.net/dictation-runtime/${RUNTIME_ID}/${version}/{target}.tgz`;
}

export function sha256OfFile(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(filePath);
		stream.on('error', reject);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

export function parseFlags(argv: readonly string[]): Map<string, string> {
	const flags = new Map<string, string>();
	for (const arg of argv) {
		const m = /^--([a-zA-Z-]+)=(.+)$/.exec(arg);
		if (m) {
			flags.set(m[1], m[2]);
		}
	}
	return flags;
}

export interface IDictationRuntimeResult {
	readonly version: string;
	readonly urlTemplate: string;
}

export function readDictationRuntimeResults(): IDictationRuntimeResult | undefined {
	const filePath = process.env.DICTATION_RUNTIME_RESULTS_FILE;
	if (!filePath || !fs.existsSync(filePath)) {
		return undefined;
	}
	const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error(`DICTATION_RUNTIME_RESULTS_FILE at ${filePath} is not a JSON object`);
	}
	const result = parsed as Partial<IDictationRuntimeResult>;
	if (typeof result.version !== 'string' || typeof result.urlTemplate !== 'string') {
		return undefined;
	}
	return { version: result.version, urlTemplate: result.urlTemplate };
}
