/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

/**
 * Chat performance benchmark.
 *
 * Uses the real copilot extension with IS_SCENARIO_AUTOMATION=1 and a local
 * mock LLM server. Measures the full stack: prompt building, context
 * gathering, tool resolution, rendering, GC, and layout overhead.
 *
 * Usage:
 *   npm run perf:chat                                 # all scenarios vs 1.115.0
 *   npm run perf:chat -- --runs 10                    # 10 runs per scenario
 *   npm run perf:chat -- --scenario text-only         # single scenario
 *   npm run perf:chat -- --no-baseline                # skip baseline comparison
 *   npm run perf:chat -- --build 1.110.0 --baseline-build 1.115.0
 *   npm run perf:chat -- --resume .chat-simulation-data/2026-04-14/results.json --runs 3
 */

const path = require('path');
const fs = require('fs');
const {
	ROOT, DATA_DIR, METRIC_DEFS, loadConfig,
	resolveBuild, isVersionString, buildEnv, buildArgs, prepareRunDir,
	robustStats, welchTTest, summarize, markDuration, launchVSCode,
	getNextExtHostInspectPort, connectToExtHostInspector, getRepoRoot,
} = require('./common/utils');
const { getUserTurns, getScenarioIds } = require('./common/mock-llm-server.ts');
const { registerPerfScenarios, getScenarioDescription } = require('./common/perf-scenarios');


const CONFIG = loadConfig('perfRegression');


function parseArgs() {
	const args = process.argv.slice(2);
	const opts = {
		runs: CONFIG.runsPerScenario ?? 5,
		verbose: false,
		ci: false,
		noCache: false,
		force: false,
		heapSnapshots: false,
		gcObjectStats: false,
		/** @type {string[]} */
		scenarios: [],
		/** @type {string | undefined} */
		build: undefined,
		/** @type {string | undefined} */
		baseline: undefined,
		/** @type {string | undefined} */
		baselineBuild: CONFIG.baselineBuild ?? '1.115.0',
		saveBaseline: false,
		threshold: CONFIG.regressionThreshold ?? 0.2,
		/** @type {Record<string, number | string>} */
		metricThresholds: CONFIG.metricThresholds ?? {},
		/** @type {string | undefined} */
		resume: undefined,
		productionBuild: false,
		/** @type {Record<string, any>} */
		settingsOverrides: {},
		/** @type {Record<string, any>} */
		testSettingsOverrides: {},
		/** @type {Record<string, any>} */
		baselineSettingsOverrides: {},
		cleanupDiagnostics: false,
	};
	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--runs': opts.runs = parseInt(args[++i], 10); break;
			case '--verbose': opts.verbose = true; break;
			case '--scenario': case '-s': opts.scenarios.push(args[++i]); break;
			case '--build': case '-b': opts.build = args[++i]; break;
			case '--baseline': opts.baseline = args[++i]; break;
			case '--baseline-build': opts.baselineBuild = args[++i]; break;
			case '--no-baseline': opts.baselineBuild = undefined; break;
			case '--save-baseline': opts.saveBaseline = true; break;
			case '--threshold': opts.threshold = parseFloat(args[++i]); break;
			case '--resume': opts.resume = args[++i]; break;
			case '--production-build': opts.productionBuild = true; break;
			case '--setting': case '--test-setting': case '--baseline-setting': {
				const kv = args[++i];
				const eq = kv.indexOf('=');
				if (eq === -1) { console.error(`${args[i - 1]} requires key=value, got: ${kv}`); process.exit(1); }
				const key = kv.slice(0, eq);
				const raw = kv.slice(eq + 1);
				const val = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
				const flag = args[i - 1];
				if (flag === '--test-setting') { opts.testSettingsOverrides[key] = val; }
				else if (flag === '--baseline-setting') { opts.baselineSettingsOverrides[key] = val; }
				else { opts.settingsOverrides[key] = val; }
				break;
			}
			case '--no-cache': opts.noCache = true; break;
			case '--force': opts.force = true; break;
			case '--heap-snapshots': opts.heapSnapshots = true; break;
			case '--gc-object-stats': opts.gcObjectStats = true; break;
			case '--ci': opts.ci = true; opts.noCache = true; opts.heapSnapshots = true; opts.cleanupDiagnostics = true; break;
			case '--cleanup-diagnostics': opts.cleanupDiagnostics = true; break;
			case '--help': case '-h':
				console.log([
					'Chat performance benchmark',
					'',
					'Options:',
					'  --runs <n>          Number of runs per scenario (default: 5)',
					'  --scenario <id>     Scenario to run (repeatable; default: all)',
					'  --build <path|ver>  Path to VS Code build, or a version to download',
					'                       (e.g. "1.110.0", "insiders", commit hash, or local path)',
					'  --baseline <path>   Compare against a baseline JSON file',
					'  --baseline-build <v> Version or path to benchmark as baseline',
					'                       (e.g. "1.115.0", "insiders", commit hash, or local path)',
					'  --no-baseline        Skip baseline comparison entirely',
					'  --save-baseline     Save results as the new baseline (requires --baseline <path>)',
					'  --resume <path>     Resume a previous run, adding more iterations to increase',
					'                       confidence. Merges new runs with existing rawRuns data',
					'  --threshold <frac>  Regression threshold fraction (default: 0.2 = 20%)',
					'  --production-build  Build a local bundled package (via gulp vscode) for',
					'                       apples-to-apples comparison against a release baseline',
					'  --setting <k=v>     Set a VS Code setting override for all builds (repeatable)',
					'  --test-setting <k=v> Set a VS Code setting override for test build only',
					'  --baseline-setting <k=v> Set a VS Code setting override for baseline build only',
					'                       e.g. --setting chat.experimental.incrementalRendering.enabled=true',
					'  --no-cache          Ignore cached baseline data, always run fresh',
					'  --force             Skip build mode mismatch confirmation',
					'  --heap-snapshots    Take heap snapshots (slow; auto-enabled in --ci mode)',
					'  --gc-object-stats   Enable V8 gc_stats tracing for GC deep-dives only. WARNING: corrupts timings (adds ~550ms to any request hit by a major GC) — never use for benchmarking',
					'  --ci                CI mode: write Markdown summary to ci-summary.md (implies --no-cache, --heap-snapshots, --cleanup-diagnostics)',
					'  --cleanup-diagnostics  Remove heap snapshots, CPU profiles, and traces after each run to save disk space',
					'  --verbose           Print per-run details',
					'',
					'Scenarios: ' + getScenarioIds().join(', '),
				].join('\n'));
				process.exit(0);
		}
	}
	if (opts.scenarios.length === 0) {
		opts.scenarios = getScenarioIds();
	} else {
		const knownIds = new Set(getScenarioIds());
		const unknown = opts.scenarios.filter(s => !knownIds.has(s));
		if (unknown.length > 0) {
			console.error(`Unknown scenario(s): ${unknown.join(', ')}\nAvailable: ${[...knownIds].join(', ')}`);
			process.exit(1);
		}
	}
	return opts;
}


/**
 * Classify an electron path into a build mode.
 * @param {string} electronPath
 * @returns {'dev' | 'production' | 'release'}
 */
function detectBuildMode(electronPath) {
	if (electronPath.includes('.vscode-test')) {
		return 'release';
	}
	if (electronPath.includes('VSCode-')) {
		return 'production';
	}
	return 'dev';
}

/**
 * Return a human-readable label for a build mode.
 * @param {'dev' | 'production' | 'release'} mode
 * @returns {string}
 */
function buildModeLabel(mode) {
	switch (mode) {
		case 'dev': return 'development (unbundled)';
		case 'production': return 'production (bundled, local)';
		case 'release': return 'release (bundled, downloaded)';
	}
}


/**
 * Build a local production (bundled) VS Code package using `gulp vscode`.
 * Returns the path to the Electron executable in the packaged output.
 *
 * The gulp task compiles TypeScript, bundles JS, and packages with Electron
 * into `../VSCode-<platform>-<arch>/`.  This is the same process used for
 * release builds, minus minification and mangling.
 */
function buildProductionBuild() {
	const product = require(path.join(ROOT, 'product.json'));
	const platform = process.platform;
	const arch = process.arch;
	const destDir = path.join(ROOT, '..', `VSCode-${platform}-${arch}`);

	console.log('[chat-simulation] Building local production package (gulp vscode)...');
	console.log('[chat-simulation] This may take a few minutes on the first run.');

	const { execSync } = require('child_process');
	try {
		execSync('npm run gulp -- vscode', {
			cwd: ROOT,
			stdio: 'inherit',
			timeout: 10 * 60 * 1000,
		});
	} catch (e) {
		console.warn('[chat-simulation] gulp vscode exited with errors (see above). Checking if executable was still produced...');
	}

	/** @type {string} */
	let electronPath;
	if (platform === 'darwin') {
		electronPath = path.join(destDir, `${product.nameLong}.app`, 'Contents', 'MacOS', product.nameShort);
	} else if (platform === 'linux') {
		electronPath = path.join(destDir, product.applicationName);
	} else {
		electronPath = path.join(destDir, `${product.nameShort}.exe`);
	}

	if (!fs.existsSync(electronPath)) {
		console.error(`[chat-simulation] Production build failed — executable not found at: ${electronPath}`);
		process.exit(1);
	}

	const overridesPath = path.join(ROOT, 'product.overrides.json');
	if (fs.existsSync(overridesPath)) {
		/** @type {string} */
		let appDir;
		if (platform === 'darwin') {
			appDir = path.join(destDir, `${product.nameLong}.app`, 'Contents', 'Resources', 'app');
		} else {
			appDir = path.join(destDir, 'resources', 'app');
		}
		const packagedProductPath = path.join(appDir, 'product.json');
		if (fs.existsSync(packagedProductPath)) {
			const packagedProduct = JSON.parse(fs.readFileSync(packagedProductPath, 'utf-8'));
			const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'));
			const merged = Object.assign(packagedProduct, overrides);
			fs.writeFileSync(packagedProductPath, JSON.stringify(merged, null, '\t'));
			console.log('[chat-simulation] Merged product.overrides.json into packaged product.json');
		}
	}

	console.log(`[chat-simulation] Production build ready: ${electronPath}`);
	return electronPath;
}

/**
 * @typedef {{ type: 'fraction', value: number } | { type: 'absolute', value: number }} MetricThreshold
 */

/**
 * Parse a metric threshold value from config.
 * - A number is treated as a fraction (e.g. 0.2 = 20%).
 * - A string like "100ms" or "5" is treated as an absolute delta.
 * @param {number | string} raw
 * @returns {MetricThreshold}
 */
function parseMetricThreshold(raw) {
	if (typeof raw === 'number') {
		return { type: 'fraction', value: raw };
	}
	const num = parseFloat(raw);
	if (isNaN(num)) {
		throw new Error(`Invalid metric threshold: ${raw}`);
	}
	return { type: 'absolute', value: num };
}

/**
 * Get the regression threshold for a specific metric.
 * Uses per-metric override from config if available, otherwise the global threshold.
 * @param {{ threshold: number, metricThresholds?: Record<string, number | string> }} opts
 * @param {string} metric
 * @returns {MetricThreshold}
 */
function getMetricThreshold(opts, metric) {
	const raw = opts.metricThresholds?.[metric];
	if (raw !== undefined) {
		return parseMetricThreshold(raw);
	}
	return { type: 'fraction', value: opts.threshold };
}

/**
 * Check whether a change exceeds the threshold.
 * @param {MetricThreshold} threshold
 * @param {number} change - fractional change (e.g. 0.5 = 50% increase)
 * @param {number} absoluteDelta - absolute difference (cur.median - bas.median)
 * @returns {boolean}
 */
function exceedsThreshold(threshold, change, absoluteDelta) {
	if (threshold.type === 'absolute') {
		return absoluteDelta > threshold.value;
	}
	return change > threshold.value;
}


/**
 * @typedef {{
 *   timeToUIUpdated: number,
 *   timeToFirstToken: number,
 *   timeToComplete: number,
 *   timeToRenderComplete: number,
 *   instructionCollectionTime: number,
 *   agentInvokeTime: number,
 *   heapUsedBefore: number,
 *   heapUsedAfter: number,
 *   heapDelta: number,
 *   heapDeltaPostGC: number,
 *   majorGCs: number,
 *   minorGCs: number,
 *   gcDurationMs: number,
 *   layoutCount: number,
 *   layoutDurationMs: number,
 *   recalcStyleCount: number,
 *   forcedReflowCount: number,
 *   longTaskCount: number,
 *   longAnimationFrameCount: number,
 *   longAnimationFrameTotalMs: number,
 *   frameCount: number,
 *   compositeLayers: number,
 *   paintCount: number,
 *   hasInternalMarks: boolean,
 *   responseHasContent: boolean,
 *   internalFirstToken: number,
 *   profilePath: string,
 *   tracePath: string,
 *   snapshotPath: string,
 *   extHostHeapUsedBefore: number,
 *   extHostHeapUsedAfter: number,
 *   extHostHeapDelta: number,
 *   extHostHeapDeltaPostGC: number,
 *   extHostProfilePath: string,
 *   extHostSnapshotPath: string,
 * }} RunMetrics
 */


/**
 * @param {string} electronPath
 * @param {string} scenario
 * @param {{ url: string, requestCount: () => number, waitForRequests: (n: number, ms: number) => Promise<void>, completionCount: () => number, waitForCompletion: (n: number, ms: number) => Promise<void> }} mockServer
 * @param {boolean} verbose
 * @param {string} runIndex
 * @param {string} runDir - timestamped run directory for diagnostics
 * @param {'baseline' | 'test'} role - whether this is a baseline or test run
 * @param {Record<string, any>} [settingsOverrides] - custom VS Code settings
 * @param {{ heapSnapshots?: boolean }} [runOpts] - additional run options
 * @returns {Promise<RunMetrics>}
 */
async function runOnce(electronPath, scenario, mockServer, verbose, runIndex, runDir, role, settingsOverrides, runOpts) {
	const takeHeapSnapshots = runOpts?.heapSnapshots ?? false;
	const { userDataDir, extDir, logsDir } = prepareRunDir(runIndex, mockServer, settingsOverrides);
	const isDevBuild = !electronPath.includes('.vscode-test') && !electronPath.includes('VSCode-');
	let buildLabel = 'dev';
	if (!isDevBuild) {
		const vscodeTestMatch = electronPath.match(/vscode-test\/vscode-[^/]*?-(\d+\.\d+\.\d+)/);
		if (vscodeTestMatch) {
			buildLabel = vscodeTestMatch[1];
		} else if (electronPath.includes('VSCode-')) {
			buildLabel = 'production';
		} else {
			buildLabel = path.basename(electronPath);
		}
	}

	const appRoot = isDevBuild ? (getRepoRoot(electronPath) || ROOT) : ROOT;
	if (isDevBuild && appRoot !== ROOT) {
		if (verbose) {
			console.log(`  [debug] Using appRoot from electron path: ${appRoot}`);
		}
	}

	const runDiagDir = path.join(runDir, `${role}-${buildLabel}`, runIndex.replace(/^baseline-/, ''));
	fs.mkdirSync(runDiagDir, { recursive: true });

	const tracePath = path.join(runDiagDir, 'trace.json');
	const extHostInspectPort = getNextExtHostInspectPort();
	const vscode = await launchVSCode(
		electronPath,
		buildArgs(userDataDir, extDir, logsDir, { isDevBuild, extHostInspectPort, traceFile: tracePath, appRoot, gcObjectStats: runOpts?.gcObjectStats }),
		buildEnv(mockServer, { isDevBuild }),
		{ verbose },
	);
	activeVSCode = vscode;
	const window = vscode.page;

	/** @type {{ send: (method: string, params?: any) => Promise<any>, on: (event: string, listener: (params: any) => void) => void, close: () => void } | null} */
	let extHostInspector = null;
	/** @type {{ usedSize: number, totalSize: number } | null} */
	let extHostHeapBefore = null;
	/** @type {Omit<RunMetrics, 'majorGCs' | 'minorGCs' | 'gcDurationMs' | 'longTaskCount' | 'longAnimationFrameCount' | 'longAnimationFrameTotalMs' | 'timeToUIUpdated' | 'timeToFirstToken' | 'timeToComplete' | 'timeToRenderComplete' | 'layoutDurationMs' | 'instructionCollectionTime' | 'agentInvokeTime' | 'hasInternalMarks' | 'internalFirstToken'> | null} */
	let partialMetrics = null;
	let submitTime = 0;
	let firstResponseTime = 0;
	let responseCompleteTime = 0;
	let renderCompleteTime = 0;

	try {
		await window.waitForSelector('.monaco-workbench', { timeout: 60_000 });

		const cdp = await window.context().newCDPSession(window);
		await cdp.send('Performance.enable');
		const heapBefore = /** @type {any} */ (await cdp.send('Runtime.getHeapUsage'));

		const metricsBefore = await cdp.send('Performance.getMetrics');

		const chatShortcut = process.platform === 'darwin' ? 'Control+Meta+KeyI' : 'Control+Alt+KeyI';
		await window.keyboard.press(chatShortcut);

		const CHAT_VIEW = 'div[id="workbench.panel.chat"]';
		const chatEditorSel = `${CHAT_VIEW} .interactive-input-part .monaco-editor[role="code"]`;

		await window.waitForSelector(CHAT_VIEW, { timeout: 15_000 });
		await window.waitForFunction(
			(selector) => Array.from(document.querySelectorAll(selector)).some(el => {
				const rect = el.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0;
			}),
			chatEditorSel, { timeout: 15_000 },
		);

		const dismissDialog = async () => {
			for (const sel of ['.chat-setup-dialog', '.dialog-shadow', '.monaco-dialog-box']) {
				const el = await window.$(sel);
				if (el) { await window.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 500)); break; }
			}
		};
		await dismissDialog();

		const reqsBefore = mockServer.requestCount();
		try { await mockServer.waitForRequests(reqsBefore + 4, 30_000); } catch { }
		if (verbose) {
			console.log(`  [debug] Extension active (${mockServer.requestCount() - reqsBefore} new requests)`);
		}

		try {
			extHostInspector = await connectToExtHostInspector(extHostInspectPort, { verbose, timeoutMs: 15_000 });
			await extHostInspector.send('HeapProfiler.enable');
			await extHostInspector.send('Profiler.enable');
			await extHostInspector.send('Profiler.start');
			extHostHeapBefore = await extHostInspector.send('Runtime.getHeapUsage');
			if (verbose && extHostHeapBefore) {
				console.log(`  [ext-host] Heap before: ${Math.round(extHostHeapBefore.usedSize / 1024 / 1024)}MB`);
			}
		} catch (err) {
			if (verbose) {
				console.log(`  [ext-host] Could not connect to inspector: ${err}`);
			}
		}

		await new Promise(r => setTimeout(r, 3000));
		await dismissDialog();

		await window.click(chatEditorSel);
		const focusStart = Date.now();
		while (Date.now() - focusStart < 5_000) {
			const focused = await window.evaluate((sel) => {
				const el = document.querySelector(sel);
				return el && (el.classList.contains('focused') || el.contains(document.activeElement));
			}, chatEditorSel).catch(() => false);
			if (focused) { break; }
			await new Promise(r => setTimeout(r, 50));
		}

		const chatMessage = `[scenario:${scenario}] Explain how this code works`;
		const actualInputSelector = await window.evaluate((editorSel) => {
			const editor = document.querySelector(editorSel);
			if (!editor) { throw new Error('Chat editor not found'); }
			return editor.querySelector('.native-edit-context') ? editorSel + ' .native-edit-context' : editorSel + ' textarea';
		}, chatEditorSel);

		const hasDriver = await window.evaluate(() =>
			// @ts-ignore
			!!globalThis.driver?.typeInEditor
		).catch(() => false);

		if (hasDriver) {
			await window.evaluate(({ selector, text }) => {
				// @ts-ignore
				return globalThis.driver.typeInEditor(selector, text);
			}, { selector: actualInputSelector, text: chatMessage });
		} else {
			await window.click(actualInputSelector);
			await new Promise(r => setTimeout(r, 200));
			await window.locator(actualInputSelector).pressSequentially(chatMessage, { delay: 0 });
		}

		await cdp.send('Profiler.enable');
		await cdp.send('Profiler.start');

		const completionsBefore = mockServer.completionCount();
		submitTime = Date.now();
		await window.keyboard.press('Enter');

		try { await mockServer.waitForCompletion(completionsBefore + 1, 60_000); } catch { }
		firstResponseTime = Date.now();

		await dismissDialog();
		const responseSelector = `${CHAT_VIEW} .interactive-item-container.interactive-response`;
		await window.waitForFunction(
			(sel) => {
				const responses = document.querySelectorAll(sel);
				if (responses.length === 0) { return false; }
				return !responses[responses.length - 1].classList.contains('chat-response-loading');
			},
			responseSelector, { timeout: 30_000 },
		);
		responseCompleteTime = Date.now();

		const userTurns = getUserTurns(scenario);
		for (let ut = 0; ut < userTurns.length; ut++) {
			const userTurn = userTurns[ut];
			if (verbose) {
				console.log(`  [debug] User follow-up ${ut + 1}/${userTurns.length}: "${userTurn.message}"`);
			}

			await new Promise(r => setTimeout(r, 500));

			await window.click(chatEditorSel);
			const utFocusStart = Date.now();
			while (Date.now() - utFocusStart < 3_000) {
				const focused = await window.evaluate((sel) => {
					const el = document.querySelector(sel);
					return el && (el.classList.contains('focused') || el.contains(document.activeElement));
				}, chatEditorSel).catch(() => false);
				if (focused) { break; }
				await new Promise(r => setTimeout(r, 50));
			}

			if (hasDriver) {
				await window.evaluate(({ selector, text }) => {
					// @ts-ignore
					return globalThis.driver.typeInEditor(selector, text);
				}, { selector: actualInputSelector, text: userTurn.message });
			} else {
				await window.click(actualInputSelector);
				await new Promise(r => setTimeout(r, 200));
				await window.locator(actualInputSelector).pressSequentially(userTurn.message, { delay: 0 });
			}

			const utCompBefore = mockServer.completionCount();
			await window.keyboard.press('Enter');

			try { await mockServer.waitForCompletion(utCompBefore + 1, 60_000); } catch { }

			await dismissDialog();
			await window.evaluate((chatViewSel) => {
				const input = document.querySelector(chatViewSel + ' .interactive-input-part');
				if (input) { input.scrollIntoView({ block: 'end' }); }
			}, CHAT_VIEW);
			await new Promise(r => setTimeout(r, 200));

			await window.waitForFunction(
				(sel) => {
					const responses = document.querySelectorAll(sel);
					if (responses.length === 0) { return false; }
					return !responses[responses.length - 1].classList.contains('chat-response-loading');
				},
				responseSelector,
				{ timeout: 30_000 },
			);
			responseCompleteTime = Date.now();

			if (verbose) {
				const utResponseInfo = await window.evaluate((sel) => {
					const responses = document.querySelectorAll(sel);
					const last = responses[responses.length - 1];
					return last ? (last.textContent || '').substring(0, 150) : '(empty)';
				}, responseSelector);
				console.log(`  [debug] Follow-up response (first 150 chars): ${utResponseInfo}`);
			}
		}

		const { profile } = /** @type {any} */ (await cdp.send('Profiler.stop'));
		const profilePath = path.join(runDiagDir, 'profile.cpuprofile');
		fs.writeFileSync(profilePath, JSON.stringify(profile));
		if (verbose) {
			console.log(`  [debug] CPU profile saved to ${profilePath}`);
		}

		const responseInfo = await window.evaluate((sel) => {
			const responses = document.querySelectorAll(sel);
			const last = responses[responses.length - 1];
			if (!last) { return { hasContent: false, text: '' }; }
			const text = last.textContent || '';
			return { hasContent: text.trim().length > 0, text: text.substring(0, 200) };
		}, responseSelector);

		if (verbose) {
			console.log(`  [debug] Response content (first 200 chars): ${responseInfo.text}`);
			console.log(`  [debug] Client-side timing: firstResponse=${firstResponseTime - submitTime}ms, complete=${responseCompleteTime - submitTime}ms`);
		}

		await window.waitForFunction(
			(sel) => {
				const responses = document.querySelectorAll(sel);
				const last = responses[responses.length - 1];
				if (!last) { return true; }
				const hasAnimating = last.querySelector('.chat-animated-word, .chat-typewriter-cursor');
				return !hasAnimating;
			},
			responseSelector,
			{ timeout: 30_000 },
		).catch(() => {
		});

		{
			let prev = '';
			let stableCount = 0;
			const stabilizeStart = Date.now();
			while (stableCount < 3 && Date.now() - stabilizeStart < 10_000) {
				const current = await window.evaluate((sel) => {
					const responses = document.querySelectorAll(sel);
					const last = responses[responses.length - 1];
					return last ? (last.textContent || '') : '';
				}, responseSelector).catch(() => '');
				if (current === prev) {
					stableCount++;
				} else {
					stableCount = 0;
					prev = current;
				}
				await new Promise(r => setTimeout(r, 100));
			}
		}
		renderCompleteTime = Date.now();
		if (verbose) {
			console.log(`  [debug] Render stabilized: ${renderCompleteTime - responseCompleteTime}ms after stream complete`);
		}

		const heapAfter = /** @type {any} */ (await cdp.send('Runtime.getHeapUsage'));
		const metricsAfter = await cdp.send('Performance.getMetrics');

		let extHostHeapUsedBefore = -1;
		let extHostHeapUsedAfter = -1;
		let extHostHeapDelta = -1;
		let extHostHeapDeltaPostGC = -1;
		let extHostProfilePath = '';
		let extHostSnapshotPath = '';
		if (extHostInspector && extHostHeapBefore) {
			try {
				extHostHeapUsedBefore = Math.round(extHostHeapBefore.usedSize / 1024 / 1024);

				const extProfile = await extHostInspector.send('Profiler.stop');
				extHostProfilePath = path.join(runDiagDir, 'exthost-profile.cpuprofile');
				fs.writeFileSync(extHostProfilePath, JSON.stringify(extProfile.profile));
				if (verbose) {
					console.log(`  [ext-host] CPU profile saved to ${extHostProfilePath}`);
				}

				const extHostHeapAfter = await extHostInspector.send('Runtime.getHeapUsage');
				extHostHeapUsedAfter = Math.round(extHostHeapAfter.usedSize / 1024 / 1024);
				extHostHeapDelta = extHostHeapUsedAfter - extHostHeapUsedBefore;

				try {
					await extHostInspector.send('Runtime.evaluate', { expression: 'gc()', awaitPromise: false, includeCommandLineAPI: true });
					await new Promise(r => setTimeout(r, 200));
					const extHostHeapPostGC = await extHostInspector.send('Runtime.getHeapUsage');
					extHostHeapDeltaPostGC = Math.round(extHostHeapPostGC.usedSize / 1024 / 1024) - extHostHeapUsedBefore;
				} catch {
					extHostHeapDeltaPostGC = -1;
				}

				if (verbose) {
					console.log(`  [ext-host] Heap: before=${extHostHeapUsedBefore}MB, after=${extHostHeapUsedAfter}MB, delta=${extHostHeapDelta}MB, deltaPostGC=${extHostHeapDeltaPostGC}MB`);
				}
			} catch (err) {
				if (verbose) {
					console.log(`  [ext-host] Error collecting metrics: ${err}`);
				}
			}
		}

		let snapshotPath = '';
		if (takeHeapSnapshots) {
			const snapshotPromises = [];

			snapshotPromises.push((async () => {
				const p = path.join(runDiagDir, 'heap.heapsnapshot');
				await cdp.send('HeapProfiler.enable');
				const chunks = /** @type {string[]} */ ([]);
				cdp.on('HeapProfiler.addHeapSnapshotChunk', (/** @type {any} */ params) => {
					chunks.push(params.chunk);
				});
				await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
				fs.writeFileSync(p, chunks.join(''));
				return p;
			})());

			if (extHostInspector && extHostHeapBefore) {
				snapshotPromises.push((async () => {
					const p = path.join(runDiagDir, 'exthost-heap.heapsnapshot');
					const chunks = /** @type {string[]} */ ([]);
					extHostInspector.on('HeapProfiler.addHeapSnapshotChunk', (/** @type {any} */ params) => {
						chunks.push(params.chunk);
					});
					await extHostInspector.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
					fs.writeFileSync(p, chunks.join(''));
					return p;
				})());
			}

			const snapshotResults = await Promise.all(snapshotPromises);
			snapshotPath = snapshotResults[0];
			if (snapshotResults.length > 1) {
				extHostSnapshotPath = snapshotResults[1];
			}

			if (verbose) {
				console.log(`  [debug] Renderer snapshot saved to ${snapshotPath}`);
				if (extHostSnapshotPath) {
					console.log(`  [ext-host] Snapshot saved to ${extHostSnapshotPath}`);
				}
			}
		}

		if (extHostInspector) {
			extHostInspector.close();
		}


		/** @param {any} r @param {string} name */
		function getMetric(r, name) {
			const e = r.metrics?.find((/** @type {any} */ m) => m.name === name);
			return e ? e.value : 0;
		}

		partialMetrics = {
			heapUsedBefore: Math.round(heapBefore.usedSize / 1024 / 1024),
			heapUsedAfter: Math.round(heapAfter.usedSize / 1024 / 1024),
			heapDelta: Math.round((heapAfter.usedSize - heapBefore.usedSize) / 1024 / 1024),
			heapDeltaPostGC: await (async () => {
				try {
					await cdp.send('Runtime.evaluate', { expression: 'gc()', awaitPromise: false, includeCommandLineAPI: true });
					await new Promise(r => setTimeout(r, 200));
					const heapPostGC = /** @type {any} */ (await cdp.send('Runtime.getHeapUsage'));
					return Math.round((heapPostGC.usedSize - heapBefore.usedSize) / 1024 / 1024);
				} catch {
					return -1;
				}
			})(),
			layoutCount: getMetric(metricsAfter, 'LayoutCount') - getMetric(metricsBefore, 'LayoutCount'),
			recalcStyleCount: getMetric(metricsAfter, 'RecalcStyleCount') - getMetric(metricsBefore, 'RecalcStyleCount'),
			forcedReflowCount: getMetric(metricsAfter, 'ForcedStyleRecalcs') - getMetric(metricsBefore, 'ForcedStyleRecalcs'),
			frameCount: getMetric(metricsAfter, 'FrameCount') - getMetric(metricsBefore, 'FrameCount'),
			compositeLayers: getMetric(metricsAfter, 'CompositeLayers') - getMetric(metricsBefore, 'CompositeLayers'),
			paintCount: getMetric(metricsAfter, 'PaintCount') - getMetric(metricsBefore, 'PaintCount'),
			responseHasContent: responseInfo.hasContent,
			profilePath,
			tracePath,
			snapshotPath,
			extHostHeapUsedBefore,
			extHostHeapUsedAfter,
			extHostHeapDelta,
			extHostHeapDeltaPostGC,
			extHostProfilePath,
			extHostSnapshotPath,
		};
	} finally {
		if (extHostInspector) {
			try { extHostInspector.close(); } catch { }
		}
		activeVSCode = null;
		await vscode.close();
	}

	/** @type {Array<any>} */
	let traceEvents = [];
	try {
		const traceData = JSON.parse(fs.readFileSync(tracePath, 'utf-8'));
		traceEvents = traceData.traceEvents || [];
	} catch {
	}

	const chatMarks = traceEvents
		.filter(e => e.cat === 'blink.user_timing' && e.name && e.name.startsWith('code/chat/'))
		.map(e => ({ name: e.name, startTime: e.ts / 1000 }));

	if (verbose && chatMarks.length > 0) {
		console.log(`  [trace] chatMarks (${chatMarks.length}): ${chatMarks.map((/** @type {any} */ m) => m.name.split('/').slice(-1)[0]).join(', ')}`);
	}

	const timeToUIUpdated = markDuration(chatMarks, 'request/start', 'request/uiUpdated');
	const internalFirstToken = markDuration(chatMarks, 'request/start', 'request/firstToken');
	const timeToFirstToken = internalFirstToken >= 0 ? internalFirstToken : (firstResponseTime - submitTime);
	const timeToComplete = responseCompleteTime - submitTime;
	const timeToRenderComplete = renderCompleteTime - submitTime;
	const instructionCollectionTime = markDuration(chatMarks, 'request/willCollectInstructions', 'request/didCollectInstructions');
	const agentInvokeTime = markDuration(chatMarks, 'agent/willInvoke', 'agent/didInvoke');

	let majorGCs = 0, minorGCs = 0, gcDurationMs = 0;
	for (const event of traceEvents) {
		const isGC = event.cat === 'v8.gc'
			|| event.cat === 'devtools.timeline,v8'
			|| (typeof event.cat === 'string' && event.cat.split(',').some((/** @type {string} */ c) => {
				const t = c.trim();
				return t === 'v8.gc' || t === 'disabled-by-default-v8.gc' || t === 'disabled-by-default-v8.gc_stats';
			}));
		if (!isGC) { continue; }
		if (event.ph && event.ph !== 'X' && event.ph !== 'B') { continue; }
		const name = event.name || '';
		if (/Major|MarkCompact|MSC|MC|IncrementalMarking|FinalizeMC/i.test(name)) { majorGCs++; }
		else if (/Minor|Scaveng/i.test(name)) { minorGCs++; }
		else { minorGCs++; }
		if (event.dur) { gcDurationMs += event.dur / 1000; }
	}
	let layoutDurationMs = 0;
	for (const event of traceEvents) {
		if (event.name === 'Layout' && event.ph === 'X' && event.dur) {
			layoutDurationMs += event.dur / 1000;
		}
	}

	let longTaskCount = 0;
	for (const event of traceEvents) {
		if (event.name === 'RunTask' && event.dur && event.dur > 50_000) { longTaskCount++; }
	}

	let longAnimationFrameCount = 0;
	let longAnimationFrameTotalMs = 0;
	{
		/** @type {Map<number, number>} */
		const frameStarts = new Map();
		for (const event of traceEvents) {
			if (event.cat === 'devtools.timeline' && event.name === 'AnimationFrame') {
				if (event.ph === 's') {
					frameStarts.set(event.id, event.ts);
				} else if (event.ph === 'f' && frameStarts.has(event.id)) {
					const durationMs = (event.ts - /** @type {number} */(frameStarts.get(event.id))) / 1000;
					frameStarts.delete(event.id);
					if (durationMs > 50) {
						longAnimationFrameCount++;
						longAnimationFrameTotalMs += durationMs;
					}
				}
			}
		}
	}

	return {
		...partialMetrics,
		timeToUIUpdated, timeToFirstToken, timeToComplete, timeToRenderComplete, instructionCollectionTime, agentInvokeTime,
		hasInternalMarks: chatMarks.length > 0,
		internalFirstToken,
		majorGCs, minorGCs,
		gcDurationMs: Math.round(gcDurationMs * 100) / 100,
		layoutDurationMs: Math.round(layoutDurationMs * 100) / 100,
		longTaskCount,
		longAnimationFrameCount,
		longAnimationFrameTotalMs: Math.round(longAnimationFrameTotalMs * 100) / 100,
	};
}


const GITHUB_REPO = 'https://github.com/microsoft/vscode';

/**
 * Format a build identifier as a Markdown link when possible.
 * - Commit SHAs link to the commit page.
 * - Semver versions link to the release tag page.
 * - Everything else (e.g. "baseline", "dev (local)") is returned as inline code.
 * @param {string} label
 * @returns {string}
 */
function formatBuildLink(label) {
	if (/^[0-9a-f]{7,40}$/.test(label)) {
		const short = label.substring(0, 7);
		return `[\`${short}\`](${GITHUB_REPO}/commit/${label})`;
	}
	if (/^\d+\.\d+\.\d+/.test(label)) {
		return `[\`${label}\`](${GITHUB_REPO}/releases/tag/${label})`;
	}
	return `\`${label}\``;
}

/**
 * Build a GitHub compare link between two build identifiers, if both are
 * commit-like or version-like references.  Returns empty string otherwise.
 * @param {string} base
 * @param {string} test
 * @returns {string}
 */
function formatCompareLink(base, test) {
	const isRef = (/** @type {string} */ v) => /^[0-9a-f]{7,40}$/.test(v) || /^\d+\.\d+\.\d+/.test(v);
	if (!isRef(base) || !isRef(test)) {
		return '';
	}
	return `[compare](${GITHUB_REPO}/compare/${base}...${test})`;
}

/**
 * Generate a detailed Markdown summary table for CI.
 * Printed to stdout and written to ci-summary.md.
 *
 * @param {Record<string, any>} jsonReport
 * @param {Record<string, any> | null} baseline
 * @param {{ threshold: number, metricThresholds?: Record<string, number | string>, runs: number, baselineBuild?: string, build?: string }} opts
 */
function generateCISummary(jsonReport, baseline, opts) {
	const baseLabel = opts.baselineBuild || 'baseline';
	const testBuildMode = jsonReport.buildMode || 'dev';
	const testLabel = testBuildMode === 'dev' ? 'dev (local)'
		: testBuildMode === 'production' ? 'production (local)'
			: opts.build || testBuildMode;
	const baseLink = formatBuildLink(baseLabel);
	const testLink = formatBuildLink(testLabel);
	const compareLink = formatCompareLink(baseLabel, testLabel);
	const allMetrics = [
		['timeToFirstToken', 'timing', 'ms'],
		['timeToComplete', 'timing', 'ms'],
		['layoutCount', 'rendering', ''],
		['layoutDurationMs', 'rendering', 'ms'],
		['recalcStyleCount', 'rendering', ''],
		['forcedReflowCount', 'rendering', ''],
		['longTaskCount', 'rendering', ''],
		['longAnimationFrameCount', 'rendering', ''],
		['longAnimationFrameTotalMs', 'rendering', 'ms'],
		['frameCount', 'rendering', ''],
		['compositeLayers', 'rendering', ''],
		['paintCount', 'rendering', ''],
		['heapDelta', 'memory', 'MB'],
		['heapDeltaPostGC', 'memory', 'MB'],
		['gcDurationMs', 'memory', 'ms'],
		['extHostHeapDelta', 'extHost', 'MB'],
		['extHostHeapDeltaPostGC', 'extHost', 'MB'],
	];
	const regressionMetricNames = new Set(['timeToFirstToken', 'timeToComplete', 'layoutDurationMs', 'forcedReflowCount', 'longTaskCount']);

	const lines = [];
	const scenarios = Object.keys(jsonReport.scenarios);

	/** @type {Map<string, { metric: string, verdict: string, change: number, pValue: string, basStr: string, curStr: string }[]>} */
	const scenarioVerdicts = new Map();
	let totalRegressions = 0;
	let totalImprovements = 0;

	for (const scenario of scenarios) {
		const current = jsonReport.scenarios[scenario];
		const base = baseline?.scenarios?.[scenario];
		/** @type {{ metric: string, verdict: string, change: number, pValue: string, basStr: string, curStr: string }[]} */
		const verdicts = [];

		if (base) {
			for (const [metric, group, unit] of allMetrics) {
				const cur = current[group]?.[metric];
				const bas = base[group]?.[metric];
				if (!cur || !bas || bas.median === null || bas.median === undefined) { continue; }

				const change = bas.median !== 0 ? (cur.median - bas.median) / bas.median : 0;
				const isRegressionMetric = regressionMetricNames.has(metric);

				const curRaw = (current.rawRuns || []).map((/** @type {any} */ r) => r[metric]).filter((/** @type {any} */ v) => v >= 0);
				const basRaw = (base.rawRuns || []).map((/** @type {any} */ r) => r[metric]).filter((/** @type {any} */ v) => v >= 0);
				const ttest = welchTTest(basRaw, curRaw);
				const pStr = ttest ? `${ttest.pValue}` : 'n/a';

				const metricThreshold = getMetricThreshold(opts, metric);
				const absoluteDelta = cur.median - bas.median;
				let verdict = '';
				if (isRegressionMetric) {
					if (exceedsThreshold(metricThreshold, change, absoluteDelta)) {
						if (!ttest || ttest.significant) {
							verdict = 'REGRESSION';
							totalRegressions++;
						} else {
							verdict = 'noise';
						}
					} else if (exceedsThreshold(metricThreshold, -change, -absoluteDelta) && ttest?.significant) {
						verdict = 'improved';
						totalImprovements++;
					} else {
						verdict = 'ok';
					}
				} else {
					verdict = 'info';
				}

				const basStr = `${bas.median}${unit} \xb1${bas.stddev}${unit}`;
				const curStr = `${cur.median}${unit} \xb1${cur.stddev}${unit}`;
				verdicts.push({ metric, verdict, change, pValue: pStr, basStr, curStr });
			}
		}
		scenarioVerdicts.set(scenario, verdicts);
	}

	const hasRegressions = totalRegressions > 0;
	const verdictIcon = hasRegressions ? '\u274C' : '\u2705';
	const verdictText = hasRegressions
		? `${totalRegressions} regression(s) detected`
		: totalImprovements > 0
			? `No regressions \u2014 ${totalImprovements} improvement(s)`
			: 'No significant changes';

	lines.push(`# ${verdictIcon} Chat Performance: ${verdictText}`);
	lines.push('');
	lines.push(`| | |`);
	lines.push(`|---|---|`);
	lines.push(`| **Baseline** | ${baseLink} |`);
	lines.push(`| **Test** | ${testLink} |`);
	if (compareLink) {
		lines.push(`| **Diff** | ${compareLink} |`);
	}
	lines.push(`| **Runs per scenario** | ${opts.runs} |`);
	const overrides = Object.entries(opts.metricThresholds || {}).filter(([, v]) => {
		const parsed = parseMetricThreshold(v);
		return parsed.type !== 'fraction' || parsed.value !== opts.threshold;
	});
	if (overrides.length > 0) {
		const overrideStr = overrides.map(([k, v]) => {
			const parsed = parseMetricThreshold(v);
			return `${k}: ${parsed.type === 'absolute' ? `${parsed.value}${k.includes('Ms') || k.includes('Time') || k.includes('time') ? 'ms' : ''}` : `${(parsed.value * 100).toFixed(0)}%`}`;
		}).join(', ');
		lines.push(`| **Regression threshold** | ${(opts.threshold * 100).toFixed(0)}% (${overrideStr}) |`);
	} else {
		lines.push(`| **Regression threshold** | ${(opts.threshold * 100).toFixed(0)}% |`);
	}
	lines.push(`| **Scenarios** | ${scenarios.length} |`);
	lines.push(`| **Platform** | ${process.platform} / ${process.arch} |`);
	if (jsonReport.buildMode) {
		lines.push(`| **Build mode** | ${jsonReport.buildMode} |`);
	}
	lines.push('');
	if (jsonReport.mismatchedBuildMode) {
		lines.push('> **⚠ Build mode mismatch:** The test and baseline builds use different build modes.');
		lines.push('> Results may not be directly comparable. For apples-to-apples comparisons,');
		lines.push('> use the same build type for both (e.g. `--production-build` with a local');
		lines.push('> baseline path, or two version strings).');
		lines.push('');
	}

	lines.push(`## Overview`);
	lines.push('');
	lines.push('| Scenario | Description | TTFT | Complete | Layouts | Styles | LoAF | Verdict |');
	lines.push('|----------|-------------|-----:|---------:|--------:|-------:|-----:|:-------:|');

	for (const scenario of scenarios) {
		const verdicts = scenarioVerdicts.get(scenario) || [];
		const get = (/** @type {string} */ m) => verdicts.find(v => v.metric === m);

		const ttft = get('timeToFirstToken');
		const complete = get('timeToComplete');
		const layouts = get('layoutCount');
		const styles = get('recalcStyleCount');
		const loaf = get('longAnimationFrameCount');

		const fmtCell = (/** @type {{ change: number, verdict: string } | undefined} */ v) => {
			if (!v) { return '\u2014'; }
			const pct = `${v.change > 0 ? '+' : ''}${(v.change * 100).toFixed(0)}%`;
			return pct;
		};

		const fmtVerdict = (/** @type {{ verdict: string, change: number }[]} */ vs) => {
			const hasRegression = vs.some(v => v.verdict === 'REGRESSION');
			const hasImproved = vs.some(v => v.verdict === 'improved');
			if (hasRegression) { return '\u274C Regressed'; }
			if (hasImproved) { return '\u2B06\uFE0F Improved'; }
			return '\u2705 OK';
		};

		const keyVerdicts = [ttft, complete, layouts, styles, loaf].filter(Boolean);
		const rowVerdict = fmtVerdict(/** @type {any[]} */(keyVerdicts));

		lines.push(`| ${scenario} | ${getScenarioDescription(scenario)} | ${fmtCell(ttft)} | ${fmtCell(complete)} | ${fmtCell(layouts)} | ${fmtCell(styles)} | ${fmtCell(loaf)} | ${rowVerdict} |`);
	}
	lines.push('');

	const hasNotable = [...scenarioVerdicts.values()].some(vs => vs.some(v => v.verdict === 'REGRESSION' || v.verdict === 'improved'));
	if (hasNotable) {
		lines.push('## Regressions & Improvements');
		lines.push('');
		lines.push('Only metrics that regressed or improved significantly are shown below.');
		lines.push('');

		for (const scenario of scenarios) {
			const verdicts = scenarioVerdicts.get(scenario) || [];
			const notable = verdicts.filter(v => v.verdict === 'REGRESSION' || v.verdict === 'improved');
			if (notable.length === 0) { continue; }

			const icon = notable.some(v => v.verdict === 'REGRESSION') ? '\u274C' : '\u2B06\uFE0F';
			lines.push(`### ${icon} ${scenario}`);
			lines.push('');
			lines.push('| Metric | Baseline | Test | Change | p-value | Verdict |');
			lines.push('|--------|----------|------|--------|---------|---------|');
			for (const v of notable) {
				const pct = `${v.change > 0 ? '+' : ''}${(v.change * 100).toFixed(1)}%`;
				const verdictIcon = v.verdict === 'REGRESSION' ? '\u274C' : '\u2B06\uFE0F';
				lines.push(`| ${v.metric} | ${v.basStr} | ${v.curStr} | ${pct} | ${v.pValue} | ${verdictIcon} ${v.verdict} |`);
			}
			lines.push('');
		}
	}

	lines.push('<details><summary>Full metric details per scenario</summary>');
	lines.push('');

	for (const scenario of scenarios) {
		const verdicts = scenarioVerdicts.get(scenario) || [];
		const base = baseline?.scenarios?.[scenario];

		lines.push(`### ${scenario}`);
		lines.push('');

		if (!base) {
			const current = jsonReport.scenarios[scenario];
			lines.push('> No baseline data for this scenario.');
			lines.push('');
			lines.push('| Metric | Value | StdDev | CV | n |');
			lines.push('|--------|------:|-------:|---:|--:|');
			for (const [metric, group, unit] of allMetrics) {
				const cur = current[group]?.[metric];
				if (!cur) { continue; }
				lines.push(`| ${metric} | ${cur.median}${unit} | \xb1${cur.stddev}${unit} | ${(cur.cv * 100).toFixed(0)}% | ${cur.n} |`);
			}
			lines.push('');
			continue;
		}

		lines.push(`| Metric | Baseline | Test | Change | p-value | Verdict |`);
		lines.push(`|--------|----------|------|--------|---------|---------|`);

		for (const v of verdicts) {
			const pct = `${v.change > 0 ? '+' : ''}${(v.change * 100).toFixed(1)}%`;
			let verdictDisplay = v.verdict;
			if (v.verdict === 'REGRESSION') { verdictDisplay = '\u274C REGRESSION'; }
			else if (v.verdict === 'improved') { verdictDisplay = '\u2B06\uFE0F improved'; }
			else if (v.verdict === 'ok') { verdictDisplay = '\u2705 ok'; }
			else if (v.verdict === 'noise') { verdictDisplay = '\uD83C\uDF2B\uFE0F noise'; }
			else if (v.verdict === 'info') { verdictDisplay = '\u2139\uFE0F'; }
			lines.push(`| ${v.metric} | ${v.basStr} | ${v.curStr} | ${pct} | ${v.pValue} | ${verdictDisplay} |`);
		}
		lines.push('');
	}
	lines.push('</details>');
	lines.push('');

	lines.push('<details><summary>Raw run data</summary>');
	lines.push('');
	for (const scenario of scenarios) {
		const current = jsonReport.scenarios[scenario];
		lines.push(`### ${scenario}`);
		lines.push('');
		lines.push('| Run | TTFT (ms) | Complete (ms) | Layouts | Style Recalcs | LoAF Count | LoAF (ms) | Frames | Heap Delta (MB) | Internal Marks |');
		lines.push('|----:|----------:|--------------:|--------:|--------------:|-----------:|----------:|-------:|----------------:|:--------------:|');
		const runs = current.rawRuns || [];
		for (let i = 0; i < runs.length; i++) {
			const r = runs[i];
			const round2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
			lines.push(`| ${i + 1} | ${round2(r.timeToFirstToken)} | ${r.timeToComplete} | ${r.layoutCount} | ${r.recalcStyleCount} | ${r.longAnimationFrameCount ?? '-'} | ${r.longAnimationFrameTotalMs !== null && r.longAnimationFrameTotalMs !== undefined ? round2(r.longAnimationFrameTotalMs) : '-'} | ${r.frameCount ?? '-'} | ${r.heapDelta} | ${r.hasInternalMarks ? 'yes' : 'no'} |`);
		}
		lines.push('');
	}
	if (baseline) {
		for (const scenario of scenarios) {
			const base = baseline.scenarios?.[scenario];
			if (!base) { continue; }
			lines.push(`### ${scenario} (baseline)`);
			lines.push('');
			lines.push('| Run | TTFT (ms) | Complete (ms) | Layouts | Style Recalcs | LoAF Count | LoAF (ms) | Frames | Heap Delta (MB) | Internal Marks |');
			lines.push('|----:|----------:|--------------:|--------:|--------------:|-----------:|----------:|-------:|----------------:|:--------------:|');
			const runs = base.rawRuns || [];
			for (let i = 0; i < runs.length; i++) {
				const r = runs[i];
				const round2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
				lines.push(`| ${i + 1} | ${round2(r.timeToFirstToken)} | ${r.timeToComplete} | ${r.layoutCount} | ${r.recalcStyleCount} | ${r.longAnimationFrameCount ?? '-'} | ${r.longAnimationFrameTotalMs !== null && r.longAnimationFrameTotalMs !== undefined ? round2(r.longAnimationFrameTotalMs) : '-'} | ${r.frameCount ?? '-'} | ${r.heapDelta} | ${r.hasInternalMarks ? 'yes' : 'no'} |`);
			}
			lines.push('');
		}
	}
	lines.push('</details>');
	lines.push('');

	return lines.join('\n');
}


/** @type {{ close: () => Promise<void> } | null} */
let activeVSCode = null;
/** @type {{ close: () => Promise<void> } | null} */
let activeMockServer = null;

function installSignalHandlers() {
	const cleanup = async () => {
		console.log('\n[chat-simulation] Caught interrupt, cleaning up...');
		try { await activeVSCode?.close(); } catch { }
		try { await activeMockServer?.close(); } catch { }
		process.exit(130);
	};
	process.on('SIGINT', cleanup);
	process.on('SIGTERM', cleanup);
}


/**
 * Remove large diagnostic files (heap snapshots, CPU profiles, traces) from
 * a run's metrics to free disk space.  Keeps the JSON results data intact.
 * @param {RunMetrics} metrics
 */
function cleanupRunDiagnostics(metrics) {
	const filesToDelete = [
		metrics.profilePath,
		metrics.tracePath,
		metrics.snapshotPath,
		metrics.extHostProfilePath,
		metrics.extHostSnapshotPath,
	];
	for (const filePath of filesToDelete) {
		if (filePath && fs.existsSync(filePath)) {
			try {
				fs.rmSync(filePath, { force: true });
			} catch {
			}
		}
	}
}

/**
 * Clean up diagnostics for all scenarios that did NOT regress.
 * Keeps diagnostics for regressed scenarios so they can be investigated.
 * @param {Record<string, RunMetrics[]>} allResults - test results by scenario
 * @param {Set<string>} regressedScenarios - scenarios that regressed
 */
function cleanupNonRegressedDiagnostics(allResults, regressedScenarios) {
	for (const [scenario, runs] of Object.entries(allResults)) {
		if (regressedScenarios.has(scenario)) {
			continue;
		}
		for (const metrics of runs) {
			cleanupRunDiagnostics(metrics);
		}
	}
}


async function main() {
	registerPerfScenarios();
	const opts = parseArgs();

	installSignalHandlers();

	const { startServer } = require('./common/mock-llm-server.ts');
	const mockServer = await startServer(0);
	activeMockServer = mockServer;
	console.log(`[chat-simulation] Mock LLM server: ${mockServer.url}`);

	if (opts.resume) {
		if (!fs.existsSync(opts.resume)) {
			console.error(`[chat-simulation] Resume file not found: ${opts.resume}`);
			process.exit(1);
		}
		const prevResults = JSON.parse(fs.readFileSync(opts.resume, 'utf-8'));
		const prevDir = path.dirname(opts.resume);

		const baselineFiles = fs.readdirSync(prevDir).filter((/** @type {string} */ f) => f.startsWith('baseline-') && f.endsWith('.json'));
		const baselineFile = baselineFiles.length > 0 ? path.join(prevDir, baselineFiles[0]) : null;
		const prevBaseline = baselineFile ? JSON.parse(fs.readFileSync(baselineFile, 'utf-8')) : null;

		const resumeScenarios = opts.scenarios.length > 0
			? opts.scenarios.filter(s => prevResults.scenarios?.[s])
			: Object.keys(prevResults.scenarios || {});

		if (resumeScenarios.length === 0) {
			console.error('[chat-simulation] No matching scenarios found in previous results');
			process.exit(1);
		}

		const testElectron = await resolveBuild(opts.build);
		const baselineVersion = prevBaseline?.baselineBuildVersion;
		const baselineElectron = baselineVersion ? await resolveBuild(baselineVersion) : null;

		const runsToAdd = opts.runs;
		console.log(`[chat-simulation] Resuming from: ${opts.resume}`);
		console.log(`[chat-simulation] Adding ${runsToAdd} runs per scenario`);
		console.log(`[chat-simulation] Scenarios: ${resumeScenarios.join(', ')}`);
		if (prevBaseline) {
			console.log(`[chat-simulation] Baseline: ${baselineVersion} (${prevBaseline.scenarios?.[resumeScenarios[0]]?.rawRuns?.length || 0} existing runs)`);
		}
		console.log('');

		for (const scenario of resumeScenarios) {
			console.log(`[chat-simulation] === Resuming: ${scenario} ===`);
			const prevTestRuns = prevResults.scenarios[scenario]?.rawRuns || [];
			const prevBaseRuns = prevBaseline?.scenarios?.[scenario]?.rawRuns || [];

			console.log(`[chat-simulation]   Test build (${prevTestRuns.length} existing + ${runsToAdd} new)`);
			for (let i = 0; i < runsToAdd; i++) {
				const runIdx = `${scenario}-resume-${prevTestRuns.length + i}`;
				console.log(`[chat-simulation]     Run ${i + 1}/${runsToAdd}...`);
				try {
					const m = await runOnce(testElectron, scenario, mockServer, opts.verbose, runIdx, prevDir, 'test', { ...opts.settingsOverrides, ...opts.testSettingsOverrides }, { heapSnapshots: opts.heapSnapshots, gcObjectStats: opts.gcObjectStats });
					if (opts.cleanupDiagnostics && prevTestRuns.length > 0) { cleanupRunDiagnostics(prevTestRuns[prevTestRuns.length - 1]); }
					prevTestRuns.push(m);
					if (opts.verbose) {
						const src = m.hasInternalMarks ? 'internal' : 'client-side';
						console.log(`      [${src}] firstToken=${m.timeToFirstToken}ms, complete=${m.timeToComplete}ms`);
					}
				} catch (err) { console.error(`      Run ${i + 1} failed: ${err}`); }
			}

			if (baselineElectron && prevBaseline?.scenarios?.[scenario]) {
				console.log(`[chat-simulation]   Baseline build (${prevBaseRuns.length} existing + ${runsToAdd} new)`);
				for (let i = 0; i < runsToAdd; i++) {
					const runIdx = `baseline-${scenario}-resume-${prevBaseRuns.length + i}`;
					console.log(`[chat-simulation]     Run ${i + 1}/${runsToAdd}...`);
					try {
						const m = await runOnce(baselineElectron, scenario, mockServer, opts.verbose, runIdx, prevDir, 'baseline', { ...opts.settingsOverrides, ...opts.baselineSettingsOverrides }, { heapSnapshots: opts.heapSnapshots, gcObjectStats: opts.gcObjectStats });
						if (opts.cleanupDiagnostics && prevBaseRuns.length > 0) { cleanupRunDiagnostics(prevBaseRuns[prevBaseRuns.length - 1]); }
						prevBaseRuns.push(m);
					} catch (err) { console.error(`      Run ${i + 1} failed: ${err}`); }
				}
			}

			const sd = /** @type {any} */ ({ runs: prevTestRuns.length, timing: {}, memory: {}, rendering: {}, extHost: {}, rawRuns: prevTestRuns });
			for (const [metric, group] of METRIC_DEFS) { sd[group][metric] = robustStats(prevTestRuns.map((/** @type {any} */ r) => r[metric])); }
			prevResults.scenarios[scenario] = sd;

			if (prevBaseline?.scenarios?.[scenario]) {
				const bsd = /** @type {any} */ ({ runs: prevBaseRuns.length, timing: {}, memory: {}, rendering: {}, extHost: {}, rawRuns: prevBaseRuns });
				for (const [metric, group] of METRIC_DEFS) { bsd[group][metric] = robustStats(prevBaseRuns.map((/** @type {any} */ r) => r[metric])); }
				prevBaseline.scenarios[scenario] = bsd;
			}
			console.log(`[chat-simulation]   Merged: test n=${prevTestRuns.length}${prevBaseRuns.length > 0 ? `, baseline n=${prevBaseRuns.length}` : ''}`);
			console.log('');
		}

		prevResults.runsPerScenario = Math.max(prevResults.runsPerScenario || 0, ...Object.values(prevResults.scenarios).map((/** @type {any} */ s) => s.runs));
		prevResults.lastResumed = new Date().toISOString();
		fs.writeFileSync(opts.resume, JSON.stringify(prevResults, null, 2));
		console.log(`[chat-simulation] Updated results: ${opts.resume}`);

		if (prevBaseline && baselineFile) {
			prevBaseline.lastResumed = new Date().toISOString();
			fs.writeFileSync(baselineFile, JSON.stringify(prevBaseline, null, 2));
			const cachedPath = path.join(DATA_DIR, path.basename(baselineFile));
			fs.writeFileSync(cachedPath, JSON.stringify(prevBaseline, null, 2));
			console.log(`[chat-simulation] Updated baseline: ${baselineFile}`);
		}

		opts.baseline = baselineFile || undefined;
		const jsonReport = prevResults;
		jsonReport._resultsPath = opts.resume;

		await printComparison(jsonReport, opts);
		await mockServer.close();
		return;
	}

	if (opts.productionBuild && !opts.build) {
		const prodBuildPath = buildProductionBuild();
		opts.build = prodBuildPath;
		console.log(`[chat-simulation] --production-build: using local production build at ${prodBuildPath}`);
	}

	const electronPath = await resolveBuild(opts.build);

	if (!fs.existsSync(electronPath)) {
		console.error(`Electron not found at: ${electronPath}`);
		console.error('Run "node build/lib/preLaunch.ts" first, or pass --build <path>');
		process.exit(1);
	}

	const testBuildMode = detectBuildMode(electronPath);

	const isBaselineVersionString = opts.baselineBuild && isVersionString(opts.baselineBuild);
	const isBaselineLocalPath = opts.baselineBuild && !isBaselineVersionString;
	/** @type {string | undefined} */
	let baselineElectronPath;
	if (isBaselineLocalPath) {
		baselineElectronPath = await resolveBuild(opts.baselineBuild);
		if (!fs.existsSync(baselineElectronPath)) {
			console.error(`Baseline build not found at: ${baselineElectronPath}`);
			process.exit(1);
		}
	}
	const baselineBuildMode = opts.baselineBuild
		? (isBaselineVersionString ? 'release' : detectBuildMode(baselineElectronPath || ''))
		: undefined;

	const isMismatchedBuildMode = baselineBuildMode !== undefined && testBuildMode !== baselineBuildMode;

	const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const runDir = path.join(DATA_DIR, runTimestamp);
	fs.mkdirSync(runDir, { recursive: true });
	console.log(`[chat-simulation] Output: ${runDir}`);

	const testSettings = { ...opts.settingsOverrides, ...opts.testSettingsOverrides };
	const baselineSettings = { ...opts.settingsOverrides, ...opts.baselineSettingsOverrides };

	if (opts.baselineBuild) {
		const baselineLabel = isBaselineLocalPath
			? path.basename(path.resolve(opts.baselineBuild))
			: opts.baselineBuild;
		const baselineJsonPath = path.join(runDir, `baseline-${baselineLabel}.json`);

		const cachedPath = isBaselineLocalPath ? null : path.join(DATA_DIR, `baseline-${baselineLabel}.json`);
		const cachedBaseline = cachedPath && !opts.noCache && fs.existsSync(cachedPath)
			? JSON.parse(fs.readFileSync(cachedPath, 'utf-8'))
			: null;

		if (cachedBaseline?.baselineBuildVersion === opts.baselineBuild) {
			const cachedScenarios = new Set(Object.keys(cachedBaseline.scenarios || {}));
			const missingScenarios = opts.scenarios.filter((/** @type {string} */ s) => !cachedScenarios.has(s));

			const shortScenarios = opts.scenarios.filter((/** @type {string} */ s) => {
				const cached = cachedBaseline.scenarios?.[s];
				return cached && (cached.rawRuns?.length || 0) < opts.runs;
			});

			if (missingScenarios.length === 0 && shortScenarios.length === 0) {
				console.log(`[chat-simulation] Using cached baseline for ${opts.baselineBuild}`);
				fs.writeFileSync(baselineJsonPath, JSON.stringify(cachedBaseline, null, 2));
				opts.baseline = baselineJsonPath;
			} else {
				const scenariosToRun = [...new Set([...missingScenarios, ...shortScenarios])];
				if (missingScenarios.length > 0) {
					console.log(`[chat-simulation] Cached baseline missing scenarios: ${missingScenarios.join(', ')}`);
				}
				if (shortScenarios.length > 0) {
					console.log(`[chat-simulation] Cached baseline needs more runs for: ${shortScenarios.map((/** @type {string} */ s) => `${s} (${cachedBaseline.scenarios[s].rawRuns?.length || 0}/${opts.runs})`).join(', ')}`);
				}
				console.log(`[chat-simulation] Running baseline for ${scenariosToRun.length} scenario(s)...`);
				const baselineExePath = baselineElectronPath || await resolveBuild(opts.baselineBuild);
				for (const scenario of scenariosToRun) {
					const existingRuns = cachedBaseline.scenarios?.[scenario]?.rawRuns || [];
					const runsNeeded = opts.runs - existingRuns.length;
					/** @type {RunMetrics[]} */
					const newResults = [];
					for (let i = 0; i < runsNeeded; i++) {
						try {
							const m = await runOnce(baselineExePath, scenario, mockServer, opts.verbose, `baseline-${scenario}-${existingRuns.length + i}`, runDir, 'baseline', baselineSettings, { heapSnapshots: opts.heapSnapshots, gcObjectStats: opts.gcObjectStats });
							if (opts.cleanupDiagnostics && newResults.length > 0) { cleanupRunDiagnostics(newResults[newResults.length - 1]); }
							newResults.push(m);
						}
						catch (err) { console.error(`[chat-simulation]   Baseline run ${i + 1} failed: ${err}`); }
					}
					const allRuns = [...existingRuns, ...newResults];
					if (allRuns.length > 0) {
						const sd = /** @type {any} */ ({ runs: allRuns.length, timing: {}, memory: {}, rendering: {}, extHost: {}, rawRuns: allRuns });
						for (const [metric, group] of METRIC_DEFS) { sd[group][metric] = robustStats(allRuns.map((/** @type {any} */ r) => r[metric])); }
						cachedBaseline.scenarios[scenario] = sd;
					}
				}
				cachedBaseline.runsPerScenario = opts.runs;
				fs.writeFileSync(baselineJsonPath, JSON.stringify(cachedBaseline, null, 2));
				if (cachedPath) {
					fs.writeFileSync(cachedPath, JSON.stringify(cachedBaseline, null, 2));
				}
				opts.baseline = baselineJsonPath;
			}
		} else {
			const baselineExePath = baselineElectronPath || await resolveBuild(opts.baselineBuild);
			console.log(`[chat-simulation] Benchmarking baseline build (${baselineLabel})...`);
			/** @type {Record<string, RunMetrics[]>} */
			const baselineResults = {};
			for (const scenario of opts.scenarios) {
				/** @type {RunMetrics[]} */
				const results = [];
				for (let i = 0; i < opts.runs; i++) {
					try {
						const m = await runOnce(baselineExePath, scenario, mockServer, opts.verbose, `baseline-${scenario}-${i}`, runDir, 'baseline', baselineSettings, { heapSnapshots: opts.heapSnapshots, gcObjectStats: opts.gcObjectStats });
						if (opts.cleanupDiagnostics && results.length > 0) { cleanupRunDiagnostics(results[results.length - 1]); }
						results.push(m);
					}
					catch (err) { console.error(`[chat-simulation]   Baseline run ${i + 1} failed: ${err}`); }
				}
				if (results.length > 0) { baselineResults[scenario] = results; }
			}
			const baselineReport = {
				timestamp: new Date().toISOString(),
				baselineBuildVersion: opts.baselineBuild,
				platform: process.platform,
				runsPerScenario: opts.runs,
				scenarios: /** @type {Record<string, any>} */ ({}),
			};
			for (const [scenario, results] of Object.entries(baselineResults)) {
				const sd = /** @type {any} */ ({ runs: results.length, timing: {}, memory: {}, rendering: {}, extHost: {}, rawRuns: results });
				for (const [metric, group] of METRIC_DEFS) { sd[group][metric] = robustStats(results.map(r => /** @type {any} */(r)[metric])); }
				baselineReport.scenarios[scenario] = sd;
			}
			fs.writeFileSync(baselineJsonPath, JSON.stringify(baselineReport, null, 2));
			if (cachedPath) {
				fs.writeFileSync(cachedPath, JSON.stringify(baselineReport, null, 2));
			}
			opts.baseline = baselineJsonPath;
		}
		console.log('');
	}

	console.log(`[chat-simulation] Electron: ${electronPath}`);
	console.log(`[chat-simulation] Build mode: ${buildModeLabel(testBuildMode)}`);
	if (baselineBuildMode) {
		console.log(`[chat-simulation] Baseline mode: ${buildModeLabel(baselineBuildMode)}`);
	}
	console.log(`[chat-simulation] Runs per scenario: ${opts.runs}`);
	console.log(`[chat-simulation] Scenarios: ${opts.scenarios.join(', ')}`);
	if (Object.keys(opts.settingsOverrides).length > 0) {
		console.log(`[chat-simulation] Settings overrides (all): ${JSON.stringify(opts.settingsOverrides)}`);
	}
	if (Object.keys(opts.testSettingsOverrides).length > 0) {
		console.log(`[chat-simulation] Settings overrides (test): ${JSON.stringify(opts.testSettingsOverrides)}`);
	}
	if (Object.keys(opts.baselineSettingsOverrides).length > 0) {
		console.log(`[chat-simulation] Settings overrides (baseline): ${JSON.stringify(opts.baselineSettingsOverrides)}`);
	}

	if (isMismatchedBuildMode) {
		console.log('');
		console.log(`[chat-simulation] ⚠ WARNING: Build mode mismatch — test is ${testBuildMode}, baseline is ${baselineBuildMode}.`);
		console.log('[chat-simulation]   Results may not be directly comparable. For apples-to-apples');
		console.log('[chat-simulation]   comparisons, use the same build type for both.');
		if (testBuildMode === 'dev') {
			console.log('[chat-simulation]   To use a local production build instead:');
			console.log('[chat-simulation]     npm run perf:chat -- --production-build');
		}
		if (!opts.ci && !opts.force) {
			const readline = require('readline');
			const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
			const answer = await new Promise(resolve => rl.question('[chat-simulation] Continue anyway? [y/N] ', resolve));
			rl.close();
			if (String(answer).toLowerCase() !== 'y') {
				console.log('[chat-simulation] Aborted.');
				await mockServer.close();
				process.exit(0);
			}
		}
	}
	console.log('');

	/** @type {Record<string, RunMetrics[]>} */
	const allResults = {};
	let anyFailed = false;

	for (const scenario of opts.scenarios) {
		console.log(`[chat-simulation] === Scenario: ${scenario} ===`);
		/** @type {RunMetrics[]} */
		const results = [];
		for (let i = 0; i < opts.runs; i++) {
			console.log(`[chat-simulation]   Run ${i + 1}/${opts.runs}...`);
			try {
				const metrics = await runOnce(electronPath, scenario, mockServer, opts.verbose, `${scenario}-${i}`, runDir, 'test', testSettings, { heapSnapshots: opts.heapSnapshots, gcObjectStats: opts.gcObjectStats });
				if (opts.cleanupDiagnostics && results.length > 0) { cleanupRunDiagnostics(results[results.length - 1]); }
				results.push(metrics);
				if (opts.verbose) {
					const src = metrics.hasInternalMarks ? 'internal' : 'client-side';
					console.log(`    [${src}] firstToken=${metrics.timeToFirstToken}ms, complete=${metrics.timeToComplete}ms, heap=delta${metrics.heapDelta}MB, longTasks=${metrics.longTaskCount}${metrics.hasInternalMarks ? `, internalTTFT=${metrics.internalFirstToken}ms` : ''}`);
				}
			} catch (err) { console.error(`    Run ${i + 1} failed: ${err}`); }
		}
		if (results.length === 0) { console.error(`[chat-simulation]   All runs failed for scenario: ${scenario}`); anyFailed = true; }
		else { allResults[scenario] = results; }
		console.log('');
	}

	console.log('[chat-simulation] ======================= Summary =======================');
	for (const [scenario, results] of Object.entries(allResults)) {
		console.log('');
		console.log(`  -- ${scenario} (${results.length} runs) --`);
		console.log('');
		console.log('  Timing:');
		console.log(summarize(results.map(r => r.timeToFirstToken), '  Request → First token ', 'ms'));
		console.log(summarize(results.map(r => r.timeToComplete), '  Request → Complete    ', 'ms'));
		console.log(summarize(results.map(r => r.timeToRenderComplete), '  Request → Rendered    ', 'ms'));
		console.log('');
		console.log('  Rendering:');
		console.log(summarize(results.map(r => r.layoutCount), '  Layouts               ', ''));
		console.log(summarize(results.map(r => r.layoutDurationMs), '  Layout duration       ', 'ms'));
		console.log(summarize(results.map(r => r.recalcStyleCount), '  Style recalcs         ', ''));
		console.log(summarize(results.map(r => r.forcedReflowCount), '  Forced reflows        ', ''));
		console.log(summarize(results.map(r => r.longTaskCount), '  Long tasks (>50ms)    ', ''));
		console.log(summarize(results.map(r => r.longAnimationFrameCount), '  Long anim. frames     ', ''));
		console.log(summarize(results.map(r => r.longAnimationFrameTotalMs), '  LoAF total duration   ', 'ms'));
		console.log(summarize(results.map(r => r.frameCount), '  Frames                ', ''));
		console.log(summarize(results.map(r => r.compositeLayers), '  Composite layers      ', ''));
		console.log(summarize(results.map(r => r.paintCount), '  Paints                ', ''));
		console.log('');
		console.log('  Memory:');
		console.log(summarize(results.map(r => r.heapDelta), '  Heap delta            ', 'MB'));
		console.log(summarize(results.map(r => r.heapDeltaPostGC), '  Heap delta (post-GC)  ', 'MB'));
		console.log(summarize(results.map(r => r.gcDurationMs), '  GC duration           ', 'ms'));
		if (results.some(r => r.extHostHeapDelta >= 0)) {
			console.log('');
			console.log('  Extension Host:');
			console.log(summarize(results.map(r => r.extHostHeapUsedBefore), '  Heap before           ', 'MB'));
			console.log(summarize(results.map(r => r.extHostHeapUsedAfter), '  Heap after            ', 'MB'));
			console.log(summarize(results.map(r => r.extHostHeapDelta), '  Heap delta            ', 'MB'));
			console.log(summarize(results.map(r => r.extHostHeapDeltaPostGC), '  Heap delta (post-GC)  ', 'MB'));
		}
	}

	const jsonPath = path.join(runDir, 'results.json');
	const jsonReport = /** @type {{ timestamp: string, platform: NodeJS.Platform, runsPerScenario: number, buildMode: string, mismatchedBuildMode: boolean, scenarios: Record<string, any>, _resultsPath?: string }} */ ({
		timestamp: new Date().toISOString(),
		platform: process.platform,
		runsPerScenario: opts.runs,
		buildMode: testBuildMode,
		mismatchedBuildMode: !!isMismatchedBuildMode,
		scenarios: /** @type {Record<string, any>} */ ({}),
	});
	for (const [scenario, results] of Object.entries(allResults)) {
		const sd = /** @type {any} */ ({ runs: results.length, timing: {}, memory: {}, rendering: {}, extHost: {}, rawRuns: results });
		for (const [metric, group] of METRIC_DEFS) { sd[group][metric] = robustStats(results.map(r => /** @type {any} */(r)[metric])); }
		jsonReport.scenarios[scenario] = sd;
	}
	fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
	jsonReport._resultsPath = jsonPath;
	console.log('');
	console.log(`[chat-simulation] Results written to ${jsonPath}`);

	if (opts.saveBaseline) {
		if (!opts.baseline) { console.error('[chat-simulation] --save-baseline requires --baseline <path>'); process.exit(1); }
		fs.writeFileSync(opts.baseline, JSON.stringify(jsonReport, null, 2));
		console.log(`[chat-simulation] Baseline saved to ${opts.baseline}`);
	}

	const regressedScenarios = await printComparison(jsonReport, opts);

	if (opts.cleanupDiagnostics) {
		cleanupNonRegressedDiagnostics(allResults, regressedScenarios);
	}

	if (anyFailed) { process.exit(1); }
	await mockServer.close();
}

/**
 * Print baseline comparison and exit with code 1 if regressions found.
 * Returns the set of scenario IDs that regressed.
 * @param {Record<string, any>} jsonReport
 * @param {{ threshold: number, metricThresholds?: Record<string, number | string>, baseline?: string, ci?: boolean, resume?: string, build?: string, baselineBuild?: string, runs: number, cleanupDiagnostics?: boolean }} opts
 * @returns {Promise<Set<string>>}
 */
async function printComparison(jsonReport, opts) {
	let regressionFound = false;
	let inconclusiveFound = false;
	/** @type {Set<string>} */
	const regressedScenarios = new Set();
	if (opts.baseline && fs.existsSync(opts.baseline)) {
		const baseline = JSON.parse(fs.readFileSync(opts.baseline, 'utf-8'));
		console.log('');
		console.log(`[chat-simulation] =========== Baseline Comparison (threshold: ${(opts.threshold * 100).toFixed(0)}%) ===========`);
		console.log(`[chat-simulation] Baseline: ${baseline.baselineBuildVersion || baseline.timestamp}`);
		if (jsonReport.mismatchedBuildMode) {
			console.log(`[chat-simulation] ⚠ Note: build mode mismatch — test is ${jsonReport.buildMode}, baseline differs.`);
			console.log('[chat-simulation]   Results may not be directly comparable.');
		}
		console.log('');

		const regressionMetrics = [
			['timeToFirstToken', 'timing', 'ms'],
			['timeToComplete', 'timing', 'ms'],
			['layoutDurationMs', 'rendering', 'ms'],
			['forcedReflowCount', 'rendering', ''],
			['longTaskCount', 'rendering', ''],
		];
		const infoMetrics = [
			['layoutCount', 'rendering', ''],
			['recalcStyleCount', 'rendering', ''],
			['heapDelta', 'memory', 'MB'],
			['gcDurationMs', 'memory', 'ms'],
			['extHostHeapDelta', 'extHost', 'MB'],
			['extHostHeapDeltaPostGC', 'extHost', 'MB'],
		];

		for (const scenario of Object.keys(jsonReport.scenarios)) {
			const current = jsonReport.scenarios[scenario];
			const base = baseline.scenarios?.[scenario];
			if (!base) { console.log(`  ${scenario}: (no baseline)`); continue; }

			/** @type {string[]} */
			const diffs = [];
			let scenarioRegression = false;

			for (const [metric, group, unit] of regressionMetrics) {
				const cur = current[group]?.[metric];
				const bas = base[group]?.[metric];
				if (!cur || !bas || !bas.median) { continue; }
				const change = (cur.median - bas.median) / bas.median;
				const pct = `${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;

				const curRaw = (current.rawRuns || []).map((/** @type {any} */ r) => r[metric]).filter((/** @type {any} */ v) => v >= 0);
				const basRaw = (base.rawRuns || []).map((/** @type {any} */ r) => r[metric]).filter((/** @type {any} */ v) => v >= 0);
				const ttest = welchTTest(basRaw, curRaw);

				const metricThreshold = getMetricThreshold(opts, metric);
				const absoluteDelta = cur.median - bas.median;
				let flag = '';
				if (exceedsThreshold(metricThreshold, change, absoluteDelta)) {
					if (!ttest) {
						flag = ' ← possible regression (n too small for significance test)';
						inconclusiveFound = true;
					} else if (ttest.significant) {
						flag = ` ← REGRESSION (p=${ttest.pValue}, ${ttest.confidence} confidence)`;
						scenarioRegression = true;
						regressionFound = true;
					} else {
						flag = ` (likely noise — p=${ttest.pValue}, not significant)`;
						inconclusiveFound = true;
					}
				} else if (ttest && change > 0 && ttest.significant && ttest.confidence === 'high') {
					flag = ` (significant increase, p=${ttest.pValue})`;
				}
				diffs.push(`    ${metric}: ${bas.median}${unit} → ${cur.median}${unit} (${pct})${flag}`);
			}
			for (const [metric, group, unit] of infoMetrics) {
				const cur = current[group]?.[metric];
				const bas = base[group]?.[metric];
				if (!cur || !bas || bas.median === null || bas.median === undefined) { continue; }
				const change = bas.median !== 0 ? (cur.median - bas.median) / bas.median : 0;
				const pct = `${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}%`;
				diffs.push(`    ${metric}: ${bas.median}${unit} → ${cur.median}${unit} (${pct}) [info]`);
			}
			console.log(`  ${scenario}: ${scenarioRegression ? 'FAIL' : 'OK'}`);
			if (scenarioRegression) { regressedScenarios.add(scenario); }
			diffs.forEach(d => console.log(d));
		}

		console.log('');
		console.log(regressionFound
			? `[chat-simulation] REGRESSION DETECTED — exceeded ${(opts.threshold * 100).toFixed(0)}% threshold with statistical significance`
			: `[chat-simulation] All metrics within ${(opts.threshold * 100).toFixed(0)}% of baseline (or not statistically significant)`);

		if (inconclusiveFound && !regressionFound) {
			const resultsPath = Object.keys(jsonReport.scenarios).length > 0
				? (jsonReport._resultsPath || opts.resume || 'path/to/results.json')
				: 'path/to/results.json';
			let maxNeeded = 0;
			for (const scenario of Object.keys(jsonReport.scenarios)) {
				const current = jsonReport.scenarios[scenario];
				const base = baseline.scenarios?.[scenario];
				if (!base) { continue; }
				for (const [metric, group] of [['timeToFirstToken', 'timing'], ['timeToComplete', 'timing'], ['layoutCount', 'rendering'], ['recalcStyleCount', 'rendering']]) {
					const curRaw = (current.rawRuns || []).map((/** @type {any} */ r) => r[metric]).filter((/** @type {any} */ v) => v >= 0);
					const basRaw = (base.rawRuns || []).map((/** @type {any} */ r) => r[metric]).filter((/** @type {any} */ v) => v >= 0);
					if (curRaw.length < 2 || basRaw.length < 2) { continue; }
					const meanA = basRaw.reduce((/** @type {number} */ s, /** @type {number} */ v) => s + v, 0) / basRaw.length;
					const meanB = curRaw.reduce((/** @type {number} */ s, /** @type {number} */ v) => s + v, 0) / curRaw.length;
					const varA = basRaw.reduce((/** @type {number} */ s, /** @type {number} */ v) => s + (v - meanA) ** 2, 0) / (basRaw.length - 1);
					const varB = curRaw.reduce((/** @type {number} */ s, /** @type {number} */ v) => s + (v - meanB) ** 2, 0) / (curRaw.length - 1);
					const pooledSD = Math.sqrt((varA + varB) / 2);
					if (pooledSD === 0) { continue; }
					const d = Math.abs(meanB - meanA) / pooledSD;
					if (d === 0) { continue; }
					const nPerGroup = Math.ceil(2 * ((1.96 + 0.842) / d) ** 2);
					const currentN = Math.min(curRaw.length, basRaw.length);
					maxNeeded = Math.max(maxNeeded, nPerGroup - currentN);
				}
			}
			const suggestedRuns = Math.max(1, Math.min(maxNeeded, 20));
			console.log('');
			console.log('[chat-simulation] Some metrics exceeded the threshold but were not statistically significant.');
			console.log('[chat-simulation] To increase confidence, add more runs with --resume:');
			console.log(`[chat-simulation]   npm run perf:chat -- --resume ${resultsPath} --runs ${suggestedRuns}`);
		}
	}

	if (opts.ci) {
		const ciBaseline = opts.baseline && fs.existsSync(opts.baseline)
			? JSON.parse(fs.readFileSync(opts.baseline, 'utf-8'))
			: null;
		const summary = generateCISummary(jsonReport, ciBaseline, {
			threshold: opts.threshold,
			metricThresholds: opts.metricThresholds,
			runs: jsonReport.runsPerScenario || opts.runs,
			baselineBuild: ciBaseline?.baselineBuildVersion || opts.baselineBuild,
			build: opts.build,
		});

		const summaryPath = path.join(DATA_DIR, 'ci-summary.md');
		fs.writeFileSync(summaryPath, summary);
		console.log(`[chat-simulation] CI summary written to ${summaryPath}`);

		console.log('');
		console.log('==================================================================');
		console.log('               CHAT PERF COMPARISON RESULTS                       ');
		console.log('==================================================================');
		console.log('');
		console.log(summary);
	}

	if (regressionFound) { process.exit(1); }
	return regressedScenarios;
}

main().catch(err => { console.error(err); process.exit(1); });
