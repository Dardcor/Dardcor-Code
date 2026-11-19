/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Application, Chat, Logger } from '../../../../automation';
import { dumpFailureDiagnostics, getCopilotSmokeTestEnv, getMockLlmServerPath, installAllHandlers, MockLlmServer, preseedChatExtensionEnablement } from '../../utils';

const WARMUP_SCENARIO_ID = 'smoke-chat-sandbox-warmup';
const WARMUP_REPLY = 'MOCKED_CHAT_SANDBOX_WARMUP';
const HOST_TMP_REPLY = 'MOCKED_CHAT_SANDBOX_HOST_TMP_COMPLETE';
const SANDBOX_SCENARIO_ID = 'smoke-chat-sandbox';
const TMPDIR_SCENARIO_ID = 'smoke-chat-sandbox-tmpdir';
const HOST_TMP_SCENARIO_ID = 'smoke-chat-sandbox-host-tmp';
const NETWORK_SCENARIO_ID = 'smoke-chat-sandbox-network';
const NETWORK_ALLOWED_SCENARIO_ID = 'smoke-chat-sandbox-network-allowed';
const HOME_READ_SCENARIO_ID = 'smoke-chat-sandbox-home-read';
const HOME_READ_ALLOWED_SCENARIO_ID = 'smoke-chat-sandbox-home-read-allowed';
const CHAT_RESPONSE_TIMEOUT = 120_000;
const NETWORK_BLOCKED_PATTERN = /ECONNREFUSED|EPERM|EACCES|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EAI_AGAIN/;
const SANDBOX_EXIT_CODE_PATTERN = /SANDBOX_EXIT_CODE=(\d+)/;
const TMPDIR_EXIT_CODE_PATTERN = /TMPDIR_EXIT_CODE=(\d+)/;
const HOME_READ_BLOCKED_EXIT_CODE_PATTERN = /HOME_READ_BLOCKED_EXIT_CODE=(\d+)/;

function terminalCommandScenario(command: string, finalReply?: string) {
	return {
		type: 'multi-turn',
		turns: [
			{
				kind: 'tool-calls',
				toolCalls: [
					{
						toolNamePattern: /run.?in.?terminal|execute.?command/i,
						arguments: {
							command,
							explanation: 'Run a terminal command for a chat smoke test',
							goal: 'Run a terminal command',
							mode: 'sync',
							timeout: 30_000,
						},
					},
				],
			},
			finalReply
				? { kind: 'content', chunks: [{ content: finalReply }] }
				: { kind: 'echo-last-tool-result' },
		],
	};
}

function quoteShellArgument(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function warmUpChat(chat: Chat, logger: Logger): Promise<void> {
	const deadline = Date.now() + 180_000;
	let attempt = 0;
	let lastError: unknown;

	while (Date.now() < deadline) {
		attempt++;
		try {
			await chat.sendMessage(`warm up [scenario:${WARMUP_SCENARIO_ID}]`);
			await chat.waitForResponseText(WARMUP_REPLY, 25_000);
			logger.log(`[Chat Sandbox] warm-up succeeded on attempt ${attempt}`);
			return;
		} catch (error) {
			lastError = error;
			logger.log(`[Chat Sandbox] warm-up attempt ${attempt} not ready yet; retrying`);
		}
	}

	throw new Error(`Chat did not become ready for the sandbox probe. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function updateUserSettingsWhileChatIsOpen(app: Application, settings: [key: string, value: string][]): Promise<void> {
	await app.workbench.settingsEditor.addUserSettings(settings);
	await app.workbench.quickaccess.runCommand('workbench.action.closeActiveEditor');

	await app.workbench.quickaccess.runCommand('workbench.action.chat.open');
	await app.workbench.chat.waitForChatView();
}

export function setup(logger: Logger): void {
	if (process.platform !== 'darwin' && process.platform !== 'linux') {
		return;
	}

	describe(`Chat Sandbox (${process.platform})`, function () {
		this.timeout(5 * 60 * 1000);
		this.retries(0);

		let mockServer: MockLlmServer;
		let sandboxReply: string;
		let networkAllowedReply: string;
		let homeFilePath: string;
		let homeFileContents: string;
		let hostTempFilePath: string;

		before(async function () {
			const { startServer, ScenarioBuilder, registerScenario } = require(getMockLlmServerPath());

			sandboxReply = `MOCKED_CHAT_SANDBOX_RESPONSE_${process.platform}_${process.pid}_${Date.now()}`;
			networkAllowedReply = `MOCKED_CHAT_SANDBOX_NETWORK_ALLOWED_${process.platform}_${process.pid}_${Date.now()}`;
			homeFileContents = `MOCKED_CHAT_SANDBOX_HOME_FILE_${process.platform}_${process.pid}_${Date.now()}`;
			const homeFileName = `.vscode-chat-sandbox-smoke-${process.pid}-${Date.now()}.txt`;
			homeFilePath = path.join(os.homedir(), homeFileName);
			fs.writeFileSync(homeFilePath, `${homeFileContents}\n`);
			const tempFileName = `.vscode-chat-sandbox-tmp-${process.pid}-${Date.now()}.txt`;
			hostTempFilePath = path.join(os.tmpdir(), tempFileName);
			fs.rmSync(hostTempFilePath, { force: true });

			registerScenario('text-only', new ScenarioBuilder().emit('OK').build());
			registerScenario(WARMUP_SCENARIO_ID, new ScenarioBuilder().emit(WARMUP_REPLY).build());
			registerScenario(SANDBOX_SCENARIO_ID, terminalCommandScenario(`echo ${sandboxReply}; status=$?; printf 'SANDBOX_EXIT_CODE=%s\n' "$status"; exit "$status"`));
			registerScenario(TMPDIR_SCENARIO_ID, terminalCommandScenario(`echo test > "$TMPDIR/${tempFileName}"; status=$?; printf 'TMPDIR_EXIT_CODE=%s\n' "$status"; exit "$status"`));
			registerScenario(HOST_TMP_SCENARIO_ID, terminalCommandScenario(`host_tmp=${quoteShellArgument(hostTempFilePath)}; echo test > "$host_tmp"`, HOST_TMP_REPLY));

			mockServer = await startServer(0, { logger: (message: string) => logger.log(`[mock-llm] ${message}`), verbose: true });
			const encodedNetworkAllowedReply = Buffer.from(networkAllowedReply).toString('base64');
			const networkProbe = `node -e "const http=require('http');const req=http.get('${mockServer.url}',res=>{res.resume();console.log(Buffer.from('${encodedNetworkAllowedReply}','base64').toString())});req.on('error',error=>console.log(error.code))"`;
			registerScenario(NETWORK_SCENARIO_ID, terminalCommandScenario(networkProbe));
			registerScenario(NETWORK_ALLOWED_SCENARIO_ID, terminalCommandScenario(networkProbe));
			const homeReadProbe = (resultMarker: string) => `cat "$HOME/${homeFileName}" >/dev/null 2>&1; status=$?; printf '${resultMarker}=%s\n' "$status"; exit "$status"`;
			registerScenario(HOME_READ_SCENARIO_ID, terminalCommandScenario(homeReadProbe('HOME_READ_BLOCKED_EXIT_CODE')));
			registerScenario(HOME_READ_ALLOWED_SCENARIO_ID, terminalCommandScenario(`cat "$HOME/${homeFileName}"`));
			logger.log(`[Chat Sandbox] mock LLM server started at ${mockServer.url}; platform=${process.platform}`);
		});

		installAllHandlers(logger, opts => ({
			...opts,
			extraEnv: {
				...(opts.extraEnv ?? {}),
				...getCopilotSmokeTestEnv(mockServer, { userDataDir: opts.userDataDir }),
			},
		}), app => preseedChatExtensionEnablement(app.userDataPath));

		before(async function () {
			const app = this.app as Application;
			await app.workbench.settingsEditor.addUserSettings([
				['github.copilot.advanced.debug.overrideProxyUrl', JSON.stringify(mockServer.url)],
				['github.copilot.advanced.debug.overrideCapiUrl', JSON.stringify(mockServer.url)],
				['github.copilot.advanced.debug.overrideAuthType', '"token"'],
				['chat.allowAnonymousAccess', 'true'],
				['github.copilot.chat.githubMcpServer.enabled', 'false'],
				['chat.mcp.discovery.enabled', 'false'],
				['chat.mcp.enabled', 'false'],
				['chat.disableAIFeatures', 'false'],
				['editor.wordWrap', '"on"'],
				['chat.agent.sandbox.enabled', '"on"'],
				['chat.agent.sandbox.retryWithAllowNetworkRequests', 'false'],
				['chat.agent.sandbox.allowUnsandboxedCommands', 'false'],
			]);
			await app.workbench.quickaccess.runCommand('workbench.action.closeActiveEditor');
		});

		before(async function () {
			const app = this.app as Application;
			await app.workbench.quickaccess.runCommand('smoketest.openLocalChat');
			await app.workbench.chat.waitForChatView();
			await warmUpChat(app.workbench.chat, logger);
		});

		after(async function () {
			fs.rmSync(homeFilePath, { force: true });
			fs.rmSync(hostTempFilePath, { force: true });
			await mockServer?.close();
		});

		it.skip('runs terminal commands inside the sandbox', async function () {
			const app = this.app as Application;

			try {
				const requestsBefore = mockServer.requestCount();
				await app.workbench.chat.sendMessage(`Run the terminal sandbox probe [scenario:${SANDBOX_SCENARIO_ID}]`);

				const responseText = await app.workbench.chat.waitForResponseText(SANDBOX_EXIT_CODE_PATTERN, CHAT_RESPONSE_TIMEOUT);
				logger.log(`[Chat Sandbox] response: ${responseText}`);
				assert.ok(mockServer.requestCount() > requestsBefore, 'expected the mock LLM server to receive the sandbox scenario');
				assert.ok(responseText.includes(sandboxReply), 'expected the terminal result to include the sandbox probe reply');
				const exitCodeMatch = SANDBOX_EXIT_CODE_PATTERN.exec(responseText);
				assert.ok(exitCodeMatch, 'expected the terminal result to include the sandbox probe exit code');
				assert.strictEqual(Number(exitCodeMatch[1]), 0, 'expected the sandboxed terminal command to exit successfully');

				const terminalLogPath = path.join(app.logsPath, 'terminal.log');
				const terminalLog = fs.readFileSync(terminalLogPath, 'utf8');
				assert.match(
					terminalLog,
					/RunInTerminalTool: Command rewritten by CommandLineSandboxRewriter: Wrapped command for sandbox execution/,
					`expected sandbox-wrapped terminal execution in ${terminalLogPath}`
				);
			} catch (error) {
				logger.log(`[Chat Sandbox/execution] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
				await dumpFailureDiagnostics(app, logger, `Chat Sandbox (${process.platform}) execution`);
				throw error;
			}
		});

		it('allows writing to the sandbox TMPDIR', async function () {
			const app = this.app as Application;

			try {
				const requestsBefore = mockServer.requestCount();
				await app.workbench.chat.sendMessage(`Run the terminal TMPDIR sandbox probe [scenario:${TMPDIR_SCENARIO_ID}]`);

				const responseText = await app.workbench.chat.waitForResponseText(TMPDIR_EXIT_CODE_PATTERN, CHAT_RESPONSE_TIMEOUT);
				logger.log(`[Chat Sandbox/TMPDIR] response: ${responseText}`);
				assert.ok(mockServer.requestCount() > requestsBefore, 'expected the mock LLM server to receive the TMPDIR sandbox scenario');
				const exitCodeMatch = TMPDIR_EXIT_CODE_PATTERN.exec(responseText);
				assert.ok(exitCodeMatch, 'expected the terminal result to include the TMPDIR probe exit codes');
				assert.strictEqual(Number(exitCodeMatch[1]), 0, 'expected the sandbox TMPDIR to be writable');
			} catch (error) {
				logger.log(`[Chat Sandbox/TMPDIR] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
				await dumpFailureDiagnostics(app, logger, `Chat Sandbox (${process.platform}) TMPDIR`);
				throw error;
			}
		});

		it('blocks writing to the host temp directory', async function () {
			const app = this.app as Application;

			try {
				const requestsBefore = mockServer.requestCount();
				await app.workbench.chat.sendMessage(`Run the host temp directory sandbox probe [scenario:${HOST_TMP_SCENARIO_ID}]`);

				const responseText = await app.workbench.chat.waitForResponseText(HOST_TMP_REPLY, CHAT_RESPONSE_TIMEOUT);
				logger.log(`[Chat Sandbox/host tmp] response: ${responseText}`);
				assert.ok(mockServer.requestCount() > requestsBefore, 'expected the mock LLM server to receive the host temp sandbox scenario');
				assert.ok(responseText.includes(HOST_TMP_REPLY), 'expected the host temp command to complete');
				assert.strictEqual(fs.existsSync(hostTempFilePath), false, `expected the sandbox to prevent creating ${hostTempFilePath}`);
			} catch (error) {
				logger.log(`[Chat Sandbox/host tmp] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
				await dumpFailureDiagnostics(app, logger, `Chat Sandbox (${process.platform}) host temp`);
				throw error;
			}
		});

		it('blocks terminal network access by default', async function () {
			const app = this.app as Application;

			try {
				const requestsBefore = mockServer.requestCount();
				await app.workbench.chat.sendMessage(`Run the terminal network sandbox probe [scenario:${NETWORK_SCENARIO_ID}]`);

				const responseText = await app.workbench.chat.waitForResponseText(NETWORK_BLOCKED_PATTERN, CHAT_RESPONSE_TIMEOUT);
				logger.log(`[Chat Sandbox/network] response: ${responseText}`);
				assert.ok(mockServer.requestCount() > requestsBefore, 'expected the mock LLM server to receive the network sandbox scenario');
				assert.match(
					responseText,
					NETWORK_BLOCKED_PATTERN,
					'expected the sandbox to block the terminal command from reaching the local mock server'
				);
			} catch (error) {
				logger.log(`[Chat Sandbox/network] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
				await dumpFailureDiagnostics(app, logger, `Chat Sandbox (${process.platform}) network`);
				throw error;
			}
		});

		describe('with terminal network access enabled', function () {
			before(async function () {
				const app = this.app as Application;
				await updateUserSettingsWhileChatIsOpen(app, [
					['chat.agent.sandbox.allowNetwork', 'true'],
				]);
			});

			it('allows terminal network access', async function () {
				const app = this.app as Application;

				try {
					const requestsBefore = mockServer.requestCount();
					await app.workbench.chat.sendMessage(`Run the allowed terminal network sandbox probe [scenario:${NETWORK_ALLOWED_SCENARIO_ID}]`);

					const responseText = await app.workbench.chat.waitForResponseText(networkAllowedReply, CHAT_RESPONSE_TIMEOUT);
					logger.log(`[Chat Sandbox/network allowed] response: ${responseText}`);
					assert.ok(mockServer.requestCount() > requestsBefore, 'expected the mock LLM server to receive the allowed network sandbox scenario');
					assert.ok(responseText.includes(networkAllowedReply), 'expected allowNetwork to permit the sandboxed terminal command to reach the local mock server');
				} catch (error) {
					logger.log(`[Chat Sandbox/network allowed] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
					await dumpFailureDiagnostics(app, logger, `Chat Sandbox (${process.platform}) network allowed`);
					throw error;
				}
			});
		});

		it('blocks reading files in the home directory outside the workspace by default', async function () {
			const app = this.app as Application;

			try {
				const requestsBefore = mockServer.requestCount();
				await app.workbench.chat.sendMessage(`Read the home directory sandbox probe [scenario:${HOME_READ_SCENARIO_ID}]`);

				const responseText = await app.workbench.chat.waitForResponseText(HOME_READ_BLOCKED_EXIT_CODE_PATTERN, CHAT_RESPONSE_TIMEOUT);
				logger.log(`[Chat Sandbox/home read] response: ${responseText}`);
				assert.ok(mockServer.requestCount() > requestsBefore, 'expected the mock LLM server to receive the home read sandbox scenario');
				const exitCodeMatch = HOME_READ_BLOCKED_EXIT_CODE_PATTERN.exec(responseText);
				assert.ok(exitCodeMatch, 'expected the terminal result to include the home read exit code');
				const exitCode = Number(exitCodeMatch[1]);
				assert.notStrictEqual(exitCode, 0, `expected the sandbox to block reading ${homeFilePath}; the path must be added to chat.agent.sandbox.fileSystem.${process.platform === 'darwin' ? 'mac' : 'linux'}.allowRead to permit access`);
			} catch (error) {
				logger.log(`[Chat Sandbox/home read] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
				await dumpFailureDiagnostics(app, logger, `Chat Sandbox (${process.platform}) home read`);
				throw error;
			}
		});

		describe('with home file read access enabled', function () {
			before(async function () {
				const app = this.app as Application;
				const fileSystemSetting = JSON.stringify({ allowRead: [homeFilePath] });
				await updateUserSettingsWhileChatIsOpen(app, [
					['chat.agent.sandbox.fileSystem.linux', fileSystemSetting],
					['chat.agent.sandbox.fileSystem.mac', fileSystemSetting],
				]);
			});

			it('allows reading a configured home directory file', async function () {
				const app = this.app as Application;

				try {
					const requestsBefore = mockServer.requestCount();
					await app.workbench.chat.sendMessage(`Read the allowed home directory sandbox probe [scenario:${HOME_READ_ALLOWED_SCENARIO_ID}]`);

					const responseText = await app.workbench.chat.waitForResponseText(homeFileContents, CHAT_RESPONSE_TIMEOUT);
					logger.log(`[Chat Sandbox/home read allowed] response: ${responseText}`);
					assert.ok(mockServer.requestCount() > requestsBefore, 'expected the mock LLM server to receive the allowed home read sandbox scenario');
					assert.ok(responseText.includes(homeFileContents), `expected allowRead to permit reading ${homeFilePath}`);
				} catch (error) {
					logger.log(`[Chat Sandbox/home read allowed] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
					await dumpFailureDiagnostics(app, logger, `Chat Sandbox (${process.platform}) home read allowed`);
					throw error;
				}
			});
		});
	});
}
