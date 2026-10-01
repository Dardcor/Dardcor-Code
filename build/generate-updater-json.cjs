#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function computeSha256(filePath) {
	if (!fs.existsSync(filePath)) {
		return '';
	}
	const buffer = fs.readFileSync(filePath);
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

function generateUpdaterManifest(targetDir, repository, tagName, explicitVersion) {
	const dir = path.resolve(targetDir || '.');
	const repo = repository || 'Dardcor/Dardcor-Code';
	const tag = tagName || 'v1.0.0';

	let version = explicitVersion;
	if (!version) {
		version = tag.replace(/^v/, '').replace(/^Dardcor-Code-v?/, '');
	}
	if (!version) {
		version = '1.0.0';
	}

	const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
	const winExeName = files.find(f => f.endsWith('-setup.exe') || f.endsWith('setup.exe')) || `Dardcor-Code_${version}_x64-setup.exe`;
	const winExePath = path.join(dir, winExeName);
	const winSha256 = fs.existsSync(winExePath) ? computeSha256(winExePath) : '';

	const manifest = {
		version: version,
		name: `Dardcor Code v${version}`,
		pub_date: new Date().toISOString(),
		notes: `https://github.com/${repo}/releases/tag/${tag}`,
		platforms: {
			'win32-x64-user': {
				url: `https://github.com/${repo}/releases/download/${tag}/Dardcor-Code_${version}_x64-setup.exe`,
				name: version,
				version: version,
				productVersion: version,
				sha256hash: winSha256
			},
			'win32-x64': {
				url: `https://github.com/${repo}/releases/download/${tag}/Dardcor-Code_${version}_x64-setup.exe`,
				name: version,
				version: version,
				productVersion: version,
				sha256hash: winSha256
			},
			'win32-x64-archive': {
				url: `https://github.com/${repo}/releases/download/${tag}/Dardcor-Code_${version}_x64_en-US.msi`,
				name: version,
				version: version,
				productVersion: version
			},
			'linux-x64': {
				url: `https://github.com/${repo}/releases/download/${tag}/Dardcor-Code_${version}_amd64.deb`,
				name: version,
				version: version,
				productVersion: version
			},
			'linux-arm64': {
				url: `https://github.com/${repo}/releases/download/${tag}/Dardcor-Code_${version}_arm64.deb`,
				name: version,
				version: version,
				productVersion: version
			},
			'darwin-x64': {
				url: `https://github.com/${repo}/releases/download/${tag}/Dardcor-Code_${version}_x64.dmg`,
				name: version,
				version: version,
				productVersion: version
			},
			'darwin-arm64': {
				url: `https://github.com/${repo}/releases/download/${tag}/Dardcor-Code_${version}_aarch64.dmg`,
				name: version,
				version: version,
				productVersion: version
			},
			'darwin': {
				url: `https://github.com/${repo}/releases/download/${tag}/Dardcor-Code_universal.app.tar.gz`,
				name: version,
				version: version,
				productVersion: version
			}
		}
	};

	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const outputPath = path.join(dir, 'updater.json');
	fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');
	console.log(`[Updater Manifest] Generated ${outputPath}:`);
	console.log(JSON.stringify(manifest, null, 2));
	return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
	const args = process.argv.slice(2);
	let targetDir = '.';
	let repository = 'Dardcor/Dardcor-Code';
	let tagName = 'v1.0.0';
	let explicitVersion = '';

	const positional = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--dir' || arg === '--target-dir' || arg === '--output-dir') {
			targetDir = args[++i];
		} else if (arg === '--repo' || arg === '--repository') {
			repository = args[++i];
		} else if (arg === '--tag' || arg === '--tag-name') {
			tagName = args[++i];
		} else if (arg === '--version') {
			explicitVersion = args[++i];
		} else if (!arg.startsWith('--')) {
			positional.push(arg);
		}
	}

	if (positional.length > 0) {
		targetDir = positional[0] || targetDir;
	}
	if (positional.length > 1) {
		repository = positional[1] || repository;
	}
	if (positional.length > 2) {
		tagName = positional[2] || tagName;
	}
	if (positional.length > 3) {
		explicitVersion = positional[3] || explicitVersion;
	}

	generateUpdaterManifest(targetDir, repository, tagName, explicitVersion);
}

module.exports = { generateUpdaterManifest };
