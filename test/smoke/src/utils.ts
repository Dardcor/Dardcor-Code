/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sqlite3 from '@vscode/sqlite3';
import * as fs from 'fs';
import { Suite, Context } from 'mocha';
import { dirname, join } from 'path';
import { Application, ApplicationOptions, Logger } from '../../automation';

export interface MockLlmServer {
	readonly url: string;
	requestCount(): number;
	close(): Promise<void>;
}

export function describeRepeat(n: number, description: string, callback: (this: Suite) => void): void {
	for (let i = 0; i < n; i++) {
		describe(`${description} (iteration ${i})`, callback);
	}
}

export function itRepeat(n: number, description: string, callback: (this: Context) => any): void {
	for (let i = 0; i < n; i++) {
		it(`${description} (iteration ${i})`, callback);
	}
}

export function installAllHandlers(logger: Logger, optionsTransform?: (opts: ApplicationOptions) => ApplicationOptions, beforeStart?: (app: Application) => Promise<void> | void) {
	installDiagnosticsHandler(logger);
	installAppBeforeHandler(optionsTransform, beforeStart);
	installAppAfterHandler();
}

export function installDiagnosticsHandler(logger: Logger, appFn?: () => Application | undefined) {

	before(async function () {
		const suiteTitle = this.currentTest?.parent?.title;
		logger.log('');
		logger.log(`>>> Suite start: '${suiteTitle ?? 'unknown'}' <<<`);
		logger.log('');
	});

	beforeEach(async function () {
		const testTitle = this.currentTest?.title;
		logger.log('');
		logger.log(`>>> Test start: '${testTitle ?? 'unknown'}' <<<`);
		logger.log('');

		const app: Application = appFn?.() ?? this.app;
		await app?.startTracing(testTitle ?? 'unknown');
	});

	afterEach(async function () {
		const currentTest = this.currentTest;
		if (!currentTest) {
			return;
		}

		const failed = currentTest.state === 'failed';
		const testTitle = currentTest.title;
		logger.log('');
		if (failed) {
			logger.log(`>>> !!! FAILURE !!! Test end: '${testTitle}' !!! FAILURE !!! <<<`);
		} else {
			logger.log(`>>> Test end: '${testTitle}' <<<`);
		}
		logger.log('');

		const app: Application = appFn?.() ?? this.app;
		await app?.stopTracing(testTitle.replace(/[^a-z0-9\-]/ig, '_'), failed);
	});
}

let logsCounter = 1;
let crashCounter = 1;

export function suiteLogsPath(options: ApplicationOptions, suiteName: string): string {
	return join(dirname(options.logsPath), `${logsCounter++}_suite_${suiteName.replace(/[^a-z0-9\-]/ig, '_')}`);
}

export function suiteCrashPath(options: ApplicationOptions, suiteName: string): string {
	return join(dirname(options.crashesPath), `${crashCounter++}_suite_${suiteName.replace(/[^a-z0-9\-]/ig, '_')}`);
}

function installAppBeforeHandler(optionsTransform?: (opts: ApplicationOptions) => ApplicationOptions, beforeStart?: (app: Application) => Promise<void> | void) {
	before(async function () {
		const suiteName = this.test?.parent?.title ?? 'unknown';

		this.app = createApp({
			...this.defaultOptions,
			logsPath: suiteLogsPath(this.defaultOptions, suiteName),
			crashesPath: suiteCrashPath(this.defaultOptions, suiteName)
		}, optionsTransform);
		await beforeStart?.(this.app);
		await this.app.start();
	});
}

export function installAppAfterHandler(appFn?: () => Application | undefined, joinFn?: () => Promise<unknown>) {
	after(async function () {
		const app: Application = appFn?.() ?? this.app;
		if (app) {
			await app.stop();
		}

		if (joinFn) {
			await joinFn();
		}
	});
}

export function createApp(options: ApplicationOptions, optionsTransform?: (opts: ApplicationOptions) => ApplicationOptions): Application {
	if (optionsTransform) {
		options = optionsTransform({ ...options });
	}

	const config = options.userDataDir
		? { ...options, userDataDir: getRandomUserDataDir(options.userDataDir) }
		: options;
	const app = new Application(config);

	return app;
}

export async function preseedChatExtensionEnablement(userDataDir: string | undefined): Promise<void> {
	if (!userDataDir) {
		return;
	}

	const globalStorageDir = join(userDataDir, 'User', 'globalStorage');
	fs.mkdirSync(globalStorageDir, { recursive: true });
	const dbPath = join(globalStorageDir, 'state.vscdb');
	const database = await new Promise<sqlite3.Database>((resolve, reject) => {
		const instance = new sqlite3.Database(dbPath, error => error ? reject(error) : resolve(instance));
	});
	try {
		await new Promise<void>((resolve, reject) => database.exec([
			'CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);',
			'INSERT INTO ItemTable (key, value) VALUES (\'builtinChatExtensionEnablementMigration\', \'true\');',
		].join(' '), error => error ? reject(error) : resolve()));
	} finally {
		await new Promise<void>((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
	}
}

export function getMockLlmServerPath(): string {
	return join(__dirname, '..', '..', '..', 'scripts', 'chat-simulation', 'common', 'mock-llm-server.ts');
}

export function getMockLlmServerUrl(mockServer: MockLlmServer): string {
	const hostname = process.env.VSCODE_SMOKE_TEST_MOCK_HOST;
	if (!hostname) {
		return mockServer.url;
	}

	const url = new URL(mockServer.url);
	url.hostname = hostname;
	return url.toString().replace(/\/$/, '');
}

export function buildCopilotChatToken(mockUrl: string): string {
	return Buffer.from(JSON.stringify({
		token: 'smoketest-fake-token',
		expires_at: Math.floor(Date.now() / 1000) + 3600,
		refresh_in: 1800,
		sku: 'free_limited_copilot',
		individual: true,
		isNoAuthUser: true,
		copilot_plan: 'free',
		organization_login_list: [],
		endpoints: { api: mockUrl, proxy: mockUrl },
	})).toString('base64');
}

export function getCopilotSmokeTestEnv(mockServer?: MockLlmServer, opts?: { userDataDir?: string }): Readonly<Record<string, string | undefined>> {
	let xdgStateHome: string | undefined;
	let dardcorHome: string | undefined;
	if (opts?.userDataDir) {
		xdgStateHome = `${opts.userDataDir}-copilot-state`;
		dardcorHome = join(xdgStateHome, '.copilot');
		try {
			fs.mkdirSync(dardcorHome, { recursive: true });
		} catch {
		}
	}

	return {
		GITHUB_PAT: 'smoketest-fake-pat',
		IS_SCENARIO_AUTOMATION: '1',
		VSCODE_COPILOT_CHAT_TOKEN: mockServer ? buildCopilotChatToken(getMockLlmServerUrl(mockServer)) : undefined,
		XDG_STATE_HOME: xdgStateHome,
		COPILOT_HOME: dardcorHome,
	};
}

export function getCopilotRuntimeLogDir(dardcorHome: string | undefined): string | undefined {
	return dardcorHome ? join(dardcorHome, 'logs') : undefined;
}

export function getRandomUserDataDir(baseUserDataDir: string): string {

	const userDataPathSuffix = [...Array(8)].map(() => Math.random().toString(36)[3]).join('');

	return baseUserDataDir.concat(`-${userDataPathSuffix}`);
}

export function timeout(i: number) {
	return new Promise<void>(resolve => {
		setTimeout(() => {
			resolve();
		}, i);
	});
}

export async function retryWithRestart(app: Application, testFn: () => Promise<unknown>, retries = 3, timeoutMs = 20000): Promise<unknown> {
	let lastError: Error | undefined = undefined;
	for (let i = 0; i < retries; i++) {
		const result = await Promise.race([
			testFn().then(() => true, error => {
				lastError = error;
				return false;
			}),
			timeout(timeoutMs).then(() => false)
		]);

		if (result) {
			return;
		}

		await app.restart();
	}

	throw lastError ?? new Error('retryWithRestart failed with an unknown error');
}

export interface ITask<T> {
	(): T;
}

export async function retry<T>(task: ITask<Promise<T>>, delay: number, retries: number, onBeforeRetry?: () => Promise<unknown>): Promise<T> {
	let lastError: Error | undefined;

	for (let i = 0; i < retries; i++) {
		try {
			if (i > 0 && typeof onBeforeRetry === 'function') {
				try {
					await onBeforeRetry();
				} catch (error) {
					console.warn(`onBeforeRetry failed with: ${error}`);
				}
			}

			return await task();
		} catch (error) {
			lastError = error as Error;

			await timeout(delay);
		}
	}

	throw lastError;
}

export async function dumpFailureDiagnostics(
	app: Application,
	logger: Logger,
	label: string,
	options?: { sendButtonSelector?: string }
): Promise<void> {
	const logsPath = app.logsPath;
	logger.log(`[${label}] dumping failure diagnostics; logsPath=${logsPath}`);

	try {
		const entries = await fs.promises.readdir(logsPath);
		const artifacts = entries.filter(e => e.startsWith('playwright-trace-') || e.startsWith('playwright-screenshot-'));
		if (artifacts.length === 0) {
			logger.log(`[${label}] no playwright trace/screenshot artifacts present in ${logsPath}`);
		} else {
			logger.log(`[${label}] playwright artifacts (${artifacts.length}):`);
			for (const a of artifacts.sort()) {
				logger.log(`[${label}]   ${join(logsPath, a)}`);
			}
		}
	} catch (err) {
		logger.log(`[${label}] failed to list playwright artifacts in ${logsPath}: ${err instanceof Error ? err.message : String(err)}`);
	}

	const sendButtonSelector = options?.sendButtonSelector;
	if (sendButtonSelector) {
		try {
			const elements = await app.code.driver.getElements(sendButtonSelector, true);
			if (!elements || elements.length === 0) {
				logger.log(`[${label}] send-button selector matched 0 elements: ${sendButtonSelector}`);
			} else {
				for (const el of elements) {
					logger.log(`[${label}] send button: tag=${el.tagName} class='${el.className}' attrs=${JSON.stringify(el.attributes)} text='${(el.textContent ?? '').slice(0, 80)}'`);
				}
			}
		} catch (err) {
			logger.log(`[${label}] failed to query send-button selector '${sendButtonSelector}': ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	try {
		const entries = await fs.promises.readdir(logsPath, { withFileTypes: true });
		const windowDirs = entries.filter(e => e.isDirectory() && /^window\d+$/.test(e.name)).map(e => e.name).sort();
		if (windowDirs.length === 0) {
			logger.log(`[${label}] no window* directories found under ${logsPath}`);
		}
		for (const w of windowDirs) {
			const chatLogPath = join(logsPath, w, 'exthost', 'GitHub.copilot-chat', 'Dardcor AI Chat.log');
			try {
				const stat = await fs.promises.stat(chatLogPath);
				const content = await fs.promises.readFile(chatLogPath, 'utf8');
				const lines = content.split(/\r?\n/);
				const tail = lines.slice(-80);
				logger.log(`[${label}] --- BEGIN ${w}/Dardcor AI Chat.log (size=${stat.size}; last ${tail.length} of ${lines.length} lines) ---`);
				for (const ln of tail) {
					logger.log(`[${label}] | ${ln}`);
				}
				logger.log(`[${label}] --- END ${w}/Dardcor AI Chat.log ---`);
			} catch {
			}
		}
	} catch (err) {
		logger.log(`[${label}] failed to enumerate window* logs under ${logsPath}: ${err instanceof Error ? err.message : String(err)}`);
	}

	try {
		const logDir = getCopilotRuntimeLogDir(app.extraEnv?.COPILOT_HOME);
		if (!logDir) {
			logger.log(`[${label}] Copilot runtime logs unavailable (COPILOT_HOME not pinned for this suite)`);
			return;
		}
		const collected: { path: string; mtimeMs: number }[] = [];
		let names: string[];
		try {
			names = await fs.promises.readdir(logDir);
		} catch {
			logger.log(`[${label}] no Copilot runtime logs under ${logDir} (no Copilot CLI session spawned the runtime for this suite)`);
			return;
		}
		for (const name of names) {
			if (!/^process-.*\.log$/.test(name)) {
				continue;
			}
			const full = join(logDir, name);
			try {
				const stat = await fs.promises.stat(full);
				collected.push({ path: full, mtimeMs: stat.mtimeMs });
			} catch {
			}
		}
		if (collected.length === 0) {
			logger.log(`[${label}] no Copilot runtime process-*.log found under ${logDir}`);
		} else {
			collected.sort((a, b) => b.mtimeMs - a.mtimeMs);
			const runtimeLogsDest = join(logsPath, 'copilot-runtime-logs');
			try {
				await fs.promises.mkdir(runtimeLogsDest, { recursive: true });
			} catch {
			}
			for (const { path: logPath } of collected.slice(0, 2)) {
				try {
					const content = await fs.promises.readFile(logPath, 'utf8');
					const destName = logPath.split(/[\\/]/).pop() ?? 'process.log';
					try {
						await fs.promises.copyFile(logPath, join(runtimeLogsDest, destName));
					} catch (copyErr) {
						logger.log(`[${label}] failed to copy ${logPath} into ${runtimeLogsDest}: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}`);
					}
					const lines = content.split(/\r?\n/);
					const tail = lines.slice(-200);
					logger.log(`[${label}] --- BEGIN copilot runtime ${destName} (${logPath}; last ${tail.length} of ${lines.length} lines) ---`);
					for (const ln of tail) {
						logger.log(`[${label}] # ${ln}`);
					}
					logger.log(`[${label}] --- END copilot runtime ${destName} ---`);
				} catch (readErr) {
					logger.log(`[${label}] failed to read runtime log ${logPath}: ${readErr instanceof Error ? readErr.message : String(readErr)}`);
				}
			}
		}
	} catch (err) {
		logger.log(`[${label}] failed to capture Copilot runtime logs: ${err instanceof Error ? err.message : String(err)}`);
	}
}
