/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Application, Chat, Logger } from '../../../../automation';
import { dumpFailureDiagnostics, getCopilotSmokeTestEnv, getMockLlmServerPath, installAllHandlers, MockLlmServer, preseedChatExtensionEnablement } from '../../utils';
import { runInTerminalScenario, shellEchoResponseMatcher, shellEchoScenario } from './shellScenarios';

interface SessionConfig {
	readonly name: string;
	readonly command: string;
	readonly kind: 'editor' | 'view';
	readonly scenarioId: string;
	readonly reply: string;
	readonly scenarioId2: string;
	readonly reply2: string;
	readonly skipReply2?: boolean;
}

const SESSIONS: readonly SessionConfig[] = [
	{ name: 'Copilot CLI', command: 'smoketest.openCopilotCliChat', kind: 'editor', scenarioId: 'smoke-chat-sessions-copilot-cli', reply: 'MOCKED_CHAT_SESSIONS_COPILOT_CLI_RESPONSE', scenarioId2: 'smoke-chat-sessions-copilot-cli-2', reply2: 'MOCKED_CHAT_SESSIONS_COPILOT_CLI_RESPONSE_2' },
	{ name: 'Claude', command: 'smoketest.openClaudeChat', kind: 'editor', scenarioId: 'smoke-chat-sessions-claude', reply: 'MOCKED_CHAT_SESSIONS_CLAUDE_RESPONSE', scenarioId2: 'smoke-chat-sessions-claude-2', reply2: 'MOCKED_CHAT_SESSIONS_CLAUDE_RESPONSE_2' },
	{ name: 'Local', command: 'smoketest.openLocalChat', kind: 'view', scenarioId: 'smoke-chat-sessions-local', reply: 'MOCKED_CHAT_SESSIONS_LOCAL_RESPONSE', scenarioId2: 'smoke-chat-sessions-local-2', reply2: 'MOCKED_CHAT_SESSIONS_LOCAL_RESPONSE_2' },
];

interface ShellSessionConfig {
	readonly name: string;
	readonly command: string;
	readonly kind: 'editor' | 'view';
	readonly scenarioId: string;
	readonly reply: string;
	readonly scenarioFactory: (reply: string) => unknown;
}

const SHELL_SESSIONS: readonly ShellSessionConfig[] = [
	{ name: 'Copilot CLI', command: 'smoketest.openCopilotCliChat', kind: 'editor', scenarioId: 'smoke-chat-sessions-copilot-cli-shell', reply: 'MOCKED_CHAT_SESSIONS_COPILOT_CLI_SHELL_RESPONSE', scenarioFactory: shellEchoScenario },
	{ name: 'Claude', command: 'smoketest.openClaudeChat', kind: 'editor', scenarioId: 'smoke-chat-sessions-claude-shell', reply: 'MOCKED_CHAT_SESSIONS_CLAUDE_SHELL_RESPONSE', scenarioFactory: shellEchoScenario },
	{ name: 'Local', command: 'smoketest.openLocalChat', kind: 'view', scenarioId: 'smoke-chat-sessions-local-terminal', reply: 'MOCKED_CHAT_SESSIONS_LOCAL_TERMINAL_RESPONSE', scenarioFactory: runInTerminalScenario },
];

async function preseedChatSessionProfile(userDataDir: string | undefined, mockServerUrl: string): Promise<void> {
	if (!userDataDir) {
		throw new Error('Cannot pre-seed Chat Sessions profile without a user data directory');
	}

	const settingsPath = path.join(userDataDir, 'User', 'settings.json');
	fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	fs.writeFileSync(settingsPath, JSON.stringify({
		'github.copilot.advanced.debug.overrideProxyUrl': mockServerUrl,
		'github.copilot.advanced.debug.overrideCapiUrl': mockServerUrl,
		'github.copilot.advanced.debug.overrideAuthType': 'token',
		'chat.allowAnonymousAccess': true,
		'github.copilot.chat.githubMcpServer.enabled': false,
		'chat.mcp.discovery.enabled': false,
		'chat.mcp.enabled': false,
		'chat.disableAIFeatures': false,
		'chat.agentHost.enabled': false,
		'github.copilot.chat.backgroundAgent.enabled': true,
		'github.copilot.chat.claudeAgent.enabled': true,
		'github.copilot.chat.claudeAgent.useSdkExtension': false,
		'chat.tools.riskAssessment.enabled': false,
	}, undefined, '\t'));

	await preseedChatExtensionEnablement(userDataDir);
}

async function openSession(app: Application, session: { readonly command: string; readonly kind: 'editor' | 'view' }): Promise<void> {
	await app.workbench.quickaccess.runCommand(session.command);
	if (session.kind === 'editor') {
		await app.workbench.chat.waitForChatEditor(600);
	} else {
		await app.workbench.chat.waitForChatView();
	}
}

async function sendAndWaitForReply(chat: Chat, session: SessionConfig, message: string, expectedReply: string): Promise<string> {
	if (session.kind === 'editor') {
		await chat.sendEditorMessage(message);
		return (await chat.waitForEditorResponseText(expectedReply, 120_000)).trim();
	}
	await chat.sendMessage(message);
	return (await chat.waitForResponseText(expectedReply, 120_000)).trim();
}

export function setup(logger: Logger) {

	describe('Chat Sessions', function () {
		this.timeout(5 * 60 * 1000);
		this.retries(0);

		let mockServer: MockLlmServer;

		before(async function () {
			const { startServer, ScenarioBuilder, registerScenario } = require(getMockLlmServerPath());

			registerScenario('text-only', new ScenarioBuilder().emit('OK').build());

			for (const session of SESSIONS) {
				registerScenario(session.scenarioId, new ScenarioBuilder().emit(session.reply).build());
				registerScenario(session.scenarioId2, new ScenarioBuilder().emit(session.reply2).build());
			}

			for (const shellSession of SHELL_SESSIONS) {
				registerScenario(shellSession.scenarioId, shellSession.scenarioFactory(shellSession.reply));
			}

			mockServer = await startServer(0, { logger: (msg: string) => logger.log(`[mock-llm] ${msg}`) });
			logger.log(`[Chat Sessions] mock LLM server started at ${mockServer.url} (platform=${process.platform}, arch=${process.arch}, node=${process.version})`);
			logger.log(`[Chat Sessions] env: VSCODE_DEV=${process.env.VSCODE_DEV ?? '<unset>'}, VSCODE_QUALITY=${process.env.VSCODE_QUALITY ?? '<unset>'}, BUILD_SOURCEBRANCH=${process.env.BUILD_SOURCEBRANCH ?? '<unset>'}, GITHUB_RUN_ID=${process.env.GITHUB_RUN_ID ?? '<unset>'}, GITHUB_ACTIONS=${process.env.GITHUB_ACTIONS ?? '<unset>'}`);
		});

		installAllHandlers(logger, opts => {
			const copilotEnv = getCopilotSmokeTestEnv(mockServer, { userDataDir: opts.userDataDir });
			logger.log(`[Chat Sessions] extraEnv keys for app: ${Object.keys(copilotEnv).join(', ')} (token len=${(copilotEnv.VSCODE_COPILOT_CHAT_TOKEN ?? '').length})`);
			return {
				...opts,
				extraEnv: {
					...(opts.extraEnv ?? {}),
					...copilotEnv,
				},
			};
		}, app => preseedChatSessionProfile(app.userDataPath, mockServer.url));

		after(async function () {
			await mockServer?.close();
		});

		for (const session of SESSIONS) {
			it(`Test ${session.name} session`, async function () {
				const app = this.app as Application;
				const requestsBefore = mockServer.requestCount();
				logger.log(`[Chat Sessions/${session.name}] starting test; requestCount=${requestsBefore}`);

				try {
					await openSession(app, session);

					logger.log(`[Chat Sessions/${session.name}] running command and waiting for chat editor`);
					const responseText = await sendAndWaitForReply(app.workbench.chat, session, `hello world [scenario:${session.scenarioId}]`, session.reply);
					logger.log(`Chat Sessions (${session.name}) response 1: ${responseText}`);

					assert.ok(
						responseText.includes(session.reply),
						`Expected ${session.name} response 1 to include mocked scenario response "${session.reply}".\n\nResponse:\n${responseText}`
					);

					if (!session.skipReply2) {
						logger.log(`[Chat Sessions/${session.name}] running second command and waiting for chat editor`);
						const responseText2 = await sendAndWaitForReply(app.workbench.chat, session, `hello again [scenario:${session.scenarioId2}]`, session.reply2);
						logger.log(`Chat Sessions (${session.name}) response 2: ${responseText2}`);

						assert.ok(
							responseText2.includes(session.reply2),
							`Expected ${session.name} response 2 to include mocked scenario response "${session.reply2}".\n\nResponse:\n${responseText2}`
						);
					} else {
						logger.log(`[Chat Sessions/${session.name}] skipping second reply assertion (skipReply2=true)`);
					}
					assert.ok(
						mockServer.requestCount() > requestsBefore,
						`expected the mock LLM server to have received a new request from the ${session.name} session (before=${requestsBefore}, after=${mockServer.requestCount()})`
					);
				} catch (error) {
					logger.log(`[Chat Sessions/${session.name}] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
					logger.log(`[Chat Sessions/${session.name}] mock server requestCount at failure: ${mockServer.requestCount()} (before=${requestsBefore})`);
					await dumpFailureDiagnostics(app, logger, `Chat Sessions/${session.name}`);
					throw error;
				} finally {
					await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
				}
			});
		}

		for (const shellSession of SHELL_SESSIONS) {
			it(`Test ${shellSession.name} session run in terminal`, async function () {
				const app = this.app as Application;
				const requestsBefore = mockServer.requestCount();
				logger.log(`[Chat Sessions/${shellSession.name} shell] starting test; requestCount=${requestsBefore}`);

				try {
					await openSession(app, shellSession);

					const prompt = `hello world [scenario:${shellSession.scenarioId}]`;
					const matcher = shellEchoResponseMatcher(shellSession.reply);
					let responseText: string;
					if (shellSession.kind === 'editor') {
						await app.workbench.chat.sendEditorMessage(prompt);
						responseText = (await app.workbench.chat.waitForEditorResponseText(matcher, 120_000, { acceptToolConfirmations: true })).trim();
					} else {
						await app.workbench.chat.sendMessage(prompt);
						responseText = (await app.workbench.chat.waitForResponseText(matcher, 120_000, { acceptToolConfirmations: true })).trim();
					}
					logger.log(`Chat Sessions (${shellSession.name} shell) response: ${responseText}`);

					assert.match(
						responseText,
						matcher,
						`Expected ${shellSession.name} shell response to include the echoed marker "${shellSession.reply}" inside a JSON tool result string.\n\nResponse:\n${responseText}`
					);

					assert.ok(
						mockServer.requestCount() > requestsBefore,
						`expected the mock LLM server to have received a new request from the ${shellSession.name} shell session (before=${requestsBefore}, after=${mockServer.requestCount()})`
					);
				} catch (error) {
					logger.log(`[Chat Sessions/${shellSession.name} shell] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
					logger.log(`[Chat Sessions/${shellSession.name} shell] mock server requestCount at failure: ${mockServer.requestCount()} (before=${requestsBefore})`);
					await dumpFailureDiagnostics(app, logger, `Chat Sessions/${shellSession.name} shell`);
					throw error;
				} finally {
					await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
				}
			});
		}
	});
}
