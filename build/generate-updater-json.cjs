#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(filePath) {
	return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function getVersion(tagName, explicitVersion) {
	const version = explicitVersion || tagName.replace(/^Dardcor-Code-v?/, '').replace(/^v/, '');
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`Invalid release version: ${version || '(empty)'}`);
	}
	return version;
}

function generateUpdaterManifest(targetDir, repository, tagName, explicitVersion) {
	const dir = path.resolve(targetDir || '.');
	const repo = repository || 'Dardcor/Dardcor-Code';
	const tag = tagName || 'Dardcor-Code-v1.0.0';
	const version = getVersion(tag, explicitVersion);
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^[A-Za-z0-9_.-]+$/.test(tag)) {
		throw new Error('Invalid repository or release tag.');
	}

	function getAsset(fileName) {
		const filePath = path.join(dir, fileName);
		if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) {
			throw new Error(`Required release asset is missing or empty: ${fileName}`);
		}
		return {
			url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(fileName)}`,
			name: version,
			version,
			productVersion: version,
			sha256hash: sha256(filePath)
		};
	}

	const platforms = {
		'win32-x64-user': getAsset(`Dardcor-Code_${version}_x64-setup.exe`),
		'win32-x64': getAsset(`Dardcor-Code_${version}_x64-setup.exe`),
		'win32-arm64-user': getAsset(`Dardcor-Code_${version}_arm64-setup.exe`),
		'win32-arm64': getAsset(`Dardcor-Code_${version}_arm64-setup.exe`),
		'linux-x64': getAsset(`Dardcor-Code_${version}_amd64.deb`),
		'linux-arm64': getAsset(`Dardcor-Code_${version}_arm64.deb`),
		'darwin': getAsset(`Dardcor-Code_${version}_x64.dmg`),
		'darwin-x64': getAsset(`Dardcor-Code_${version}_x64.dmg`),
		'darwin-arm64': getAsset(`Dardcor-Code_${version}_arm64.dmg`)
	};

	const manifest = {
		version,
		name: `Dardcor Code v${version}`,
		pub_date: new Date().toISOString(),
		notes: `https://github.com/${repo}/releases/tag/${tag}`,
		platforms
	};
	fs.mkdirSync(dir, { recursive: true });
	const outputPath = path.join(dir, 'updater.json');
	fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	console.log(`[Updater Manifest] Generated ${outputPath} for ${Object.keys(platforms).length} platform targets.`);
	return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
	const args = process.argv.slice(2);
	const positional = [];
	let targetDir = '.';
	let repository = 'Dardcor/Dardcor-Code';
	let tagName = 'Dardcor-Code-v1.0.0';
	let explicitVersion = '';
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (['--dir', '--target-dir', '--output-dir'].includes(arg)) {
			targetDir = args[++index];
		} else if (['--repo', '--repository'].includes(arg)) {
			repository = args[++index];
		} else if (['--tag', '--tag-name'].includes(arg)) {
			tagName = args[++index];
		} else if (arg === '--version') {
			explicitVersion = args[++index];
		} else if (!arg.startsWith('--')) {
			positional.push(arg);
		}
	}
	if (positional[0]) { targetDir = positional[0]; }
	if (positional[1]) { repository = positional[1]; }
	if (positional[2]) { tagName = positional[2]; }
	if (positional[3]) { explicitVersion = positional[3]; }
	try {
		generateUpdaterManifest(targetDir, repository, tagName, explicitVersion);
	} catch (error) {
		console.error(`[Updater Manifest] ${error.message}`);
		process.exitCode = 1;
	}
}

module.exports = { generateUpdaterManifest };
