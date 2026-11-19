/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';

export function isAlpineLinux(): boolean {
	let content: string | undefined;
	for (const filePath of ['/etc/os-release', '/usr/lib/os-release']) {
		try {
			content = fs.readFileSync(filePath, 'utf8');
			break;
		} catch (err) {
		}
	}
	return !!content && (content.match(/^ID=([^\u001b\r\n]*)/m) || [])[1] === 'alpine';
}

const supportedTargets = new Set([
	'win32-x64', 'win32-arm64',
	'linux-x64', 'linux-arm64', 'linux-armhf',
	'alpine-x64', 'alpine-arm64',
	'darwin-x64', 'darwin-arm64',
]);

function toTargetArch(arch: string): string {
	switch (arch) {
		case 'arm': return 'armhf';
		default: return arch;
	}
}

export function getExtensionTarget(platform: string, arch: string, isAlpine: () => boolean = isAlpineLinux): string | undefined {
	const targetArch = toTargetArch(arch);
	let target: string | undefined;
	switch (platform) {
		case 'darwin':
			target = `darwin-${targetArch}`;
			break;
		case 'win32':
			target = `win32-${targetArch}`;
			break;
		case 'linux':
			target = isAlpine() ? `alpine-${targetArch}` : `linux-${targetArch}`;
			break;
	}
	return target && supportedTargets.has(target) ? target : undefined;
}

function readEnv(name: string): string | undefined {
	const value = process.env[name];
	if (!value || value.startsWith('$(')) {
		return undefined;
	}
	return value;
}

export function getCurrentExtensionTarget(): string | undefined {
	const override = readEnv('VSCODE_EXTENSION_TARGET');
	if (override) {
		return override;
	}
	const arch = readEnv('VSCODE_ARCH') ?? process.arch;
	return getExtensionTarget(process.platform, arch);
}

export function getPlatformSpecificAssetName(name: string, target: string): string {
	if (!supportedTargets.has(target)) {
		throw new Error(`Invalid target platform '${target}': expected one of [${[...supportedTargets]}]`);
	}
	return `${name}-${target}.vsix`;
}
