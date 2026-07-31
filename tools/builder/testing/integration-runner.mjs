/**
 * Dardcor Code - Integration Test Suite Execution Script (Task 910)
 *
 * Runs the project's integration suites grouped by module area (core,
 * services, engine, app-shell, modules). Each group is executed
 * sequentially with an isolated summary; the process exits non-zero when
 * any group fails. Reuses the unit-runner discovery/execution logic.
 */

import path from 'node:path';
import { discoverSuiteFiles, runSuiteFile, summarize } from './unit-runner.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const SRC_DIR = path.join(ROOT, 'src', 'dc');

const GROUPS = [
	{ name: 'core', dir: path.join(SRC_DIR, 'core') },
	{ name: 'services', dir: path.join(SRC_DIR, 'services') },
	{ name: 'engine', dir: path.join(SRC_DIR, 'engine') },
	{ name: 'app-shell', dir: path.join(SRC_DIR, 'app-shell') },
	{ name: 'modules', dir: path.join(SRC_DIR, 'modules') },
];

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		only: opt('--only', null),
		json: argv.includes('--json'),
		skipBuild: argv.includes('--skip-build'),
	};
}

function ensureCompiled() {
	// Importing unit-runner's compile path indirectly: suites require dist.
	// Compile is performed by unit-runner's CLI only; here we verify dist exists.
	return import('./unit-runner.mjs');
}

async function runGroup(group, args) {
	const files = discoverSuiteFiles(group.dir, '**/*-suite.ts');
	const results = [];
	for (const file of files) {
		try {
			const result = await runSuiteFile(file);
			results.push(result);
		} catch (err) {
			results.push({ file, error: err.message });
		}
	}
	const summary = summarize(results);
	return { group: group.name, files: results, summary };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	await ensureCompiled();
	const groups = GROUPS.filter(g => !args.only || g.name === args.only);
	const groupReports = [];
	for (const group of groups) {
		console.log(`\n[integration-runner] group: ${group.name}`);
		const report = await runGroup(group, args);
		groupReports.push(report);
		for (const file of report.files) {
			const rel = path.relative(ROOT, file.file);
			if (file.error) {
				console.error(`  - [ERROR] ${rel}: ${file.error}`);
				continue;
			}
			for (const r of file.results) {
				const mark = r.passed ? 'PASS' : 'FAIL';
				console.log(`  - [${mark}] ${r.name}${r.message ? ` (${r.message})` : ''}`);
			}
		}
		console.log(`  => ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.errors} errors`);
	}

	const totals = groupReports.reduce(
		(acc, r) => ({ passed: acc.passed + r.summary.passed, failed: acc.failed + r.summary.failed, errors: acc.errors + r.summary.errors }),
		{ passed: 0, failed: 0, errors: 0 }
	);

	if (args.json) {
		console.log('\n' + JSON.stringify({ groups: groupReports, totals }, null, '\t'));
	} else {
		console.log(`\n[integration-runner] TOTAL: ${totals.passed} passed, ${totals.failed} failed, ${totals.errors} errors across ${groupReports.length} groups`);
	}
	process.exit(totals.failed + totals.errors > 0 ? 1 : 0);
}

export { GROUPS, runGroup };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[integration-runner] fatal:', err);
		process.exit(1);
	});
}
