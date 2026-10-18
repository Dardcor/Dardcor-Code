/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as vscode from 'vscode';
import { DeferredPromise, assertNoRpc, closeAllEditors, disposeAll } from '../utils';

const isWindows = process.platform === 'win32';

function extractTextContent(result: vscode.LanguageModelToolResult): string {
	return result.content
		.filter((c): c is vscode.LanguageModelTextPart => c instanceof vscode.LanguageModelTextPart)
		.map(c => c.value)
		.join('');
}

(vscode.env.uiKind === vscode.UIKind.Web ? suite.skip : suite)('chat - run_in_terminal', () => {

	let disposables: vscode.Disposable[] = [];
	let originalShellIntegrationEnabled: boolean | undefined;
	let windowsUseConptyDll: boolean | undefined;

	setup(async () => {
		disposables = [];

		const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated');
		originalShellIntegrationEnabled = terminalConfig.get<boolean>('shellIntegration.enabled');
		await terminalConfig.update('shellIntegration.enabled', true, vscode.ConfigurationTarget.Global);

		if (isWindows) {
			windowsUseConptyDll = terminalConfig.get<boolean>('windowsUseConptyDll');
			await terminalConfig.update('windowsUseConptyDll', true, vscode.ConfigurationTarget.Global);
		}

		const testLanguageModelProvider: vscode.LanguageModelChatProvider = {
			async provideLanguageModelChatInformation(_options, _token) {
				return [{
					id: 'test-lm',
					name: 'test-lm',
					family: 'test',
					version: '1.0.0',
					maxInputTokens: 100,
					maxOutputTokens: 100,
					isDefault: true,
					isUserSelectable: true,
					capabilities: {}
				}];
			},
			async provideLanguageModelChatResponse(_model, _messages, _options, _progress, _token) {
				return undefined;
			},
			async provideTokenCount(_model, _text, _token) {
				return 1;
			},
		};
		disposables.push(
			vscode.lm.registerLanguageModelChatProvider('test-lm-vendor', testLanguageModelProvider),
			vscode.lm.registerLanguageModelChatProvider('copilot', testLanguageModelProvider),
		);


		const chatToolsConfig = vscode.workspace.getConfiguration('chat.tools.global');
		await chatToolsConfig.update('autoApprove', true, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('setContext', 'vscode.chat.tools.global.autoApprove.testMode', true);
	});

	teardown(async () => {
		assertNoRpc();
		await closeAllEditors();
		disposeAll(disposables);
		participantRegistered = false;
		pendingResult = undefined;
		pendingCommand = undefined;
		pendingOptions = undefined;

		const chatToolsConfig = vscode.workspace.getConfiguration('chat.tools.global');
		await chatToolsConfig.update('autoApprove', undefined, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('setContext', 'vscode.chat.tools.global.autoApprove.testMode', undefined);

		const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated');
		await terminalConfig.update('shellIntegration.enabled', originalShellIntegrationEnabled, vscode.ConfigurationTarget.Global);

		if (isWindows) {
			await terminalConfig.update('windowsUseConptyDll', windowsUseConptyDll, vscode.ConfigurationTarget.Global);
		}
	});

	interface RunInTerminalOptions {
		timeout?: number;
		requestUnsandboxedExecution?: boolean;
		requestUnsandboxedExecutionReason?: string;
		autoAcceptConfirmation?: boolean;
	}

	let participantRegistered = false;
	let pendingResult: DeferredPromise<vscode.LanguageModelToolResult> | undefined;
	let pendingCommand: string | undefined;
	let pendingOptions: RunInTerminalOptions | undefined;

	function setupParticipant() {
		if (participantRegistered) {
			return;
		}
		participantRegistered = true;
		const participant = vscode.chat.createChatParticipant('api-test.participant', async (request, _context, _progress, _token) => {
			if (!pendingResult || !pendingCommand) {
				return {};
			}
			const currentResult = pendingResult;
			const currentCommand = pendingCommand;
			const currentOptions = pendingOptions ?? {};
			pendingResult = undefined;
			pendingCommand = undefined;
			pendingOptions = undefined;
			try {
				const result = await vscode.lm.invokeTool('run_in_terminal', {
					input: {
						command: currentCommand,
						explanation: 'Integration test command',
						goal: 'Test run_in_terminal output',
						isBackground: false,
						timeout: currentOptions.timeout ?? 15000,
						...currentOptions.requestUnsandboxedExecution ? {
							requestUnsandboxedExecution: true,
							requestUnsandboxedExecutionReason: currentOptions.requestUnsandboxedExecutionReason,
						} : {},
					},
					toolInvocationToken: request.toolInvocationToken,
				});
				currentResult.complete(result);
			} catch (e) {
				currentResult.error(e);
			}
			return {};
		});
		disposables.push(participant);
	}

	async function invokeRunInTerminal(command: string, options?: RunInTerminalOptions): Promise<string>;
	async function invokeRunInTerminal(command: string, timeout?: number): Promise<string>;
	async function invokeRunInTerminal(command: string, optionsOrTimeout?: RunInTerminalOptions | number): Promise<string> {
		setupParticipant();

		const opts: RunInTerminalOptions = typeof optionsOrTimeout === 'number'
			? { timeout: optionsOrTimeout }
			: optionsOrTimeout ?? {};
		const resultPromise = new DeferredPromise<vscode.LanguageModelToolResult>();
		pendingResult = resultPromise;
		pendingCommand = command;
		pendingOptions = opts;

		let acceptConfirmationInterval: ReturnType<typeof setInterval> | undefined;
		const acceptPendingConfirmation = async () => {
			try {
				await vscode.commands.executeCommand('workbench.action.chat.acceptTool');
				await vscode.commands.executeCommand('workbench.action.chat.acceptElicitation');
			} catch {
			}
		};

		try {
			await vscode.commands.executeCommand('workbench.action.chat.newLocalChat');
			if (opts.autoAcceptConfirmation) {
				acceptConfirmationInterval = setInterval(() => void acceptPendingConfirmation(), 200);
			}
			await vscode.commands.executeCommand('workbench.action.chat.open', { query: '@participant test' });

			const result = await resultPromise.p;
			return extractTextContent(result);
		} finally {
			if (acceptConfirmationInterval) {
				clearInterval(acceptConfirmationInterval);
			}
		}
	}

	test('tool should be registered with expected schema', async function () {
		this.timeout(15000);
		let tool: vscode.LanguageModelToolInformation | undefined;
		for (let i = 0; i < 50; i++) {
			tool = vscode.lm.tools.find(t => t.name === 'run_in_terminal');
			if (tool) {
				break;
			}
			await new Promise(r => setTimeout(r, 200));
		}
		assert.ok(tool, 'run_in_terminal tool should be registered');
		assert.ok(tool.inputSchema, 'Tool should have an input schema');

		const schema = tool.inputSchema as { properties?: Record<string, unknown> };
		assert.ok(schema.properties?.['command'], 'Schema should have a command property');
		assert.ok(schema.properties?.['explanation'], 'Schema should have an explanation property');
		assert.ok(schema.properties?.['goal'], 'Schema should have a goal property');
		assert.ok(schema.properties?.['mode'], 'Schema should have a mode property');
	});


	suite('sandbox off', () => {

		test.skip('echo command returns exactly the echoed text', async function () {
			this.timeout(60000);

			const marker = `MARKER_${Date.now()}_ECHO`;
			const output = await invokeRunInTerminal(`echo ${marker}`);

			assert.strictEqual(output.trim(), marker);
		});

		test('no-output command reports empty output, not prompt echo (issue #303531)', async function () {
			this.timeout(60000);

			const command = isWindows ? 'cmd /c rem' : 'true';
			const output = await invokeRunInTerminal(command);

			assert.strictEqual(output.trim(), 'Command produced no output');
		});

		test.skip('multi-line output preserves all lines in order', async function () {
			this.timeout(60000);

			const m1 = `M1_${Date.now()}`;
			const m2 = `M2_${Date.now()}`;
			const m3 = `M3_${Date.now()}`;
			const sep = isWindows ? ';' : '&&';
			const output = await invokeRunInTerminal(`echo ${m1} ${sep} echo ${m2} ${sep} echo ${m3}`);

			assert.strictEqual(output.trim(), `${m1}\n${m2}\n${m3}`);
		});

		(isWindows ? test : test.skip)('&& operators are converted to ; on PowerShell', async function () {
			this.timeout(60000);

			const m1 = `CHAIN_${Date.now()}_A`;
			const m2 = `CHAIN_${Date.now()}_B`;
			const output = await invokeRunInTerminal(`echo ${m1} && echo ${m2}`);

			const trimmed = output.trim();
			assert.ok(trimmed.startsWith('Note: The tool simplified the command to'), `Expected rewrite note, got: ${trimmed}`);
			assert.ok(trimmed.endsWith(`${m1}\n${m2}`), `Expected markers at end, got: ${trimmed}`);
		});

		test.skip('non-zero exit code is reported', async function () {
			this.timeout(60000);

			const command = isWindows ? 'cmd /c exit 42' : 'bash -c "exit 42"';
			const output = await invokeRunInTerminal(command);

			const acceptable = [
				'Command produced no output\nCommand exited with code 42',
				...(isWindows ? ['Command produced no output\nCommand exited with code 1'] : []),
			];
			assert.ok(acceptable.includes(output.trim()), `Unexpected output: ${JSON.stringify(output.trim())}`);
		});

		test('output with special characters is captured verbatim', async function () {
			this.timeout(60000);

			const marker = `SP_${Date.now()}`;
			const output = await invokeRunInTerminal(`echo "${marker} hello & world"`);

			assert.strictEqual(output.trim(), `${marker} hello & world`);
		});

	});


	(isWindows ? suite.skip : suite)('sandbox on', () => {

		setup(async () => {
			const configuration = vscode.workspace.getConfiguration();
			await configuration.update('chat.agent.sandbox.enabled', 'on', vscode.ConfigurationTarget.Global);
		});

		teardown(async () => {
			const configuration = vscode.workspace.getConfiguration();
			await configuration.update('chat.agent.sandbox.enabled', undefined, vscode.ConfigurationTarget.Global);
		});

		test.skip('echo works in sandbox and output is clean', async function () {
			this.timeout(60000);

			const marker = `SANDBOX_ECHO_${Date.now()}`;
			const output = await invokeRunInTerminal(`echo ${marker}`);

			assert.strictEqual(output.trim(), marker);
		});

		test.skip('network requests to allowlisted domains succeed in sandbox', async function () {
			this.timeout(60000);

			const configuration = vscode.workspace.getConfiguration();
			await configuration.update('chat.agent.allowedNetworkDomains', ['example.com'], vscode.ConfigurationTarget.Global);
			try {
				const output = await invokeRunInTerminal('curl -s --max-time 5 https://example.com');
				const trimmed = output.trim();
				const acceptable = [
					'Command produced no output',
					'<title>Example Domain</title>',
				];
				assert.ok(acceptable.some(value => trimmed.includes(value) || trimmed === value), `Unexpected output: ${JSON.stringify(trimmed)}`);
			} finally {
				await configuration.update('chat.agent.allowedNetworkDomains', undefined, vscode.ConfigurationTarget.Global);
			}
		});

		test.skip('requestUnsandboxedExecution preserves sandbox $TMPDIR', async function () {
			this.timeout(60000);

			const marker = `SANDBOX_UNSANDBOX_${Date.now()}`;
			const sentinelName = `sentinel-${marker}.txt`;

			const writeOutput = await invokeRunInTerminal(`echo ${marker} > "$TMPDIR/${sentinelName}" && echo ${marker}`);
			assert.ok(writeOutput.trim().endsWith(marker), `Unexpected output: ${JSON.stringify(writeOutput.trim())}`);

			const retryOutput = await invokeRunInTerminal(`cat "$TMPDIR/${sentinelName}"`, {
				timeout: 30000,
				requestUnsandboxedExecution: true,
				requestUnsandboxedExecutionReason: 'Need to verify $TMPDIR persists on unsandboxed retry',
			});
			const trimmed = retryOutput.trim();
			assert.ok(trimmed.includes('Note: The tool simplified the command to'), `Unexpected output: ${JSON.stringify(trimmed)}`);
			assert.ok(trimmed.includes(`cat "$TMPDIR/${sentinelName}"`), `Unexpected output: ${JSON.stringify(trimmed)}`);
			assert.ok(trimmed.endsWith(marker), `Unexpected output: ${JSON.stringify(trimmed)}`);
		});

		test.skip('cannot write to /tmp', async function () {
			this.timeout(60000);

			const marker = `SANDBOX_TMP_${Date.now()}`;
			const output = await invokeRunInTerminal(`echo "${marker}" > /tmp/${marker}.txt && cat /tmp/${marker}.txt && rm /tmp/${marker}.txt`, {
				autoAcceptConfirmation: true,
			});

			const trimmed = output.trim();
			assert.ok(trimmed.startsWith('Note: The tool simplified the command to'), `Unexpected output: ${JSON.stringify(trimmed)}`);
			assert.ok(trimmed.includes(`/tmp/${marker}.txt`), `Unexpected output: ${JSON.stringify(trimmed)}`);
			assert.ok(trimmed.endsWith(marker), `Unexpected output: ${JSON.stringify(trimmed)}`);
		});

		test.skip('can read files outside the workspace', async function () {
			this.timeout(60000);

			const output = await invokeRunInTerminal('head -1 /etc/shells');

			const trimmed = output.trim();
			const lastLine = trimmed.split('\n').pop() ?? '';
			assert.ok(
				lastLine.startsWith('#'),
				`Expected a comment line from /etc/shells, got: ${trimmed}`
			);
		});

		test.skip('can write inside the workspace folder', async function () {
			this.timeout(60000);

			const marker = `SANDBOX_WS_${Date.now()}`;
			const output = await invokeRunInTerminal(`echo "${marker}" > .sandbox-test-${marker}.tmp && cat .sandbox-test-${marker}.tmp && rm .sandbox-test-${marker}.tmp`);

			assert.strictEqual(output.trim(), marker);
		});

		test.skip('$TMPDIR is writable inside the sandbox', async function () {
			this.timeout(60000);

			const marker = `SANDBOX_TMPDIR_${Date.now()}`;
			const output = await invokeRunInTerminal(`echo "${marker}" > "$TMPDIR/${marker}.tmp" && cat "$TMPDIR/${marker}.tmp" && rm "$TMPDIR/${marker}.tmp"`);

			const trimmed = output.trim();
			const lastLine = trimmed.split('\n').pop() ?? '';
			assert.strictEqual(lastLine, marker, `Unexpected output: ${JSON.stringify(trimmed)}`);
		});

		test.skip('non-allowlisted domains trigger unsandboxed confirmation flow', async function () {
			this.timeout(60000);

			const marker = `SANDBOX_DOMAIN_${Date.now()}`;
			const output = await invokeRunInTerminal(`echo https://example.net >/dev/null && echo "${marker}" > /tmp/${marker}.txt && cat /tmp/${marker}.txt && rm /tmp/${marker}.txt`);

			const trimmed = output.trim();
			assert.ok(trimmed.startsWith('Note: The tool simplified the command to'), `Unexpected output: ${JSON.stringify(trimmed)}`);
			assert.ok(trimmed.includes('https://example.net'), `Unexpected output: ${JSON.stringify(trimmed)}`);
			assert.ok(trimmed.endsWith(marker), `Unexpected output: ${JSON.stringify(trimmed)}`);
		});
	});
});
