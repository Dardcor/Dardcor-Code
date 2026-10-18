/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import fs from 'fs';
import { applyOverrides, readCglicenses } from './apply-overrides.js';
import { isPackageHeader } from './parse-notices.js';
import { parseArgs } from './utils.js';

interface NoticeEntry {
	name: string;
	version: string;
	license: string;
	url: string;
	licenseText: string;
}

const SEPARATOR = '---------------------------------------------------------';
const SEPARATOR_REGEX = /^-{50,}$/m;

function parseNoticeFile(filePath: string): NoticeEntry[] {
	if (!fs.existsSync(filePath)) {
		return [];
	}
	const content = fs.readFileSync(filePath, 'utf8');
	const entries: NoticeEntry[] = [];
	const blocks = content.split(SEPARATOR_REGEX);

	for (let i = 1; i < blocks.length; i++) {
		const block = blocks[i].trim();
		if (!block) {
			continue;
		}

		const lines = block.split('\n');
		let headerLine = '';
		let headerIdx = 0;
		for (let j = 0; j < lines.length; j++) {
			if (lines[j].trim()) {
				headerLine = lines[j].trim();
				headerIdx = j;
				break;
			}
		}

		if (!headerLine || SEPARATOR_REGEX.test(headerLine)) {
			continue;
		}

		if (headerLine.startsWith('NOTICES AND INFORMATION') || headerLine.startsWith('Do Not Translate')) {
			continue;
		}

		if (!isPackageHeader(headerLine)) {
			continue;
		}

		const match = headerLine.match(/^(.+?)\s+([\d][^\s]*)\s+-\s+(.+)$/);
		let name: string, version: string, license: string;
		let url = '';

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

		const remainingLines = lines.slice(headerIdx + 1);
		let licenseStartIdx = 0;
		for (let j = 0; j < remainingLines.length; j++) {
			const line = remainingLines[j].trim();
			if (!line) {
				continue;
			}
			if (line.startsWith('http://') || line.startsWith('https://')) {
				url = line;
				licenseStartIdx = j + 1;
			} else {
				licenseStartIdx = j;
			}
			break;
		}

		const licenseText = remainingLines.slice(licenseStartIdx).join('\n').trim();
		entries.push({ name, version, license, url, licenseText });
	}

	return entries;
}

/**
 * Compute the packages NOT accounted for in the final merged NOTICE. A package
 * is "unaccounted" if EITHER:
 *   (a) the scanner tried to resolve it but created no row (it appears in the
 *       `unresolved` sibling) AND its name is absent from the final merged map
 *       (name-only match avoids version-drift false positives, and correctly
 *       excludes packages rescued downstream via a cglicenses.json override), OR
 *   (b) it IS a row in the final notice but its license body is empty/whitespace.
 *
 * Pure and exported for unit testing. Informational only — never affects exit code.
 */
export function computeUnaccounted(
	merged: Map<string, NoticeEntry>,
	unresolved: Array<{ name: string; version: string; reason: string }>
): Array<{ name: string; version: string; reason: string }> {
	const presentNamesLower = new Set([...merged.values()].map(e => e.name.toLowerCase()));
	const out: Array<{ name: string; version: string; reason: string }> = [];

	for (const item of unresolved) {
		if (!presentNamesLower.has(item.name.toLowerCase())) {
			out.push({ name: item.name, version: item.version, reason: item.reason });
		}
	}

	for (const entry of merged.values()) {
		if (!entry.licenseText || entry.licenseText.trim() === '') {
			out.push({ name: entry.name, version: entry.version, reason: 'no-license-text' });
		}
	}

	const seen = new Set<string>();
	const deduped: Array<{ name: string; version: string; reason: string }> = [];
	for (const u of out) {
		const key = `${u.name.toLowerCase()}@${u.version || ''}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(u);
	}

	deduped.sort((a, b) => {
		const an = a.name.toLowerCase();
		const bn = b.name.toLowerCase();
		if (an !== bn) {
			return an.localeCompare(bn);
		}
		return (a.version || '').localeCompare(b.version || '');
	});

	return deduped;
}

async function mainAsync(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const cgPath = args['cg'] || '';
	const extPath = args['extensions'] || '';
	const outputPath = args['output'];
	const cglicensesPath = args['cglicenses'] || '';
	const strict = process.argv.includes('--strict');
	const provenance = args['provenance'] !== undefined;

	if (!outputPath) {
		console.error('Usage: merge-notices.js --cg <path> --extensions <path> --output <path> [--cglicenses <path>] [--strict]');
		process.exit(1);
	}

	const cgEntries = cgPath ? parseNoticeFile(cgPath) : [];
	const extEntries = extPath ? parseNoticeFile(extPath) : [];

	console.log('=== Merge Step: CG + Extension Licenses ===');
	console.log('');
	console.log(`CG input: ${cgPath || '(none)'}`);
	console.log(`  Entries parsed: ${cgEntries.length}`);
	console.log(`Extension input: ${extPath || '(none)'}`);
	console.log(`  Entries parsed: ${extEntries.length}`);
	console.log('');

	const merged = new Map<string, NoticeEntry & { source: string }>();
	const mergeKey = (e: NoticeEntry) => `${e.name.toLowerCase()}@${e.version || ''}`;

	for (const entry of cgEntries) {
		const key = mergeKey(entry);
		if (!merged.has(key)) {
			merged.set(key, { ...entry, source: 'component-governance' });
		}
	}

	const cgCount = merged.size;

	const stubOverrideKeys = new Set<string>();
	const stubOverridePath = args['stuboverride'] || (extPath ? extPath + '.stuboverride.json' : '');
	if (stubOverridePath && fs.existsSync(stubOverridePath)) {
		try {
			const raw: unknown = JSON.parse(fs.readFileSync(stubOverridePath, 'utf8'));
			if (Array.isArray(raw)) {
				for (const k of raw) {
					if (typeof k === 'string') {
						stubOverrideKeys.add(k.toLowerCase());
					}
				}
			}
			console.log(`Stub-override index: ${stubOverrideKeys.size} cargo entries override CG (${stubOverridePath})`);
			console.log('');
		} catch (err) {
			console.warn(`  WARN: could not read stub-override index ${stubOverridePath}: ${(err as Error).message}`);
		}
	}

	let extAdded = 0;
	let extSkipped = 0;
	let extStubOverridden = 0;
	const extAddedNames: string[] = [];
	const extSkippedNames: string[] = [];
	const collidedOverrideKeys = new Set<string>();

	for (const entry of extEntries) {
		const key = mergeKey(entry);
		if (merged.has(key)) {
			if (stubOverrideKeys.has(key)) {
				merged.set(key, { ...entry, source: 'cargo-stub-override' });
				extStubOverridden++;
				collidedOverrideKeys.add(key);
				extAddedNames.push(`${entry.name} ${entry.version} - ${entry.license} (stub-override)`);
			} else {
				extSkipped++;
				extSkippedNames.push(`${entry.name}@${entry.version || '(no version)'}`);
			}
		} else {
			merged.set(key, { ...entry, source: 'extension-scanner' });
			extAdded++;
			extAddedNames.push(`${entry.name} ${entry.version} - ${entry.license}`);
		}
	}

	const uncollidedOverrideKeys = [...stubOverrideKeys].filter(k => !collidedOverrideKeys.has(k)).sort();
	if (uncollidedOverrideKeys.length > 0) {
		console.warn(`  WARN: ${uncollidedOverrideKeys.length} stub-override key(s) never collided with a CG entry -- CG's stub may survive at a different version. Verify these crates' notice text:`);
		for (const k of uncollidedOverrideKeys) {
			console.warn(`    - ${k}`);
		}
		console.log('');
	}

	console.log(`--- Component Governance provided ${cgCount} packages ---`);
	console.log('  (Source: ClearlyDefined license database via notice@0 task)');
	console.log('');
	console.log(`--- Extension scanner added ${extAdded} packages ---`);
	console.log('  (Source: LICENSE files read from extensions/*/node_modules/)');
	console.log('  (Why: CG skips packages with engines.vscode, which includes all built-in extensions)');
	console.log('');

	if (extAddedNames.length > 0) {
		console.log('  Packages added from extension scanner:');
		for (const n of extAddedNames.sort()) {
			console.log(`    + ${n}`);
		}
		console.log('');
	}

	if (extSkippedNames.length > 0) {
		console.log(`  ${extSkipped} extension packages already covered by CG (skipped):`);
		for (const n of extSkippedNames.sort()) {
			console.log(`    = ${n}`);
		}
		console.log('');
	}

	let overridesApplied = 0;
	let overridesInjected = 0;
	let overrideEntryCount = 0;
	const unmatchedOverrides: string[] = [];
	const staleOverrides: string[] = [];
	if (cglicensesPath) {
		if (!fs.existsSync(cglicensesPath)) {
			console.warn(`WARN: --cglicenses path not found: ${cglicensesPath}`);
		} else {
			try {
				const overrides = readCglicenses(cglicensesPath);
				console.log(`--- Applying ${overrides.length} cglicenses.json overrides ---`);

				const presencePath = args['presence'] || (extPath ? extPath + '.presence.json' : '');
				const presentNames = new Set<string>();
				if (presencePath && fs.existsSync(presencePath)) {
					try {
						const raw: unknown = JSON.parse(fs.readFileSync(presencePath, 'utf8'));
						if (Array.isArray(raw)) {
							for (const item of raw as { name?: string }[]) {
								if (item && typeof item.name === 'string') {
									presentNames.add(item.name.toLowerCase());
								}
							}
						}
						console.log(`  Presence index: ${presentNames.size} present-but-unlicensed packages (${presencePath})`);
					} catch (err) {
						console.warn(`  WARN: could not read presence index ${presencePath}: ${(err as Error).message}`);
					}
				} else {
					console.warn(`  WARN: no presence index found (${presencePath || 'none'}); stale overrides cannot be detected, so unmatched overrides with usable text will be injected.`);
				}

				const result = await applyOverrides(merged, overrides, { fetchUris: true, presentNames });
				overridesApplied = result.appliedNames.length;
				overridesInjected = result.injectedNames.length;
				overrideEntryCount = result.appliedEntryCount;
				unmatchedOverrides.push(...result.unmatchedNames);
				staleOverrides.push(...result.staleNames);
				for (const name of result.appliedNames.sort()) {
					console.log(`    * edited: ${name}`);
				}
				for (const name of result.injectedNames.sort()) {
					console.log(`    + injected: ${name}`);
				}
				for (const err of result.errors) {
					console.error(`    ! ${err}`);
				}
				if (result.staleNames.length > 0) {
					console.warn(`  ${result.staleNames.length} override(s) reference a package not present in THIS build. A package can be absent because it is platform-specific (it only ships on other OS/arch builds) OR because the override is genuinely stale. Verify across platforms before removing anything from cglicenses.json:`);
					const platformToken = /(darwin|win32|linux|linuxmusl|alpine|freebsd|android|arm64|x64|ia32|armhf|ppc64|s390x|musl)/i;
					for (const name of result.staleNames.sort()) {
						const hint = platformToken.test(name)
							? ' (likely platform-specific -- do NOT delete based on a single-platform build)'
							: '';
						console.warn(`    ? stale: ${name}${hint}`);
					}
				}
				if (result.unmatchedNames.length > 0) {
					console.warn(`  ${result.unmatchedNames.length} override(s) have no matching package and no usable license text:`);
					for (const name of result.unmatchedNames.sort()) {
						console.warn(`    ? unmatched: ${name}`);
					}
				}
				if (strict && (result.errors.length > 0 || result.unmatchedNames.length > 0)) {
					console.error('--strict: failing build due to override errors or unmatched entries');
					process.exit(2);
				}
				console.log('');
			} catch (err) {
				console.error(`ERROR reading cglicenses overrides from ${cglicensesPath}: ${(err as Error).message}`);
				if (strict) {
					process.exit(2);
				}
			}
		}
	}

	const sorted = [...merged.values()].sort((a, b) =>
		a.name.toLowerCase().localeCompare(b.name.toLowerCase())
	);

	const header = `NOTICES AND INFORMATION
Do Not Translate or Localize

This software incorporates material from third parties.
Microsoft makes certain open source code available at https://3rdpartysource.microsoft.com,
or you may send a check or money order for US $5.00, including the product name,
the open source component name, platform, and version number, to:

Source Code Compliance Team
Dardcor Corporation
One Microsoft Way
Redmond, WA 98052
USA

Notwithstanding any other terms, you may reverse engineer this software to the extent
required to debug changes to any libraries licensed under the GNU Lesser General Public License.`;

	let output = header + '\n\n';

	for (const entry of sorted) {
		output += '\n' + SEPARATOR + '\n\n';
		output += entry.name;
		if (entry.version) {
			output += ' ' + entry.version;
		}
		if (entry.license) {
			output += ' - ' + entry.license;
		}
		output += '\n';
		if (entry.url) {
			output += entry.url + '\n';
		}
		if (provenance) {
			if (entry.source === 'extension-scanner') {
				output += '(license text obtained directly from package LICENSE file)\n';
			} else if (entry.source === 'cargo-stub-override') {
				output += '(license text fetched from the crate repository -- replaces CG SPDX-expression stub)\n';
			} else if (entry.source === 'cglicenses-override') {
				output += '(license text supplied by cglicenses.json manual override)\n';
			}
		}
		output += '\n';
		if (entry.licenseText) {
			output += entry.licenseText + '\n';
		}
	}

	output += '\n' + SEPARATOR + '\n';

	try {
		fs.writeFileSync(outputPath, output, 'utf8');
	} catch (err) {
		console.error(`ERROR: Failed to write output file ${outputPath}: ${(err as Error).message}`);
		process.exit(1);
	}

	const sizeMB = (output.length / 1024 / 1024).toFixed(2);

	const extScannerFound = extAdded + extStubOverridden + extSkipped;
	const totalFound = cgCount + extScannerFound + overridesInjected;
	const totalFolded = extSkipped + extStubOverridden;
	const totalIncluded = sorted.length;

	const unresolvedPath = args['unresolved'] || (extPath ? extPath + '.unresolved.json' : '');
	let unresolvedList: Array<{ name: string; version: string; reason: string }> = [];
	if (unresolvedPath && fs.existsSync(unresolvedPath)) {
		try {
			const raw: unknown = JSON.parse(fs.readFileSync(unresolvedPath, 'utf8'));
			if (Array.isArray(raw)) {
				unresolvedList = (raw as Array<{ name?: unknown; version?: unknown; reason?: unknown }>)
					.filter(item => item && typeof item.name === 'string')
					.map(item => ({
						name: item.name as string,
						version: typeof item.version === 'string' ? item.version : '',
						reason: typeof item.reason === 'string' ? item.reason : 'unresolved',
					}));
			}
		} catch (err) {
			console.warn(`  WARN: could not read unresolved index ${unresolvedPath}: ${(err as Error).message}`);
		}
	}

	console.log('=== Merge Summary ===');
	console.log('');
	console.log('  Packages found (gross, across all sources):');
	console.log(`    Component Governance:                 ${cgCount}`);
	console.log(`    Extension scanner:                    ${extScannerFound}  (${extAdded} new, ${extSkipped} already in CG, ${extStubOverridden} stub-overrides)`);
	if (cglicensesPath) {
		console.log(`    cglicenses.json injected:             ${overridesInjected}  (present-but-unlicensed, added by override)`);
	}
	console.log(`    Total packages found:                 ${totalFound}`);
	console.log('');
	console.log('  Folded during merge (scanner hit a package CG already had -- no new row):');
	console.log(`    Duplicates skipped (CG text kept):    ${extSkipped}`);
	console.log(`    Stub-overrides (CG text replaced):    ${extStubOverridden}`);
	console.log(`    Total folded:                         ${totalFolded}`);
	console.log('');
	if (cglicensesPath) {
		console.log('  Edited in place (count-neutral):');
		console.log(`    cglicenses overrides applied:         ${overridesApplied}  (${overrideEntryCount} entries updated)`);
		console.log(`    cglicenses overrides stale (skipped): ${staleOverrides.length}  (warn-only)`);
		console.log(`    cglicenses overrides unmatched:       ${unmatchedOverrides.length}  (no usable text)`);
		console.log('');
	}
	console.log(`  Total packages included in shipping ThirdPartyNotices: ${totalIncluded}`);
	console.log(`    (${totalFound} found - ${totalFolded} folded = ${totalIncluded})`);

	const unaccounted = computeUnaccounted(merged, unresolvedList);
	console.log('');
	if (unaccounted.length > 0) {
		console.warn(`  Packages NOT accounted for in the final NOTICE: ${unaccounted.length}`);
		console.warn('  (genuinely absent, or present with an empty license body -- need a cglicenses.json override or upstream fix)');
		for (const u of unaccounted) {
			console.warn(`    ! ${u.name}@${u.version || '(no version)'} -- ${u.reason}`);
		}
	} else {
		console.log(`  Packages NOT accounted for in the final NOTICE: ${unaccounted.length}`);
	}

	if (totalFound - totalFolded !== totalIncluded) {
		console.warn(`  WARN: merge accounting mismatch -- found(${totalFound}) - folded(${totalFolded}) = ${totalFound - totalFolded}, but the final NOTICE has ${totalIncluded} packages. A source or override path is uncounted.`);
	}

	console.log('');
	console.log(`  Output: ${outputPath} (${sizeMB} MB)`);
}

// or another module imports the exported helpers (mirrors scan-licenses.ts).
if (/merge-notices(\.[jt]s)?$/.test(process.argv[1] || '')) {
	mainAsync().catch(err => { console.error(err); process.exit(1); });
}
