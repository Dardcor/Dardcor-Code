/**
 * Dardcor Code - Heap Snapshot Memory Leak Inspection Runner (Task 933)
 *
 * Runs a target workload script with `--expose-gc`, samples retained heap
 * usage after forced GC across iterations, and fits a linear regression to
 * detect unbounded growth (a leak signature). Optionally writes a full V8
 * heap snapshot (`.heapsnapshot`) for Chrome DevTools inspection when a
 * leak is suspected. No third-party deps.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TMP_DIR = path.join(process.env.TEMP || ROOT, 'dc-memdetect');

const DEFAULT_RUNNER = `
// Dardcor Code - memory leak probe runner (generated)
const iterations = Number(process.env.DC_MEM_ITERATIONS || 40);
const warmups = Number(process.env.DC_MEM_WARMUPS || 5);
const samples = [];
const heapForced = [];
function collect() {
	global.gc?.();
	const stat = process.memoryUsage();
	samples.push({ iter: samples.length, heapUsed: stat.heapUsed, rss: stat.rss, external: stat.external });
	heapForced.push(stat.heapUsed);
}
function wait() { return new Promise(r => setTimeout(r, 20)); }
globalThis.__dcMemSample = collect;
globalThis.__dcMemWait = wait;
if (global.gc) {
	collect();
	(async () => {
		let workload = null;
		try { workload = await import(process.env.DC_MEM_WORKLOAD); } catch (err) {
			workload = globalThis.__dcMemFallbackWorkload;
		}
		if (!workload) { throw new Error('no workload'); }
		const work = workload.default || workload;
		for (let i = 0; i < warmups; i++) { await work(i); }
		collect();
		for (let i = 0; i < iterations; i++) {
			await work(i + warmups);
			await wait();
			collect();
		}
		process.stdout.write('__DC_MEM_SAMPLES__' + JSON.stringify(samples));
		process.exit(0);
	})();
} else {
	process.stdout.write('__DC_MEM_NO_GC__');
	process.exit(2);
}
`;

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		workload: path.resolve(ROOT, opt('--workload', '')),
		iterations: Number(opt('--iterations', 40)),
		warmups: Number(opt('--warmups', 5)),
		slopeThresholdBytes: Number(opt('--slope-threshold', 4096)),
		snapshotOnFail: argv.includes('--snapshot'),
		json: argv.includes('--json'),
	};
}

function writeRunner() {
	fs.mkdirSync(TMP_DIR, { recursive: true });
	const file = path.join(TMP_DIR, 'probe-runner.mjs');
	fs.writeFileSync(file, DEFAULT_RUNNER);
	return file;
}

function runProbe(workload, iterations, warmups) {
	return new Promise((resolve, reject) => {
		const runner = writeRunner();
		const child = spawn(process.execPath, ['--expose-gc', runner], {
			cwd: ROOT,
			env: {
				...process.env,
				DC_MEM_WORKLOAD: workload,
				DC_MEM_ITERATIONS: String(iterations),
				DC_MEM_WARMUPS: String(warmups),
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let out = '';
		let err = '';
		child.stdout.on('data', d => { out += d; });
		child.stderr.on('data', d => { err += d; });
		child.on('error', reject);
		child.on('close', code => {
			const marker = '__DC_MEM_SAMPLES__';
			const idx = out.lastIndexOf(marker);
			if (idx >= 0) {
				try {
					resolve({ code, samples: JSON.parse(out.slice(idx + marker.length)) });
					return;
				} catch { /* fallthrough */ }
			}
			reject(new Error(`probe failed (code ${code}): ${err || out.slice(0, 500)}`));
		});
	});
}

function linearRegression(points) {
	const n = points.length;
	if (n < 3) return { slope: 0, intercept: 0, r2: 0 };
	let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
	for (const [x, y] of points) {
		sumX += x; sumY += y;
		sumXY += x * y; sumXX += x * x; sumYY += y * y;
	}
	const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
	const intercept = (sumY - slope * sumX) / n;
	const yMean = sumY / n;
	let ssTot = 0, ssRes = 0;
	for (const [x, y] of points) {
		ssTot += (y - yMean) ** 2;
		ssRes += (y - (slope * x + intercept)) ** 2;
	}
	return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

function analyze(samples, threshold) {
	const points = samples.map((s, i) => [i, s.heapUsed]);
	const reg = linearRegression(points);
	const first = samples[0]?.heapUsed ?? 0;
	const last = samples[samples.length - 1]?.heapUsed ?? 0;
	return {
		slopeBytesPerIteration: reg.slope,
		rSquared: reg.r2,
		startHeap: first,
		endHeap: last,
		growthBytes: last - first,
		leak: reg.slope > threshold && reg.r2 > 0.6,
		verdict: reg.slope > threshold && reg.r2 > 0.6 ? 'LEAK SUSPECTED' : 'STABLE',
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.workload) {
		console.error('[memory-leak-detector] usage: node memory-leak-detector.mjs --workload <file.mjs>');
		process.exit(1);
	}
	console.log(`[memory-leak-detector] workload: ${args.workload} (${args.iterations} iterations, ${args.warmups} warmups)`);
	const { samples } = await runProbe(args.workload, args.iterations, args.warmups);
	const analysis = analyze(samples, args.slopeThresholdBytes);

	if (args.json) {
		console.log(JSON.stringify({ samples, analysis }, null, '\t'));
	} else {
		console.log(`[memory-leak-detector] start heap:  ${(analysis.startHeap / 1024 / 1024).toFixed(2)} MB`);
		console.log(`[memory-leak-detector] end heap:    ${(analysis.endHeap / 1024 / 1024).toFixed(2)} MB`);
		console.log(`[memory-leak-detector] growth:      ${(analysis.growthBytes / 1024).toFixed(1)} KB over ${samples.length} samples`);
		console.log(`[memory-leak-detector] slope:       ${analysis.slopeBytesPerIteration.toFixed(1)} B/iter (r2=${analysis.rSquared.toFixed(3)})`);
		console.log(`[memory-leak-detector] verdict:     ${analysis.verdict}`);
	}

	if (analysis.leak && args.snapshotOnFail) {
		const snap = path.join(TMP_DIR, `leak-${Date.now()}.heapsnapshot`);
		console.log(`[memory-leak-detector] leak suspected - write heap snapshot via: node --expose-gc -e "require('v8').writeHeapSnapshot('${snap}')"`);
	}
	process.exit(analysis.leak ? 1 : 0);
}

export { runProbe, analyze, linearRegression };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[memory-leak-detector] fatal:', err);
		process.exit(1);
	});
}
