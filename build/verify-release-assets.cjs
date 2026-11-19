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

function verifyReleaseAssets(directory, version) {
	const dir = path.resolve(directory);
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`Invalid release version: ${version}`);
	}

	const expected = new Set([
		`Dardcor-Code_${version}_x64-setup.exe`,
		`Dardcor-Code_${version}_arm64-setup.exe`,
		...[
			['amd64', 'x86_64', 'x64'],
			['arm64', 'aarch64', 'arm64']
		].flatMap(([debArch, rpmArch, archiveArch]) => [
			`Dardcor-Code_${version}_${debArch}.deb`,
			`Dardcor-Code_${version}_${rpmArch}.rpm`,
			`Dardcor-Code_${version}_${archiveArch}.tar.gz`
		]),
		...['x64', 'arm64'].flatMap(arch => [
			`Dardcor-Code_${version}_${arch}.dmg`,
			`Dardcor-Code_${version}_${arch}.zip`
		]),
		'updater.json'
	]);
	for (const fileName of [...expected].filter(name => name !== 'updater.json')) {
		expected.add(`${fileName}.sig`);
	}

	const actual = new Set(fs.readdirSync(dir).filter(fileName => fs.statSync(path.join(dir, fileName)).isFile()));
	const missing = [...expected].filter(fileName => !actual.has(fileName));
	const unexpected = [...actual].filter(fileName => !expected.has(fileName));
	if (missing.length || unexpected.length) {
		throw new Error(`Release asset inventory mismatch. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`);
	}
	if (actual.size !== 25) {
		throw new Error(`Expected exactly 25 upload assets, found ${actual.size}.`);
	}

	for (const fileName of expected) {
		const filePath = path.join(dir, fileName);
		if (fs.statSync(filePath).size === 0) {
			throw new Error(`Release asset is empty: ${fileName}`);
		}
		if (fileName.endsWith('.sig') || fileName.endsWith('.sha256')) {
			const ext = fileName.endsWith('.sig') ? '.sig' : '.sha256';
			const assetPath = filePath.slice(0, -ext.length);
			const storedHash = fs.readFileSync(filePath, 'utf8').trim().toLowerCase();
			if (!/^[a-f0-9]{64}$/.test(storedHash) || storedHash !== sha256(assetPath)) {
				throw new Error(`Checksum/signature mismatch: ${fileName}`);
			}
		}
	}

	function assertMagic(fileName, predicate, description) {
		const buffer = fs.readFileSync(path.join(dir, fileName));
		if (!predicate(buffer)) {
			throw new Error(`Invalid ${description} file signature: ${fileName}`);
		}
	}
	for (const arch of ['x64', 'arm64']) {
		const debArch = arch === 'x64' ? 'amd64' : 'arm64';
		assertMagic(`Dardcor-Code_${version}_${arch}-setup.exe`, buffer => buffer.subarray(0, 2).toString() === 'MZ', 'Windows installer');
		assertMagic(`Dardcor-Code_${version}_${debArch}.deb`, buffer => buffer.subarray(0, 8).toString() === '!<arch>\n', 'Debian package');
		assertMagic(`Dardcor-Code_${version}_${arch === 'x64' ? 'x86_64' : 'aarch64'}.rpm`, buffer => buffer.subarray(0, 4).equals(Buffer.from([0xed, 0xab, 0xee, 0xdb])), 'RPM package');
		assertMagic(`Dardcor-Code_${version}_${arch}.tar.gz`, buffer => buffer.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])), 'gzip archive');
		assertMagic(`Dardcor-Code_${version}_${arch}.zip`, buffer => buffer.subarray(0, 4).toString('hex').startsWith('504b'), 'ZIP archive');
		assertMagic(`Dardcor-Code_${version}_${arch}.dmg`, buffer => buffer.subarray(Math.max(0, buffer.length - 512)).includes(Buffer.from('koly')), 'Apple disk image');
	}

	const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'updater.json'), 'utf8'));
	if (manifest.version !== version || !manifest.platforms || Object.keys(manifest.platforms).length !== 9) {
		throw new Error('Updater manifest version or platform inventory is invalid.');
	}
	for (const [platform, entry] of Object.entries(manifest.platforms)) {
		const assetName = decodeURIComponent(new URL(entry.url).pathname.split('/').pop());
		const assetPath = path.join(dir, assetName);
		if (!actual.has(assetName) || entry.productVersion !== version || entry.version !== version || entry.sha256hash !== sha256(assetPath)) {
			throw new Error(`Updater manifest entry is invalid for ${platform}: ${assetName}`);
		}
	}

	console.log(`Verified ${actual.size} release assets, checksums, file signatures, and ${Object.keys(manifest.platforms).length} updater targets.`);
}

if (require.main === module) {
	try {
		verifyReleaseAssets(process.argv[2] || '.', process.argv[3] || '');
	} catch (error) {
		console.error(`[Release Verification] ${error.message}`);
		process.exitCode = 1;
	}
}

module.exports = { verifyReleaseAssets };
