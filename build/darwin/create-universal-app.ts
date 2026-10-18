/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import fs from 'fs';
import minimatch from 'minimatch';
import { makeUniversalApp } from 'vscode-universal-bundler';

const root = path.dirname(path.dirname(import.meta.dirname));

const nodeModulesBases = [
	path.join('Contents', 'Resources', 'app', 'node_modules'),
	path.join('Contents', 'Resources', 'app', 'node_modules.asar.unpacked')
];

function crossCopyPlatformDir(x64AppPath: string, arm64AppPath: string, relativePath: string): void {
	const inX64 = path.join(x64AppPath, relativePath);
	const inArm64 = path.join(arm64AppPath, relativePath);

	if (fs.existsSync(inX64) && !fs.existsSync(inArm64)) {
		fs.mkdirSync(inArm64, { recursive: true });
		fs.cpSync(inX64, inArm64, { recursive: true });
	} else if (fs.existsSync(inArm64) && !fs.existsSync(inX64)) {
		fs.mkdirSync(inX64, { recursive: true });
		fs.cpSync(inArm64, inX64, { recursive: true });
	}
}

async function main(buildDir?: string) {
	const arch = process.env['VSCODE_ARCH'];

	if (!buildDir) {
		throw new Error('Build dir not provided');
	}

	const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
	const appName = product.nameLong + '.app';
	const x64Folder = fs.existsSync(path.join(buildDir, 'Dardcor-Code-darwin-x64')) ? 'Dardcor-Code-darwin-x64' : 'VSCode-darwin-x64';
	const arm64Folder = fs.existsSync(path.join(buildDir, 'Dardcor-Code-darwin-arm64')) ? 'Dardcor-Code-darwin-arm64' : 'VSCode-darwin-arm64';
	const outFolder = fs.existsSync(path.join(buildDir, `Dardcor-Code-darwin-${arch}`)) ? `Dardcor-Code-darwin-${arch}` : `VSCode-darwin-${arch}`;
	const x64AppPath = path.join(buildDir, x64Folder, appName);
	const arm64AppPath = path.join(buildDir, arm64Folder, appName);
	const asarRelativePath = path.join('Contents', 'Resources', 'app', 'node_modules.asar');
	const outAppPath = path.join(buildDir, outFolder, appName);
	const productJsonPath = path.resolve(outAppPath, 'Contents', 'Resources', 'app', 'product.json');

	for (const plat of ['darwin-x64', 'darwin-arm64']) {
		for (const base of nodeModulesBases) {
			crossCopyPlatformDir(x64AppPath, arm64AppPath, path.join(base, '@vscode', `os-proxy-resolver-${plat}`));
			crossCopyPlatformDir(x64AppPath, arm64AppPath, path.join(base, '@vscode', 'ripgrep-universal', 'bin', plat));
		}
	}

	for (const base of nodeModulesBases) {
		for (const mxcArch of ['x64', 'arm64']) {
			crossCopyPlatformDir(x64AppPath, arm64AppPath, path.join(base, '@microsoft', 'mxc-sdk', 'bin', mxcArch));
		}
	}

	const filesToSkip = [
		'**/CodeResources',
		'**/Credits.rtf',
		'**/policies/{*.mobileconfig,**/*.plist}',
		'**/node_modules/@vscode/os-proxy-resolver-darwin-x64/**',
		'**/node_modules/@vscode/os-proxy-resolver-darwin-arm64/**',
		'**/node_modules.asar.unpacked/@vscode/os-proxy-resolver-darwin-x64/**',
		'**/node_modules.asar.unpacked/@vscode/os-proxy-resolver-darwin-arm64/**',
		'**/node_modules/@vscode/ripgrep-universal/bin/darwin-x64/**',
		'**/node_modules/@vscode/ripgrep-universal/bin/darwin-arm64/**',
		'**/node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/darwin-x64/**',
		'**/node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/darwin-arm64/**',
		'**/node_modules/@microsoft/mxc-sdk/bin/**',
		'**/node_modules.asar.unpacked/@microsoft/mxc-sdk/bin/**',
	];

	await makeUniversalApp({
		x64AppPath,
		arm64AppPath,
		asarPath: asarRelativePath,
		outAppPath,
		force: true,
		mergeASARs: true,
		singleArchFiles: '{**/@vscode/ripgrep-universal/bin/darwin-*,**/@vscode/ripgrep-universal/bin/darwin-*/**,**/@vscode/os-proxy-resolver-darwin-*,**/@vscode/os-proxy-resolver-darwin-*/**,**/@microsoft/mxc-sdk/bin/*,**/@microsoft/mxc-sdk/bin/*/**}',
		x64ArchFiles: '{*/kerberos.node,**/extensions/microsoft-authentication/dist/libmsalruntime.dylib,**/extensions/microsoft-authentication/dist/msal-node-runtime.node,**/node_modules/@vscode/ripgrep-universal/bin/darwin-*/*,**/node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/darwin-*/*,**/node_modules/@vscode/os-proxy-resolver-darwin-*/**,**/node_modules.asar.unpacked/@vscode/os-proxy-resolver-darwin-*/**,**/node_modules/@microsoft/mxc-sdk/bin/**,**/node_modules.asar.unpacked/@microsoft/mxc-sdk/bin/**}',
		filesToSkipComparison: (file: string) => {
			for (const expected of filesToSkip) {
				if (minimatch(file, expected)) {
					return true;
				}
			}
			return false;
		}
	});

	const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
	Object.assign(productJson, {
		darwinUniversalAssetId: 'darwin-universal'
	});
	fs.writeFileSync(productJsonPath, JSON.stringify(productJson, null, '\t'));
}

if (import.meta.main) {
	main(process.argv[2]).catch(err => {
		console.error(err);
		process.exit(1);
	});
}
