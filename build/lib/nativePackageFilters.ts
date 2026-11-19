/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

function toNodePlatformArch(platform: string, arch: string): { nodePlatform: string; nodeArch: string } {
	let nodePlatform = platform === 'alpine' ? 'linux' : platform;
	let nodeArch = arch;

	if (arch === 'armhf') {
		nodeArch = 'arm';
	} else if (arch === 'alpine') {
		nodePlatform = 'linux';
		nodeArch = 'x64';
	}

	return { nodePlatform, nodeArch };
}

const ripgrepUniversalPlatforms = [
	'darwin-arm64', 'darwin-x64',
	'linux-arm', 'linux-arm64', 'linux-ia32', 'linux-x64',
	'linux-ppc64', 'linux-riscv64', 'linux-s390x',
	'win32-arm64', 'win32-ia32', 'win32-x64',
];

const mxcArchitectures = ['x64', 'arm64'];

export function getMxcExcludeFilter(arch: string): string[] {
	const target = mxcArchitectures.includes(arch) ? arch : undefined;
	const nonTargetArchitectures = mxcArchitectures.filter(candidate => candidate !== target);

	return [
		'**',
		...nonTargetArchitectures.map(candidate => `!**/node_modules/@microsoft/mxc-sdk/bin/${candidate}/**`),
	];
}

export function getRipgrepExcludeFilter(platform: string, arch: string): string[] {
	const { nodePlatform, nodeArch } = toNodePlatformArch(platform, arch);
	const target = `${nodePlatform}-${nodeArch}`;
	const nonTargetPlatforms = ripgrepUniversalPlatforms.filter(candidate => candidate !== target);

	return [
		'**',
		...nonTargetPlatforms.map(candidate => `!**/node_modules/@vscode/ripgrep-universal/bin/${candidate}/**`),
	];
}
