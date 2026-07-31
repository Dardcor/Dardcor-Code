/**
 * Dardcor Code - Editor Startup & Typing Latency Benchmark (Task 913)
 *
 * Measures, in-process, the core performance envelope of the editor:
 *   - module load time (engine + app-shell compiled modules)
 *   - text model initialization (document open)
 *   - typing latency (single-character insert + view tokenization)
 *   - bulk edit throughput (lines per second)
 * Best-effort spawns Electron to measure true process startup when a
 * display is available; otherwise reports the JS-level numbers.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIST = path.join(ROOT, 'dist');

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		iterations: Number(opt('--iterations', 5)),
		json: argv.includes('--json'),
		noElectron: argv.includes('--no-electron'),
	};
}

function nowMs() {
	return Number(process.hrtime.bigint()) / 1e6;
}

async function ensureCompiled() {
	if (fs.existsSync(path.join(DIST, 'dc', 'engine', 'model', 'text-model.js'))) return;
	const { spawnSync } = await import('node:child_process');
	const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
	const result = spawnSync(cmd, ['tsc', '-p', 'tsconfig.json'], { cwd: ROOT, stdio: 'pipe' });
	if (result.status !== 0) throw new Error('compile failed:\n' + result.stdout?.toString());
}

async function benchmarkEngine(iterations) {
	const results = { moduleLoadMs: 0, modelInitMs: 0, typingPerCharMs: 0, bulkLinesPerSec: 0 };

	// 1. module load (cold import, includes transitive graph)
	const loadStart = nowMs();
	const { TextModel } = await import(pathToFileURL(path.join(DIST, 'dc', 'engine', 'model', 'text-model.js')));
	const { URI } = await import(pathToFileURL(path.join(DIST, 'dc', 'core', 'types', 'uri.js')));
	results.moduleLoadMs = nowMs() - loadStart;

	// 2. model init (open a 500-line document)
	const sampleLines = [];
	for (let i = 0; i < 500; i++) {
		sampleLines.push(`const value${i} = compute(${i}, "sample"); // line ${i}`);
	}
	const document = sampleLines.join('\n');

	let initTotal = 0;
	for (let i = 0; i < iterations; i++) {
		const t0 = nowMs();
		const model = new TextModel(URI.file('/bench/sample.ts'), document);
		initTotal += nowMs() - t0;
		model.dispose();
	}
	results.modelInitMs = initTotal / iterations;

	// 3. typing latency (single char insert near end of document)
	const model = new TextModel(URI.file('/bench/type.ts'), document);
	const { Position } = await import(pathToFileURL(path.join(DIST, 'dc', 'engine', 'model', 'text-model.js')));
	let typeTotal = 0;
	for (let i = 0; i < iterations * 20; i++) {
		const pos = new Position(500, 1);
		const t0 = nowMs();
		model.insertString(pos, 'x');
		typeTotal += nowMs() - t0;
	}
	results.typingPerCharMs = typeTotal / (iterations * 20);

	// 4. bulk edit throughput
	const t0 = nowMs();
	const big = new TextModel(URI.file('/bench/bulk.ts'), '');
	for (let i = 0; i < 10000; i++) {
		big.insertString(new Position(1, 1), `line ${i}\n`);
	}
	const bulkMs = nowMs() - t0;
	results.bulkLinesPerSec = 10000 / (bulkMs / 1000);
	big.dispose();
	model.dispose();
	return results;
}

async function measureElectronStartup(timeoutMs = 30000) {
	return new Promise(resolve => {
		const electronBin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
		if (!fs.existsSync(electronBin)) {
			resolve({ available: false, reason: 'electron binary not installed' });
			return;
		}
		const start = nowMs();
		const child = spawn(electronBin, ['.', '--no-sandbox', '--disable-gpu'], {
			cwd: ROOT,
			env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', DC_BENCH: '1' },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let sawReady = false;
		let output = '';
		child.stdout.on('data', d => { output += d; });
		child.stderr.on('data', d => { output += d; });
		const timer = setTimeout(() => {
			child.kill();
			resolve({ available: true, readyMs: sawReady ? nowMs() - start : null, reason: sawReady ? 'ready' : 'no ready marker within timeout', output: output.slice(0, 500) });
		}, timeoutMs);
		child.on('error', err => {
			clearTimeout(timer);
			resolve({ available: true, reason: 'spawn failed: ' + err.message });
		});
		child.on('close', () => {
			clearTimeout(timer);
			resolve({ available: true, readyMs: null, reason: 'exited before ready', output: output.slice(0, 500) });
		});
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	await ensureCompiled();
	console.log(`[performance-benchmark] running ${args.iterations} iterations...\n`);
	const engine = await benchmarkEngine(args.iterations);
	const electron = args.noElectron ? { available: false, reason: 'skipped' } : await measureElectronStartup();

	const report = {
		timestamp: new Date().toISOString(),
		node: process.version,
		platform: process.platform,
		engine,
		electronStartup: electron,
	};

	if (args.json) {
		console.log(JSON.stringify(report, null, '\t'));
	} else {
		console.log('=== Engine (in-process, JS) ===');
		console.log(`module load:          ${engine.moduleLoadMs.toFixed(2)} ms`);
		console.log(`model init (500 ln):  ${engine.modelInitMs.toFixed(3)} ms`);
		console.log(`typing latency:       ${engine.typingPerCharMs.toFixed(4)} ms / char  (~${(1000 / engine.typingPerCharMs).toFixed(0)} chars/sec)`);
		console.log(`bulk edit:            ${engine.bulkLinesPerSec.toFixed(0)} lines/sec`);
		console.log('\n=== Electron process ===');
		if (electron.available && electron.readyMs != null) {
			console.log(`startup to ready:     ${electron.readyMs.toFixed(1)} ms`);
		} else {
			console.log(`startup:              not measured (${electron.reason})`);
		}
	}
}

export { benchmarkEngine, measureElectronStartup };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[performance-benchmark] fatal:', err);
		process.exit(1);
	});
}
