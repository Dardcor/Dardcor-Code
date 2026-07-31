/**
 * Dardcor Code - Unit Test Code Coverage Report Collector (Task 930)
 *
 * Parses lcov.info output (from `node --test --experimental-test-coverage`
 * or V8 coverage tooling), aggregates per-file and per-directory coverage,
 * and renders a text report, optional JSON, and applies a minimum
 * threshold gate (--threshold). Uses only node builtins.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_COVERAGE_DIR = path.join(ROOT, 'coverage');

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		dir: path.resolve(ROOT, opt('--dir', DEFAULT_COVERAGE_DIR)),
		threshold: Number(opt('--threshold', 0)),
		json: argv.includes('--json'),
		failUnder: argv.includes('--fail-under'),
	};
}

function parseLcov(file) {
	const content = fs.readFileSync(file, 'utf8');
	const records = [];
	let current = null;
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		const [key, ...rest] = line.split(':');
		const value = rest.join(':');
		if (key === 'TN') {
			if (current) records.push(current);
			current = { name: value, fn: { found: 0, hit: 0 }, branch: { found: 0, hit: 0 }, lines: {} };
		} else if (!current) {
			continue;
		} else if (key === 'SF') {
			current.file = value;
		} else if (key === 'FNF') current.fn.found = Number(value);
		else if (key === 'FNH') current.fn.hit = Number(value);
		else if (key === 'BRF') current.branch.found = Number(value);
		else if (key === 'BRH') current.branch.hit = Number(value);
		else if (key === 'DA') {
			const [lineNo, hits] = value.split(',');
			current.lines[Number(lineNo)] = Number(hits);
		} else if (key === 'LF') current.linesFound = Number(value);
		else if (key === 'LH') current.linesHit = Number(value);
	}
	if (current) records.push(current);
	return records;
}

function collectLcovFiles(dir) {
	if (!fs.existsSync(dir)) return [];
	const files = [];
	const walk = d => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			const abs = path.join(d, entry.name);
			if (entry.isDirectory()) walk(abs);
			else if (entry.name === 'lcov.info' || /\.lcov$/.test(entry.name)) files.push(abs);
		}
	};
	walk(dir);
	return files;
}

function computeStats(records) {
	let totalLines = 0;
	let totalHit = 0;
	let totalFn = 0;
	let totalFnHit = 0;
	const perFile = [];
	for (const rec of records) {
		const lineKeys = Object.keys(rec.lines);
		const lineTotal = lineKeys.length;
		const lineHit = lineKeys.filter(k => rec.lines[k] > 0).length;
		totalLines += lineTotal;
		totalHit += lineHit;
		totalFn += rec.fn.found;
		totalFnHit += rec.fn.hit;
		perFile.push({
			file: rec.file || rec.name || '(unknown)',
			linesTotal: lineTotal,
			linesHit: lineHit,
			functions: rec.fn.found,
			functionsHit: rec.fn.hit,
			linePercent: lineTotal === 0 ? 100 : (lineHit / lineTotal) * 100,
		});
	}
	perFile.sort((a, b) => a.linePercent - b.linePercent);
	return {
		perFile,
		summary: {
			linesTotal: totalLines,
			linesHit: totalHit,
			linePercent: totalLines === 0 ? 0 : (totalHit / totalLines) * 100,
			functionsTotal: totalFn,
			functionsHit: totalFnHit,
			functionsPercent: totalFn === 0 ? 0 : (totalFnHit / totalFn) * 100,
		},
	};
}

function renderText(stats) {
	const { summary, perFile } = stats;
	const lines = [];
	lines.push('Dardcor Code - Coverage Report');
	lines.push('='.repeat(60));
	lines.push(`Lines:      ${summary.linesHit}/${summary.linesTotal} (${summary.linePercent.toFixed(2)}%)`);
	lines.push(`Functions:  ${summary.functionsHit}/${summary.functionsTotal} (${summary.functionsPercent.toFixed(2)}%)`);
	lines.push('');
	lines.push('Files with lowest coverage:');
	for (const f of perFile.slice(0, 10)) {
		lines.push(`  ${f.linePercent.toFixed(1).padStart(6)}%  ${f.file}`);
	}
	return lines.join('\n');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const lcovFiles = collectLcovFiles(args.dir);
	if (lcovFiles.length === 0) {
		console.warn(`[coverage-reporter] no lcov files in ${args.dir}`);
		process.exit(0);
	}
	const records = lcovFiles.flatMap(f => parseLcov(f));
	const stats = computeStats(records);

	if (args.json) {
		console.log(JSON.stringify({ source: lcovFiles, ...stats }, null, '\t'));
	} else {
		console.log(renderText(stats));
		console.log(`\n[coverage-reporter] aggregated ${lcovFiles.length} lcov file(s)`);
	}

	const below = stats.summary.linePercent < args.threshold;
	if (args.threshold > 0) {
		console.log(`[coverage-reporter] threshold: ${args.threshold}% (actual ${stats.summary.linePercent.toFixed(2)}%) -> ${below ? 'FAIL' : 'PASS'}`);
	}
	process.exit(below ? 1 : 0);
}

export { parseLcov, computeStats, collectLcovFiles, renderText };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[coverage-reporter] fatal:', err);
		process.exit(1);
	});
}
