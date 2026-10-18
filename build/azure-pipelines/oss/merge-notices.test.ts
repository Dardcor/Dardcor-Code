/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { computeUnaccounted } from './merge-notices.js';

interface NoticeEntry {
	name: string;
	version: string;
	license: string;
	url: string;
	licenseText: string;
}

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean): void {
	if (cond) {
		passed++;
		console.log(`  ok   ${name}`);
	} else {
		failed++;
		console.error(`  FAIL ${name}`);
	}
}

function entry(name: string, version: string, licenseText: string): NoticeEntry {
	return { name, version, license: 'MIT', url: '', licenseText };
}

function mapOf(...entries: NoticeEntry[]): Map<string, NoticeEntry> {
	const m = new Map<string, NoticeEntry>();
	for (const e of entries) {
		m.set(`${e.name.toLowerCase()}@${e.version || ''}`, e);
	}
	return m;
}

console.log('computeUnaccounted -- genuinely absent:');
{
	const merged = mapOf(entry('present-pkg', '1.0.0', 'Real license text'));
	const unresolved = [{ name: 'ghost-pkg', version: '2.0.0', reason: 'cargo-no-license-resolved' }];
	const out = computeUnaccounted(merged, unresolved);
	check('absent unresolved pkg is listed', out.some(u => u.name === 'ghost-pkg' && u.reason === 'cargo-no-license-resolved'));
	check('present pkg with text is NOT listed', !out.some(u => u.name === 'present-pkg'));
	check('exactly one unaccounted', out.length === 1);
}

console.log('computeUnaccounted -- downstream-rescued (linux-keyutils case):');
{
	const merged = mapOf(entry('linux-keyutils', '0.2.5', 'BSD-3-Clause text'));
	const unresolved = [{ name: 'linux-keyutils', version: '0.2.4', reason: 'cargo-no-license-resolved' }];
	const out = computeUnaccounted(merged, unresolved);
	check('rescued pkg (version drift) is excluded', !out.some(u => u.name === 'linux-keyutils'));
	check('nothing unaccounted', out.length === 0);
}
{
	const merged = mapOf(entry('linux-keyutils', '0.2.4', 'BSD-3-Clause text'));
	const unresolved = [{ name: 'linux-keyutils', version: '0.2.4', reason: 'cargo-no-license-resolved' }];
	const out = computeUnaccounted(merged, unresolved);
	check('rescued pkg (same version) is excluded', out.length === 0);
}

console.log('computeUnaccounted -- empty license body:');
{
	const merged = mapOf(
		entry('blank-pkg', '1.0.0', '   \n\t  '),
		entry('good-pkg', '1.0.0', 'Real text'),
	);
	const out = computeUnaccounted(merged, []);
	check('empty-body entry listed as no-license-text', out.some(u => u.name === 'blank-pkg' && u.reason === 'no-license-text'));
	check('real-text entry excluded', !out.some(u => u.name === 'good-pkg'));
	check('exactly one unaccounted', out.length === 1);
}

console.log('computeUnaccounted -- dedupe across sources:');
{
	const merged = mapOf(entry('dup-pkg', '3.1.4', ''));
	const unresolved = [{ name: 'dup-pkg', version: '3.1.4', reason: 'cargo-api-failed' }];
	const out = computeUnaccounted(merged, unresolved);
	check('single deduped row for dup-pkg', out.filter(u => u.name === 'dup-pkg').length === 1);
}
{
	const merged = new Map<string, NoticeEntry>();
	const unresolved = [
		{ name: 'twice', version: '1.0.0', reason: 'cargo-api-failed' },
		{ name: 'Twice', version: '1.0.0', reason: 'cargo-no-repo-url' },
	];
	const out = computeUnaccounted(merged, unresolved);
	check('case-insensitive dedupe to one row', out.filter(u => u.name.toLowerCase() === 'twice').length === 1);
}

console.log('computeUnaccounted -- sorted by name then version:');
{
	const merged = new Map<string, NoticeEntry>();
	const unresolved = [
		{ name: 'zeta', version: '1.0.0', reason: 'r' },
		{ name: 'alpha', version: '2.0.0', reason: 'r' },
		{ name: 'alpha', version: '1.0.0', reason: 'r' },
	];
	const out = computeUnaccounted(merged, unresolved);
	check('first is alpha@1.0.0', out[0].name === 'alpha' && out[0].version === '1.0.0');
	check('second is alpha@2.0.0', out[1].name === 'alpha' && out[1].version === '2.0.0');
	check('last is zeta', out[2].name === 'zeta');
}

console.log('');
console.log(`merge-notices computeUnaccounted unit checks: ${passed} passed, ${failed} failed`);
if (failed > 0) {
	process.exit(1);
}
