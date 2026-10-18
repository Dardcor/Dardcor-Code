/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

























const fs = require('fs');
const path = require('path');
const {
	DATA_DIR, loadConfig,
	resolveBuild, buildEnv, buildArgs, prepareRunDir,
	launchVSCode,
} = require('./common/utils');
const {
	CONTENT_SCENARIOS, TOOL_CALL_SCENARIOS, MULTI_TURN_SCENARIOS,
} = require('./common/perf-scenarios');
const {
	getUserTurns, getModelTurnCount,
} = require('./common/mock-llm-server.ts');


const CONFIG = loadConfig('memLeaks');


function parseArgs() {
	const args = process.argv.slice(2);
	const opts = {
		iterations: CONFIG.iterations ?? 3,
		messages: CONFIG.messages ?? 5,
		verbose: false,
		ci: false,

		build: undefined,
		leakThresholdMB: CONFIG.leakThresholdMB ?? 5,

		settingsOverrides: {},
	};
	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--iterations': opts.iterations = parseInt(args[++i], 10); break;
			case '--messages': case '-n': opts.messages = parseInt(args[++i], 10); break;
			case '--verbose': opts.verbose = true; break;
			case '--ci': opts.ci = true; break;
			case '--build': case '-b': opts.build = args[++i]; break;
			case '--threshold': opts.leakThresholdMB = parseFloat(args[++i]); break;
			case '--setting': {
				const kv = args[++i];
				const eq = kv.indexOf('=');
				if (eq === -1) { console.error(`--setting requires key=value, got: ${kv}`); process.exit(1); }
				const key = kv.slice(0, eq);
				const raw = kv.slice(eq + 1);
				const val = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
				opts.settingsOverrides[key] = val;
				break;
			}
			case '--help': case '-h':
				console.log([
					'Chat memory leak checker (state-based)',
					'',
					'Options:',
					'  --iterations <n>    Number of open→work→reset cycles (default: 3)',
					'  --messages <n>      Messages to send per iteration (default: 5)',
					'  --ci                CI mode: write Markdown summary to ci-summary.md',
					'  --build <path|ver>  Path to VS Code build or version to download',
					'  --threshold <MB>    Max total residual heap growth in MB (default: 5)',
					'  --setting <k=v>     Set a VS Code setting override (repeatable)',
					'  --verbose           Print per-step details',
				].join('\n'));
				process.exit(0);
		}
	}
	return opts;
}










function getScenarioIds() {
	return [
		...Object.keys(CONTENT_SCENARIOS),
		...Object.keys(TOOL_CALL_SCENARIOS),
		...Object.keys(MULTI_TURN_SCENARIOS),
	];
}


const CHAT_VIEW = 'div[id="workbench.panel.chat"]';
const CHAT_EDITOR_SEL = `${CHAT_VIEW} .interactive-input-part .monaco-editor[role="code"]`;






async function measure(cdp, page) {
	await cdp.send('HeapProfiler.collectGarbage');
	await new Promise(r => setTimeout(r, 500));
	await cdp.send('HeapProfiler.collectGarbage');
	await new Promise(r => setTimeout(r, 300));
	const heapInfo = /** @type {any} */ (await cdp.send('Runtime.getHeapUsage'));
	const heapMB = Math.round(heapInfo.usedSize / 1024 / 1024 * 100) / 100;
	const domNodes = await page.evaluate(() => document.querySelectorAll('*').length);
	return { heapMB, domNodes };
}





async function openNewChat(page) {
	const newChatShortcut = process.platform === 'darwin' ? 'Meta+KeyL' : 'Control+KeyL';
	await page.keyboard.press(newChatShortcut);
	await new Promise(r => setTimeout(r, 1000));

	await page.waitForSelector(CHAT_VIEW, { timeout: 15_000 });
	await page.waitForFunction(
		(sel) => Array.from(document.querySelectorAll(sel)).some(el => el.getBoundingClientRect().width > 0),
		CHAT_EDITOR_SEL, { timeout: 15_000 },
	);
	await new Promise(r => setTimeout(r, 500));
}











async function sendMessage(page, mockServer, text, modelTurns = 1) {
	await page.click(CHAT_EDITOR_SEL);
	await new Promise(r => setTimeout(r, 200));

	const inputSel = await page.evaluate((editorSel) => {
		const ed = document.querySelector(editorSel);
		if (!ed) { throw new Error('no editor'); }
		return ed.querySelector('.native-edit-context') ? editorSel + ' .native-edit-context' : editorSel + ' textarea';
	}, CHAT_EDITOR_SEL);

	const hasDriver = await page.evaluate(() =>
		// @ts-ignore
		!!globalThis.driver?.typeInEditor
	).catch(() => false);

	if (hasDriver) {
		await page.evaluate(({ selector, t }) => {
			// @ts-ignore
			return globalThis.driver.typeInEditor(selector, t);
		}, { selector: inputSel, t: text });
	} else {
		await page.click(inputSel);
		await new Promise(r => setTimeout(r, 200));
		await page.locator(inputSel).pressSequentially(text, { delay: 0 });
	}

	const compBefore = mockServer.completionCount();
	await page.keyboard.press('Enter');
	try { await mockServer.waitForCompletion(compBefore + modelTurns, 60_000); } catch { }

	const responseSelector = `${CHAT_VIEW} .interactive-item-container.interactive-response`;
	await page.waitForFunction(
		(sel) => {
			const responses = document.querySelectorAll(sel);
			if (responses.length === 0) { return false; }
			return !responses[responses.length - 1].classList.contains('chat-response-loading');
		},
		responseSelector, { timeout: 30_000 },
	);
	await new Promise(r => setTimeout(r, 500));
}
















async function runScenario(page, mockServer, scenarioId, label) {
	const userTurns = getUserTurns(scenarioId);
	const totalModelTurns = getModelTurnCount(scenarioId);

	if (userTurns.length === 0) {
		await sendMessage(page, mockServer, `[scenario:${scenarioId}] ${label}`, totalModelTurns);
	} else {
		let modelTurnsSoFar = 0;
		const firstUserAfter = userTurns[0].afterModelTurn;
		const turnsBeforeFirstUser = firstUserAfter - modelTurnsSoFar;
		await sendMessage(page, mockServer, `[scenario:${scenarioId}] ${label}`, turnsBeforeFirstUser);
		modelTurnsSoFar = firstUserAfter;

		for (let u = 0; u < userTurns.length; u++) {
			const nextModelStop = u + 1 < userTurns.length
				? userTurns[u + 1].afterModelTurn
				: totalModelTurns;
			const turnsUntilNext = nextModelStop - modelTurnsSoFar;

			await sendMessage(page, mockServer, userTurns[u].message, turnsUntilNext);
			modelTurnsSoFar = nextModelStop;
		}
	}
}







async function runLeakCheck(electronPath, mockServer, opts) {
	const { iterations, verbose } = opts;
	const { userDataDir, extDir, logsDir } = prepareRunDir('leak-check', mockServer, opts.settingsOverrides);
	const isDevBuild = !electronPath.includes('.vscode-test');

	const vscode = await launchVSCode(
		electronPath,
		buildArgs(userDataDir, extDir, logsDir, { isDevBuild }),
		buildEnv(mockServer, { isDevBuild }),
		{ verbose },
	);
	const page = vscode.page;

	try {
		await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });

		const cdp = await page.context().newCDPSession(page);
		await cdp.send('HeapProfiler.enable');

		const chatShortcut = process.platform === 'darwin' ? 'Control+Meta+KeyI' : 'Control+Alt+KeyI';
		await page.keyboard.press(chatShortcut);
		await page.waitForSelector(CHAT_VIEW, { timeout: 15_000 });
		await page.waitForFunction(
			(sel) => Array.from(document.querySelectorAll(sel)).some(el => el.getBoundingClientRect().width > 0),
			CHAT_EDITOR_SEL, { timeout: 15_000 },
		);

		const reqsBefore = mockServer.requestCount();
		try { await mockServer.waitForRequests(reqsBefore + 4, 30_000); } catch { }
		await new Promise(r => setTimeout(r, 3000));

		const scenarioIds = getScenarioIds();

		const baseline = await measure(cdp, page);
		if (verbose) {
			console.log(`  [leak] Baseline: heap=${baseline.heapMB}MB, domNodes=${baseline.domNodes}`);
		}


		const iterationResults = [];

		for (let iter = 0; iter < iterations; iter++) {
			const before = await measure(cdp, page);

			if (verbose) {
				console.log(`  [leak] Iteration ${iter + 1}/${iterations}: start heap=${before.heapMB}MB, domNodes=${before.domNodes}`);
			}

			for (let m = 0; m < scenarioIds.length; m++) {
				const sid = scenarioIds[m];
				await runScenario(page, mockServer, sid, `Iteration ${iter + 1}`);
				if (verbose) {
					console.log(`    [leak]   Sent ${sid} (${m + 1}/${scenarioIds.length})`);
				}
			}

			await openNewChat(page);
			await new Promise(r => setTimeout(r, 1000));

			const after = await measure(cdp, page);
			const deltaHeapMB = Math.round((after.heapMB - before.heapMB) * 100) / 100;
			const deltaDomNodes = after.domNodes - before.domNodes;

			iterationResults.push({
				beforeHeapMB: before.heapMB,
				afterHeapMB: after.heapMB,
				deltaHeapMB,
				beforeDomNodes: before.domNodes,
				afterDomNodes: after.domNodes,
				deltaDomNodes,
			});

			if (verbose) {
				console.log(`  [leak] Iteration ${iter + 1}/${iterations}: end heap=${after.heapMB}MB (delta=${deltaHeapMB}MB), domNodes=${after.domNodes} (delta=${deltaDomNodes})`);
			}
		}

		const final = await measure(cdp, page);
		const totalResidualMB = Math.round((final.heapMB - baseline.heapMB) * 100) / 100;
		const totalResidualNodes = final.domNodes - baseline.domNodes;

		const warmupBaselineMB = iterationResults.length > 1
			? iterationResults[0].afterHeapMB
			: baseline.heapMB;
		const steadyResidualMB = Math.round((final.heapMB - warmupBaselineMB) * 100) / 100;

		return {
			baseline,
			final: { heapMB: final.heapMB, domNodes: final.domNodes },
			totalResidualMB,
			totalResidualNodes,
			steadyResidualMB,
			iterations: iterationResults,
		};
	} finally {
		await vscode.close();
	}
}


async function main() {
	const opts = parseArgs();
	const electronPath = await resolveBuild(opts.build);

	if (!fs.existsSync(electronPath)) {
		console.error(`Electron not found at: ${electronPath}`);
		process.exit(1);
	}

	const { startServer } = require('./common/mock-llm-server.ts');
	const { registerPerfScenarios } = require('./common/perf-scenarios');
	registerPerfScenarios();
	const mockServer = await startServer(0);

	console.log(`[chat-simulation] Leak check: ${opts.iterations} iterations × ${getScenarioIds().length} scenarios, threshold ${opts.leakThresholdMB}MB steady-state (excl. warm-up)`);
	console.log(`[chat-simulation] Build: ${electronPath}`);
	console.log('');

	const result = await runLeakCheck(electronPath, mockServer, opts);

	console.log('[chat-simulation] =================== Leak Check Results ===================');
	console.log('');
	console.log(`  Baseline: heap=${result.baseline.heapMB}MB, domNodes=${result.baseline.domNodes}`);
	console.log(`  Final:                  heap=${result.final.heapMB}MB, domNodes=${result.final.domNodes}`);
	console.log('');
	for (let i = 0; i < result.iterations.length; i++) {
		const it = result.iterations[i];
		console.log(`  Iteration ${i + 1}: ${it.beforeHeapMB}MB → ${it.afterHeapMB}MB (residual: ${it.deltaHeapMB > 0 ? '+' : ''}${it.deltaHeapMB}MB, DOM: ${it.deltaDomNodes > 0 ? '+' : ''}${it.deltaDomNodes} nodes)`);
	}
	console.log('');
	console.log(`  Total residual heap growth:        ${result.totalResidualMB > 0 ? '+' : ''}${result.totalResidualMB}MB (includes one-time warm-up)`);
	console.log(`  Steady-state residual (excl. warm-up): ${result.steadyResidualMB > 0 ? '+' : ''}${result.steadyResidualMB}MB`);
	console.log(`  Total residual DOM growth:         ${result.totalResidualNodes > 0 ? '+' : ''}${result.totalResidualNodes} nodes`);
	console.log('');

	const jsonPath = path.join(DATA_DIR, 'chat-simulation-leak-results.json');
	fs.writeFileSync(jsonPath, JSON.stringify({
		timestamp: new Date().toISOString(),
		leakThresholdMB: opts.leakThresholdMB,
		iterationCount: opts.iterations,
		scenarioCount: getScenarioIds().length,
		...result,
	}, null, 2));
	console.log(`[chat-simulation] Results written to ${jsonPath}`);

	const leaked = result.steadyResidualMB > opts.leakThresholdMB;
	console.log('');
	if (leaked) {
		console.log(`[chat-simulation] LEAK DETECTED — ${result.steadyResidualMB}MB steady-state residual exceeds ${opts.leakThresholdMB}MB threshold`);
	} else {
		console.log(`[chat-simulation] No leak detected (${result.steadyResidualMB}MB steady-state residual < ${opts.leakThresholdMB}MB threshold)`);
	}

	if (opts.ci) {
		const summary = generateLeakCISummary(result, opts);
		const summaryPath = path.join(DATA_DIR, 'ci-summary-leak.md');
		fs.writeFileSync(summaryPath, summary);
		console.log(`[chat-simulation] CI summary written to ${summaryPath}`);
	}

	await mockServer.close();
	process.exit(leaked ? 1 : 0);
}






function generateLeakCISummary(result, opts) {
	const leaked = result.steadyResidualMB > opts.leakThresholdMB;
	const verdict = leaked ? '\u274C **LEAK DETECTED**' : '\u2705 **No leak detected**';
	const lines = [];
	lines.push('## Memory Leak Check');
	lines.push('');
	lines.push('| | |');
	lines.push('|---|---|');
	lines.push(`| **Verdict** | ${verdict} |`);
	lines.push(`| **Threshold** | ${opts.leakThresholdMB} MB (steady-state, excl. warm-up) |`);
	lines.push(`| **Iterations** | ${opts.iterations} |`);
	lines.push(`| **Scenarios per iteration** | ${getScenarioIds().length} |`);
	lines.push('');
	lines.push('| Phase | Heap (MB) | DOM Nodes |');
	lines.push('|-------|----------:|----------:|');
	lines.push(`| Baseline | ${result.baseline.heapMB} | ${result.baseline.domNodes} |`);
	for (let i = 0; i < result.iterations.length; i++) {
		const it = result.iterations[i];
		const sign = it.deltaHeapMB > 0 ? '+' : '';
		const domSign = it.deltaDomNodes > 0 ? '+' : '';
		const note = i === 0 ? ' _(warm-up)_' : '';
		lines.push(`| Iteration ${i + 1}${note} | ${it.afterHeapMB} (${sign}${it.deltaHeapMB}) | ${it.afterDomNodes} (${domSign}${it.deltaDomNodes}) |`);
	}
	lines.push(`| **Final** | **${result.final.heapMB}** | **${result.final.domNodes}** |`);
	lines.push('');
	const steadySign = result.steadyResidualMB > 0 ? '+' : '';
	const sign = result.totalResidualMB > 0 ? '+' : '';
	const domSign = result.totalResidualNodes > 0 ? '+' : '';
	lines.push(`**Steady-state residual (excl. warm-up):** ${steadySign}${result.steadyResidualMB} MB heap`);
	lines.push('');
	lines.push(`**Total residual growth:** ${sign}${result.totalResidualMB} MB heap, ${domSign}${result.totalResidualNodes} DOM nodes _(includes one-time warm-up)_`);
	lines.push('');
	return lines.join('\n');
}

main().catch(err => { console.error(err); process.exit(1); });
