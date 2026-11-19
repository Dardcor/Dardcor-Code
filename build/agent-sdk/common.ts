/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const AGENTS_DIR = path.join(THIS_DIR, 'agents');

export type Sdk = string;

let _sdksCache: readonly Sdk[] | undefined;

export function getSdks(): readonly Sdk[] {
	if (_sdksCache) {
		return _sdksCache;
	}
	const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
	_sdksCache = entries
		.filter(e => e.isDirectory())
		.map(e => e.name)
		.sort();
	return _sdksCache;
}

export function getAgentDir(sdk: Sdk): string {
	const dir = path.join(AGENTS_DIR, sdk);
	if (!fs.existsSync(dir)) {
		throw new Error(`Unknown SDK '${sdk}': no directory at ${dir}. Add a folder under build/agent-sdk/agents/ with a package.json + package-lock.json.`);
	}
	return dir;
}

interface IAgentPackageJson {
	readonly dependencies?: Readonly<Record<string, string>>;
}

let _agentMetaCache: Map<Sdk, { name: string; version: string }> | undefined;

export function getAgentMeta(sdk: Sdk): { name: string; version: string } {
	if (!_agentMetaCache) {
		_agentMetaCache = new Map();
	}
	const cached = _agentMetaCache.get(sdk);
	if (cached) {
		return cached;
	}
	const pkgPath = path.join(getAgentDir(sdk), 'package.json');
	const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as IAgentPackageJson;
	const deps = json.dependencies ?? {};
	const entries = Object.entries(deps);
	if (entries.length !== 1) {
		throw new Error(`Expected exactly one dependency in ${pkgPath}, found ${entries.length}: ${entries.map(([k]) => k).join(', ')}`);
	}
	const [name, version] = entries[0];
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`Refusing to use ${name}@${version} from ${pkgPath}: must be an exact version (no ^ or ~ ranges)`);
	}
	const meta = { name, version };
	_agentMetaCache.set(sdk, meta);
	return meta;
}

export function getSdkVersion(sdk: Sdk): string {
	return getAgentMeta(sdk).version;
}

export type VscodeBuildPlatform = 'darwin' | 'linux' | 'alpine' | 'win32';

export const KNOWN_VSCODE_PLATFORMS: ReadonlySet<VscodeBuildPlatform> = new Set([
	'darwin', 'linux', 'alpine', 'win32',
]);

export type VscodeBuildArch = 'x64' | 'arm64';

export function getSdkTargetForBuild(
	vscodePlatform: string,
	arch: string,
	sdk: Sdk,
): string | undefined {
	if (vscodePlatform === 'linux' && arch === 'alpine') {
		vscodePlatform = 'alpine';
		arch = 'x64';
	}
	if (arch !== 'x64' && arch !== 'arm64') {
		return undefined;
	}
	switch (vscodePlatform) {
		case 'darwin': return `darwin-${arch}`;
		case 'win32': return `win32-${arch}`;
		case 'linux': return `linux-${arch}`;
		case 'alpine':
			return sdk === 'claude' ? `linux-${arch}-musl` : `linux-${arch}`;
		default:
			return undefined;
	}
}

export function buildCdnUrl(sdk: Sdk, sdkVersion: string, sdkTarget: string): string {
	return `https://main.vscode-cdn.net/agent-sdk/${sdk}/${sdkVersion}/${sdkTarget}.tgz`;
}

export function buildCdnUrlTemplate(sdk: Sdk, sdkVersion: string): string {
	return `https://main.vscode-cdn.net/agent-sdk/${sdk}/${sdkVersion}/{sdkTarget}.tgz`;
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

export interface IAgentSdkResults {
	[packageId: string]: {
		readonly version: string;
		readonly urlTemplate: string;
	};
}

export function readAgentSdkResults(): IAgentSdkResults {
	const filePath = process.env.AGENT_SDK_RESULTS_FILE;
	if (!filePath || !fs.existsSync(filePath)) {
		return {};
	}
	const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error(`AGENT_SDK_RESULTS_FILE at ${filePath} is not a JSON object`);
	}
	return parsed as IAgentSdkResults;
}
