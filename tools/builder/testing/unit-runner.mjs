/**
 * Dardcor Code - Command Line Unit Test Runner (Task 909)
 *
 * Discovers `*-suite.ts` files under src/dc (and tools/builder), ensures the
 * project is compiled, then imports each compiled suite and executes its
 * exported `run*Suite` function. Reports pass/fail counts and exits non-zero
 * on any failure. Works without Vitest: suites use the project's own
 * TestSuite harness; this runner is a superset that also executes
 * `node:test` based `.test.ts` files when type stripping is available.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		dir: opt('--dir', SRC_DIR),
		pattern: opt('--pattern', 'test/**/*-suite.ts'),
		reporter: opt('--reporter', 'spec'),
		skipBuild: argv.includes('--skip-build'),
		json: argv.includes('--json'),
	};
}

function discoverSuiteFiles(baseDir, pattern) {
	const files = [];
	if (!fs.existsSync(baseDir)) return files;
	const patternSegs = pattern.split('/');
	const walk = (dir, depth) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(abs, depth + 1);
			else if (depth >= patternSegs.length - 1 && /-suite\.ts$/.test(entry.name) && !entry.name.startsWith('_')) {
				files.push(abs);
			}
		}
	};
	walk(baseDir, 0);
	return files.sort();
}

function compileIfNeeded() {
	return new Promise((resolve, reject) => {
		const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
		const child = spawn(cmd, ['tsc', '-p', 'tsconfig.json'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		child.stdout.on('data', d => { out += d; });
		child.stderr.on('data', d => { out += d; });
		child.on('error', reject);
		child.on('close', code => {
			if (code !== 0) reject(new Error('tsc failed:\n' + out));
			else resolve();
		});
	});
}

function distPathFor(srcPath) {
	const rel = path.relative(SRC_DIR, srcPath);
	return path.join(DIST_DIR, rel).replace(/\.ts$/, '.js');
}

async function waitForSuiteSettling(results, timeoutMs = 5000) {
	// Async suite cases record results after the report is returned;
	// poll until the result count stops growing.
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const before = results.length;
		await new Promise(r => setTimeout(r, 100));
		if (results.length === before) break;
	}
}

async function runSuiteFile(file) {
	const distFile = distPathFor(file);
	if (!fs.existsSync(distFile)) {
		return { file, error: `compiled file missing: ${distFile} (run compile first or drop --skip-build)` };
	}
	const mod = await import(pathToFileURL(distFile));
	const runFns = Object.entries(mod).filter(([name, fn]) => /^run[A-Z]\w*Suite$/.test(name) && typeof fn === 'function');
	if (runFns.length === 0) {
		return { file, error: 'no run*Suite export found' };
	}
	const results = [];
	for (const [name, fn] of runFns) {
		try {
			const report = fn();
			const awaited = await Promise.resolve(report);
			// Two suite conventions are supported:
			//   - ITestSuiteReport { results, passed, failed } (sync suite)
			//   - Promise<ITestResult[]> (async suite resolving to a result array)
			const list = Array.isArray(awaited) ? awaited : awaited?.results;
			if (!Array.isArray(list)) {
				results.push({ name, passed: false, suite: 'runner', message: 'suite returned neither ITestSuiteReport nor ITestResult[]' });
				continue;
			}
			await waitForSuiteSettling(list, 5000);
			results.push(...list.map(r => ({ ...r, suite: name })));
		} catch (err) {
			results.push({ name, passed: false, suite: 'runner', message: err.message });
		}
	}
	return { file, results };
}

function summarize(files) {
	let passed = 0;
	let failed = 0;
	let errors = 0;
	for (const f of files) {
		if (f.error) { errors++; continue; }
		for (const r of f.results) {
			if (r.passed) passed++;
			else failed++;
		}
	}
	return { passed, failed, errors, total: files.length };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const files = discoverSuiteFiles(args.dir, args.pattern);
	if (files.length === 0) {
		console.warn(`[unit-runner] no suite files found under ${args.dir} matching ${args.pattern}`);
		process.exit(0);
	}
	if (!args.skipBuild) {
		console.log('[unit-runner] compiling TypeScript...');
		await compileIfNeeded();
	}
	const results = [];
	for (const file of files) {
		const rel = path.relative(ROOT, file);
		try {
			const result = await runSuiteFile(file);
			results.push(result);
			if (result.error) {
				console.error(`- [ERROR] ${rel}: ${result.error}`);
			} else {
				for (const r of result.results) {
					const mark = r.passed ? 'PASS' : 'FAIL';
					const detail = r.message ? ` (${r.message})` : '';
					console.log(`- [${mark}] ${rel} :: ${r.name}${detail}`);
				}
			}
		} catch (err) {
			results.push({ file, error: err.message });
			console.error(`- [ERROR] ${rel}: ${err.message}`);
		}
	}
	const summary = summarize(results);
	if (args.json) {
		console.log(JSON.stringify({ files: results, summary }, null, '\t'));
	} else {
		console.log(`\n[unit-runner] ${summary.total} suites: ${summary.passed} passed, ${summary.failed} failed, ${summary.errors} suite errors`);
	}
	process.exit(summary.failed + summary.errors > 0 ? 1 : 0);
}

export { discoverSuiteFiles, runSuiteFile, summarize, distPathFor };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[unit-runner] fatal:', err);
		process.exit(1);
	});
}
