/**
 * Dardcor Code - VSIX Package Builder Tool (Task 919)
 *
 * Standalone `vsce` alternative: builds a VSIX extension archive using a
 * dependency-free ZIP writer (node:zlib deflateRaw + local file headers +
 * central directory + EOCD). Reads extension/package.json, generates
 * extension.vsixmanifest and [Content_Types].xml, packs the extension
 * directory, and writes a publishable .vsix.
 */

import { deflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buffer) {
	let crc = 0xFFFFFFFF;
	for (let i = 0; i < buffer.length; i++) {
		crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
	}
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Creates a ZIP archive from entries.
 * @param {Array<{name: string, data: Buffer|string}>} entries
 * @param {{compress?: boolean}} [options]
 * @returns {Buffer}
 */
function createZip(entries, options = {}) {
	const compress = options.compress !== false;
	const localParts = [];
	const centralParts = [];
	let offset = 0;

	for (const entry of entries) {
		const name = entry.name;
		const nameBuf = Buffer.from(name, 'utf8');
		const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
		const isDir = name.endsWith('/');
		const crc = crc32(data);
		const compressed = compress && !isDir ? deflateRawSync(data) : data;
		const method = compress && !isDir ? 8 : 0;

		// local file header
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);      // PK\x03\x04
		local.writeUInt16LE(20, 4);              // version needed
		local.writeUInt16LE(0x0800, 6);          // flags: UTF-8 names
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(0, 10);              // mod time
		local.writeUInt16LE(0x21, 12);           // mod date (1980-01-01)
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);              // extra len
		localParts.push(local, nameBuf, compressed);

		// central directory header
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);    // PK\x01\x02
		central.writeUInt16LE(20, 4);            // version made by
		central.writeUInt16LE(20, 6);            // version needed
		central.writeUInt16LE(0x0800, 8);        // flags
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(0, 12);
		central.writeUInt16LE(0x21, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt16LE(0, 30);            // extra len
		central.writeUInt16LE(0, 32);            // comment len
		central.writeUInt16LE(0, 34);            // disk start
		central.writeUInt16LE(0, 36);            // internal attrs
		central.writeUInt32LE(0, 38);            // external attrs
		central.writeUInt32LE(offset, 42);       // local header offset
		centralParts.push(central, nameBuf);

		offset += local.length + nameBuf.length + compressed.length;
	}

	const centralStart = offset;
	const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);           // PK\x05\x06
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(centralStart, 16);
	eocd.writeUInt16LE(0, 20);

	return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function contentTypesXml() {
	return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
	<Default Extension="vsixmanifest" ContentType="text/xml" />
	<Default Extension="json" ContentType="application/json" />
	<Default Extension="js" ContentType="text/javascript" />
	<Default Extension="ts" ContentType="text/typescript" />
	<Default Extension="css" ContentType="text/css" />
	<Default Extension="md" ContentType="text/markdown" />
	<Default Extension="svg" ContentType="image/svg+xml" />
	<Default Extension="png" ContentType="image/png" />
	<Default Extension="ico" ContentType="image/x-icon" />
	<Default Extension="tmLanguage.json" ContentType="application/json" />
	<Default Extension="jsonc" ContentType="application/json" />
</Types>`;
}

function vsixManifestXml(pkg) {
	const publisher = pkg.publisher || 'dardcor';
	const version = pkg.version || '1.0.0';
	const id = pkg.name || 'extension';
	const displayName = pkg.displayName || pkg.name || 'Extension';
	const description = pkg.description || '';
	const engines = pkg.engines && pkg.engines['dardcor-code'] ? pkg.engines['dardcor-code'] : '^1.0.0';
	return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema/2011">
	<Metadata>
		<Identity Language="en-US" Publisher="${escapeXml(publisher)}" Version="${escapeXml(version)}" Id="${escapeXml(id)}" />
		<DisplayName>${escapeXml(displayName)}</DisplayName>
		<Description xml:space="preserve">${escapeXml(description)}</Description>
		<Tags>${escapeXml((pkg.keywords || []).join(','))}</Tags>
	</Metadata>
	<Installation>
		<InstallationTarget Id="Microsoft.VisualStudio.Code" Version="${escapeXml(engines)}" />
	</Installation>
	<Dependencies />
	<Assets />
</PackageManifest>`;
}

function collectFiles(dir, prefix = '') {
	const entries = [];
	if (!fs.existsSync(dir)) return entries;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '.git') continue;
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			entries.push(...collectFiles(abs, rel));
		} else {
			entries.push({ name: rel, data: fs.readFileSync(abs) });
		}
	}
	return entries;
}

/**
 * Builds a VSIX from an extension directory.
 * @param {string} extensionDir
 * @param {string} outFile
 * @returns {{outFile: string, entries: number, size: number}}
 */
function buildVsix(extensionDir, outFile) {
	const pkgPath = path.join(extensionDir, 'package.json');
	if (!fs.existsSync(pkgPath)) {
		throw new Error(`extension dir has no package.json: ${extensionDir}`);
	}
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	const files = collectFiles(extensionDir).filter(f => f.name !== 'package.json');

	const zipEntries = [
		{ name: '[Content_Types].xml', data: contentTypesXml() },
		{ name: 'extension.vsixmanifest', data: vsixManifestXml(pkg) },
		{ name: 'extension/package.json', data: JSON.stringify(pkg, null, '\t') },
		...files.map(f => ({ name: `extension/${f.name}`, data: f.data })),
	];
	const zip = createZip(zipEntries);
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
	fs.writeFileSync(outFile, zip);
	return { outFile, entries: zipEntries.length, size: zip.length };
}

function parseArgs(argv) {
	return {
		extensionDir: argv[0] ? path.resolve(process.cwd(), argv[0]) : null,
		outFile: argv[1] ? path.resolve(process.cwd(), argv[1]) : null,
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.extensionDir) {
		console.error('[vsix-packager] usage: node vsix-packager.mjs <extension-dir> [out.vsix]');
		process.exit(1);
	}
	const pkg = JSON.parse(fs.readFileSync(path.join(args.extensionDir, 'package.json'), 'utf8'));
	const defaultOut = path.join(process.cwd(), `${pkg.name || 'extension'}-${pkg.version || '1.0.0'}.vsix`);
	const result = buildVsix(args.extensionDir, args.outFile || defaultOut);
	console.log(`[vsix-packager] ${result.entries} entries -> ${result.outFile} (${(result.size / 1024).toFixed(1)} KB)`);
}

export { createZip, crc32, buildVsix, vsixManifestXml, contentTypesXml };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[vsix-packager] fatal:', err);
		process.exit(1);
	});
}
