/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import fs from 'fs';

export interface NoticeEntry {
	name: string;
	version: string;
	license: string;
	licenseTextLength: number;
	lineNumber: number;
	licenseText?: string;
}

const LICENSE_PROSE_STARTS = /^(copyright|license|licen[cs]e|permission|the |this |all |end |terms|conditions|disclaimer|granted|redistribution|neither|no |software|unless|provided|except|in |of |for |under |above|note|#|\*|\(|\d+[\.\)]\s)/i;

export function isPackageHeader(line: string): boolean {
	if (LICENSE_PROSE_STARTS.test(line)) {
		return false;
	}

	const firstWord = line.split(/\s/)[0];
	if (!firstWord) {
		return false;
	}

	const npmNameRe = /^@?[a-z0-9][a-z0-9\-\./@_]*$/;
	const gitRepoRe = /^[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-\.]+$/;

	if (npmNameRe.test(firstWord) || gitRepoRe.test(firstWord)) {
		return true;
	}

	if (/^.+?\s+[\d][^\s]*\s+-\s+.+$/.test(line)) {
		return true;
	}

	return false;
}

export function parseNoticeFile(filePath: string): NoticeEntry[] {
	const content = fs.readFileSync(filePath, 'utf8');
	const lines = content.split('\n');
	const entries: NoticeEntry[] = [];
	const sepRe = /^-{50,}$/;

	for (let i = 0; i < lines.length; i++) {
		if (!sepRe.test(lines[i].trim())) {
			continue;
		}

		let headerLine = '';
		let headerIdx = -1;
		for (let j = i + 1; j < lines.length; j++) {
			if (lines[j].trim()) {
				headerLine = lines[j].trim();
				headerIdx = j;
				break;
			}
		}

		if (!headerLine || headerIdx === -1) {
			continue;
		}

		if (headerLine.startsWith('NOTICES AND INFORMATION') || headerLine.startsWith('Do Not Translate')) {
			continue;
		}

		if (sepRe.test(headerLine)) {
			continue;
		}

		if (!isPackageHeader(headerLine)) {
			continue;
		}

		const match = headerLine.match(/^(.+?)\s+([\d][^\s]*)\s+-\s+(.+)$/);
		let name: string, version: string, license: string;
		if (match) {
			name = match[1];
			version = match[2];
			license = match[3];
		} else {
			const match2 = headerLine.match(/^(.+?)\s+-\s+(.+)$/);
			if (match2) {
				name = match2[1];
				version = '';
				license = match2[2];
			} else {
				name = headerLine;
				version = '';
				license = '';
			}
		}

		let textLength = 0;
		const bodyLines: string[] = [];
		for (let j = headerIdx + 1; j < lines.length; j++) {
			if (sepRe.test(lines[j].trim())) {
				break;
			}
			textLength += lines[j].length + 1;
			bodyLines.push(lines[j]);
		}

		while (bodyLines.length > 0 && !bodyLines[0].trim()) {
			bodyLines.shift();
		}
		if (bodyLines.length > 0) {
			const first = bodyLines[0].trim();
			if (first.startsWith('http://') || first.startsWith('https://')) {
				bodyLines.shift();
			}
		}
		const licenseText = bodyLines.join('\n').trim();

		entries.push({
			name,
			version,
			license,
			licenseTextLength: textLength,
			lineNumber: headerIdx + 1,
			licenseText,
		});
	}

	return entries;
}

function listMode(filePath: string): void {
	const entries = parseNoticeFile(filePath);
	const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);

	console.log(`File: ${filePath}`);
	console.log(`Size: ${sizeMB} MB`);
	console.log(`Total entries: ${entries.length}`);
	console.log(`Unique names: ${new Set(entries.map(e => e.name.toLowerCase())).size}`);
	console.log('');
	console.log('Line | Name | Version | License | Text Length');
	console.log('---- | ---- | ------- | ------- | -----------');

	for (const e of entries) {
		console.log(`${e.lineNumber} | ${e.name} | ${e.version} | ${e.license} | ${e.licenseTextLength}`);
	}
}

function diffMode(pathA: string, pathB: string): void {
	const entriesA = parseNoticeFile(pathA);
	const entriesB = parseNoticeFile(pathB);

	const namesA = new Map<string, NoticeEntry[]>();
	for (const e of entriesA) {
		const key = e.name.toLowerCase();
		if (!namesA.has(key)) {
			namesA.set(key, []);
		}
		namesA.get(key)!.push(e);
	}

	const namesB = new Map<string, NoticeEntry[]>();
	for (const e of entriesB) {
		const key = e.name.toLowerCase();
		if (!namesB.has(key)) {
			namesB.set(key, []);
		}
		namesB.get(key)!.push(e);
	}

	const onlyA: NoticeEntry[] = [];
	const onlyB: NoticeEntry[] = [];
	const inBoth: string[] = [];

	for (const [name, entries] of namesA) {
		if (namesB.has(name)) {
			inBoth.push(name);
		} else {
			onlyA.push(...entries);
		}
	}

	for (const [name, entries] of namesB) {
		if (!namesA.has(name)) {
			onlyB.push(...entries);
		}
	}

	const sizeA = (fs.statSync(pathA).size / 1024 / 1024).toFixed(2);
	const sizeB = (fs.statSync(pathB).size / 1024 / 1024).toFixed(2);

	console.log('=== NOTICE File Comparison ===');
	console.log('');
	console.log(`File A: ${pathA}`);
	console.log(`  Size: ${sizeA} MB, Entries: ${entriesA.length}, Unique names: ${namesA.size}`);
	console.log('');
	console.log(`File B: ${pathB}`);
	console.log(`  Size: ${sizeB} MB, Entries: ${entriesB.length}, Unique names: ${namesB.size}`);
	console.log('');
	console.log(`In both: ${inBoth.length}`);
	console.log(`Only in A: ${onlyA.length} (${namesA.size - inBoth.length} unique names)`);
	console.log(`Only in B: ${onlyB.length} (${namesB.size - inBoth.length} unique names)`);

	if (onlyA.length > 0) {
		console.log('');
		console.log(`=== Only in A (${onlyA.length} entries) ===`);
		console.log('Line | Name | Version | License');
		console.log('---- | ---- | ------- | -------');
		for (const e of onlyA.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
			console.log(`${e.lineNumber} | ${e.name} | ${e.version} | ${e.license}`);
		}
	}

	if (onlyB.length > 0) {
		console.log('');
		console.log(`=== Only in B (${onlyB.length} entries) ===`);
		console.log('Line | Name | Version | License');
		console.log('---- | ---- | ------- | -------');
		for (const e of onlyB.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
			console.log(`${e.lineNumber} | ${e.name} | ${e.version} | ${e.license}`);
		}
	}

	const versionDiffs: string[] = [];
	for (const name of inBoth) {
		const aVersions = new Set(namesA.get(name)!.map(e => e.version).filter(v => v));
		const bVersions = new Set(namesB.get(name)!.map(e => e.version).filter(v => v));
		const aOnly = [...aVersions].filter(v => !bVersions.has(v));
		const bOnly = [...bVersions].filter(v => !aVersions.has(v));
		if (aOnly.length > 0 || bOnly.length > 0) {
			versionDiffs.push(`${name}: A has [${aOnly.join(', ')}], B has [${bOnly.join(', ')}]`);
		}
	}

	if (versionDiffs.length > 0) {
		console.log('');
		console.log(`=== Version differences (${versionDiffs.length} packages) ===`);
		for (const d of versionDiffs) {
			console.log(`  ${d}`);
		}
	}
}


if (/parse-notices(\.[jt]s)?$/.test(process.argv[1] || '')) {
	const args = process.argv.slice(2);

	if (args[0] === '--file' && args[1]) {
		listMode(args[1]);
	} else if (args[0] === '--diff' && args[1] && args[2]) {
		diffMode(args[1], args[2]);
	} else {
		console.log('Usage:');
		console.log('  node parse-notices.js --file <path>           List all packages in a NOTICE file');
		console.log('  node parse-notices.js --diff <pathA> <pathB>  Compare two NOTICE files');
		process.exit(1);
	}
}
