/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Application, Chat, Logger } from '../../../../automation';
import { dumpFailureDiagnostics, getCopilotSmokeTestEnv, getMockLlmServerPath, installAllHandlers, MockLlmServer, preseedChatExtensionEnablement } from '../../utils';

interface CapturedRequest {
	readonly path: string;
	readonly method: string;
	readonly body: any;
}

interface MockServerWithRequests extends MockLlmServer {
	getRequests(): CapturedRequest[];
}

const MODEL_NAME = 'Mock Config Model';

const MODEL_ID = 'mock-config-model';

interface ConfigCase {
	readonly name: string;
	readonly effortLabel?: string;
	readonly expectedEffort: string;
	readonly contextLabel: string;
	readonly expectedCompactThreshold: number;
	readonly expectedConfigLabel: string;
	readonly expectedContextWindowLabel: string;
	readonly scenarioId: string;
	readonly reply: string;
}

const CONFIG_CASES: readonly ConfigCase[] = [
	{ name: 'Default effort (untouched), full context', expectedEffort: 'medium', contextLabel: '1M', expectedCompactThreshold: 829_800, expectedConfigLabel: 'Medium 1M', expectedContextWindowLabel: '1M', scenarioId: 'smoke-model-config-default-long', reply: 'MOCKED_MODEL_CONFIG_DEFAULT_LONG' },
	{ name: 'High effort, full context', effortLabel: 'High', expectedEffort: 'high', contextLabel: '1M', expectedCompactThreshold: 829_800, expectedConfigLabel: 'High 1M', expectedContextWindowLabel: '1M', scenarioId: 'smoke-model-config-high-long', reply: 'MOCKED_MODEL_CONFIG_HIGH_LONG' },
	{ name: 'Medium effort, default context', effortLabel: 'Medium', expectedEffort: 'medium', contextLabel: '272K', expectedCompactThreshold: 244_800, expectedConfigLabel: 'Medium 272K', expectedContextWindowLabel: '400K', scenarioId: 'smoke-model-config-medium-default', reply: 'MOCKED_MODEL_CONFIG_MEDIUM_DEFAULT' },
];

function findResponsesRequest(requests: CapturedRequest[], fromIndex: number, scenarioTag: string): any | undefined {
	for (let i = requests.length - 1; i >= fromIndex; i--) {
		const request = requests[i];
		if (request.path !== '/responses' || request.body?.model !== MODEL_ID) {
			continue;
		}
		if (latestUserInputCarriesTag(request.body, scenarioTag)) {
			return request.body;
		}
	}
	return undefined;
}

function latestUserInputCarriesTag(body: any, scenarioTag: string): boolean {
	const input = Array.isArray(body?.input) ? body.input : [];
	for (let i = input.length - 1; i >= 0; i--) {
		const item = input[i];
		if (item?.role !== 'user') {
			continue;
		}
		const content = typeof item.content === 'string'
			? item.content
			: Array.isArray(item.content)
				? item.content.map((part: any) => part?.text ?? '').join('')
				: '';
		return content.includes(scenarioTag);
	}
	return false;
}

async function sendWarmUpUntilReady(chat: Chat, logger: Logger): Promise<void> {
	const tag = '[scenario:smoke-model-config-warmup]';
	const deadline = Date.now() + 180_000;
	let attempt = 0;
	let lastError: unknown;
	while (Date.now() < deadline) {
		attempt++;
		try {
			await chat.sendMessage(`warm up ${tag}`);
			await chat.waitForResponseText('MOCKED_WARMUP', 25_000);
			logger.log(`[Chat Model Config] warm-up succeeded on attempt ${attempt}`);
			return;
		} catch (error) {
			lastError = error;
			logger.log(`[Chat Model Config] warm-up attempt ${attempt} not ready yet; retrying`);
		}
	}
	throw new Error(`Chat did not become ready for warm-up within timeout. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function setup(logger: Logger) {

	describe('Chat Model Configuration', function () {
		this.timeout(5 * 60 * 1000);
		this.retries(0);

		let mockServer: MockServerWithRequests;

		before(async function () {
			const { startServer, ScenarioBuilder, registerScenario } = require(getMockLlmServerPath());

			registerScenario('text-only', new ScenarioBuilder().emit('OK').build());

			registerScenario('smoke-model-config-warmup', new ScenarioBuilder().emit('MOCKED_WARMUP').build());

			for (const testCase of CONFIG_CASES) {
				registerScenario(testCase.scenarioId, new ScenarioBuilder().emit(testCase.reply).build());
			}

			mockServer = await startServer(0, { logger: (msg: string) => logger.log(`[mock-llm] ${msg}`), captureRequests: true });
			logger.log(`[Chat Model Config] mock LLM server started at ${mockServer.url}`);
		});

		installAllHandlers(logger, opts => {
			const copilotEnv = getCopilotSmokeTestEnv(mockServer, { userDataDir: opts.userDataDir });
			return {
				...opts,
				extraArgs: [...(opts.extraArgs ?? []), '--log=trace'],
				extraEnv: {
					...(opts.extraEnv ?? {}),
					...copilotEnv,
				},
			};
		}, async app => {
			await preseedChatExtensionEnablement(app.userDataPath);
		});

		before(async function () {
			const app = this.app as Application;
			logger.log(`[Chat Model Config] writing user settings (mock URL=${mockServer.url})`);

			await app.workbench.settingsEditor.addUserSettings([
				['github.copilot.advanced.debug.overrideProxyUrl', JSON.stringify(mockServer.url)],
				['github.copilot.advanced.debug.overrideCapiUrl', JSON.stringify(mockServer.url)],
				['github.copilot.advanced.debug.overrideAuthType', '"token"'],
				['chat.allowAnonymousAccess', 'true'],
				['github.copilot.chat.githubMcpServer.enabled', 'false'],
				['chat.mcp.discovery.enabled', 'false'],
				['chat.mcp.enabled', 'false'],
				['chat.disableAIFeatures', 'false'],
				['chat.contextUsage.enabled', 'true'],
				['github.copilot.chat.responsesApiContextManagement.enabled', 'true'],
			]);
			logger.log(`[Chat Model Config] user settings written`);
		});

		after(async function () {
			await mockServer?.close();
		});

		it('forwards the selected reasoning effort and context size to the server', async function () {
			const app = this.app as Application;
			const chat = app.workbench.chat;

			try {
				await app.workbench.quickaccess.runCommand('smoketest.openLocalChat');
				await chat.waitForChatView();

				await sendWarmUpUntilReady(chat, logger);

				await chat.selectModel(MODEL_NAME);

				for (const testCase of CONFIG_CASES) {
					logger.log(`[Chat Model Config] case '${testCase.name}': selecting effort='${testCase.effortLabel ?? '(default)'}', context='${testCase.contextLabel}'`);

					await chat.openModelConfig();
					if (testCase.effortLabel) {
						await chat.selectModelConfigOption(testCase.effortLabel);
					}
					await chat.selectModelConfigOption(testCase.contextLabel);
					await chat.closeModelConfig();

					const configLabel = await chat.getModelConfigLabel();
					assert.strictEqual(
						configLabel.replace(/\s+/g, ' ').trim(),
						testCase.expectedConfigLabel,
						`Expected model-config button label '${testCase.expectedConfigLabel}' for '${testCase.name}', got '${configLabel}'.`
					);

					const requestsBefore = mockServer.getRequests().length;
					const scenarioTag = `[scenario:${testCase.scenarioId}]`;

					await chat.sendMessage(`explain this ${scenarioTag}`);
					const responseText = (await chat.waitForResponseText(testCase.reply, 120_000)).trim();

					assert.ok(
						responseText.includes(testCase.reply),
						`Expected response for '${testCase.name}' to include "${testCase.reply}".\n\nResponse:\n${responseText}`
					);

					const requestBody = findResponsesRequest(mockServer.getRequests(), requestsBefore, scenarioTag);
					assert.ok(
						requestBody,
						`Expected a /responses request carrying ${scenarioTag} for '${testCase.name}'.`
					);

					assert.strictEqual(
						requestBody.reasoning?.effort,
						testCase.expectedEffort,
						`Expected reasoning.effort='${testCase.expectedEffort}' for '${testCase.name}', got '${requestBody.reasoning?.effort}'.`
					);

					const compactThreshold = requestBody.context_management?.[0]?.compact_threshold;
					assert.strictEqual(
						compactThreshold,
						testCase.expectedCompactThreshold,
						`Expected context_management compact_threshold=${testCase.expectedCompactThreshold} for '${testCase.name}', got ${compactThreshold}.`
					);

					const usageLabel = await chat.readContextUsageTokenLabel();
					const contextWindowLabel = usageLabel.match(/\/\s*([\d.]+[KM]?)\s*tokens/)?.[1];
					assert.strictEqual(
						contextWindowLabel,
						testCase.expectedContextWindowLabel,
						`Expected context-usage gauge denominator='${testCase.expectedContextWindowLabel}' for '${testCase.name}', got '${contextWindowLabel}' (full label '${usageLabel}').`
					);

					logger.log(`[Chat Model Config] case '${testCase.name}' verified: reasoning.effort='${requestBody.reasoning?.effort}', compact_threshold=${compactThreshold}, contextWindow='${contextWindowLabel}'`);
				}
			} catch (error) {
				logger.log(`[Chat Model Config] FAILURE: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
				await dumpFailureDiagnostics(app, logger, 'Chat Model Configuration');
				throw error;
			} finally {
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
			}
		});
	});
}
