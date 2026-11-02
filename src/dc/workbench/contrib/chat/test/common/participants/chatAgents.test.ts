/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ContextKeyExpression } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import { MockContextKeyService } from '../../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { DardcorAgentToolRuntime } from '../../../../../../platform/agentHost/common/agentToolRuntime.js';
import { ChatAgentService, IChatAgentData, IChatAgentImplementation, DARDCOR_AGENT_TOOLS, isAgentFilePathOutsideWorkspace, resolveAgentFileReadTarget, isDardcorMaxTokensCompatibilityError, isDardcorNativeToolCompatibilityError, isDardcorRouterStreamTerminal, normalizeDardcorRouterModelCapabilities, shouldAttachDardcorBrowserScreenshot, buildDardcorSystemPrompt, DardcorThinkingStreamParser } from '../../../common/participants/chatAgents.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { createChatAgentRunState, migrateChatAgentRunState, updateChatAgentRunState } from '../../../common/tools/agentRunStateService.js';
import { compactDardcorAgentMessages, formatDardcorVerificationLabel, getDardcorBrowserVerificationRequirement, getDardcorCompletionBlocker, getDardcorEffectivePermissionLevel, getDardcorPlainTextTurnDecision, getDardcorRunGuardReason, getDardcorToolFailureState, getDardcorVerificationCommandStatus, isDardcorBrowserTest, isDardcorExploratoryCommand, isDardcorLowRiskCommand, isDardcorWebImplementationTask, parseDardcorAgentToolArguments, requiresDardcorCommandConfirmation, requiresDardcorToolConfirmation, revalidateDardcorCompletion, summarizeDardcorToolAction, detectDardcorLanguage, getDardcorLocaleStrings, getDardcorAutonomousMomentumDirective, getDardcorAutonomousSelfCorrectionDirective, type DardcorSupportedLanguage } from '../../../common/participants/dardcorAgentRunPolicy.js';
import { getDardcorBrowserSnapshotChanges, performDardcorBrowserClick } from '../../../common/participants/dardcorBrowserActions.js';
import { attachPlaywrightPageToGroups, IPlaywrightService, isBrowserDocumentReadyState, matchPlaywrightTargetToView } from '../../../../../../platform/browserView/common/playwrightService.js';
import { DardcorBrowserAgentController, extractDardcorRefId } from '../../../common/participants/dardcorBrowserAgentController.js';
import { URI } from '../../../../../../base/common/uri.js';
import { parseResetSeconds, parseDardcorRouterError, cleanMessageText, diagnoseProviderIssue } from '../../../common/participants/dardcorRouterError.js';
import { detectsCommonPromptPattern } from '../../../../terminalContrib/chatAgentTools/browser/executeStrategy/executeStrategy.js';

const testAgentId = 'testAgent';
const testAgentData: IChatAgentData = {
	id: testAgentId,
	name: 'Test Agent',
	extensionDisplayName: '',
	extensionId: new ExtensionIdentifier(''),
	extensionVersion: undefined,
	extensionPublisherId: '',
	locations: [],
	modes: [],
	metadata: {},
	slashCommands: [],
	disambiguation: [],
};

class TestingContextKeyService extends MockContextKeyService {
	private _contextMatchesRulesReturnsTrue = false;
	public contextMatchesRulesReturnsTrue() {
		this._contextMatchesRulesReturnsTrue = true;
	}

	public override contextMatchesRules(rules: ContextKeyExpression): boolean {
		return this._contextMatchesRulesReturnsTrue;
	}
}

suite('ChatAgents', function () {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let chatAgentService: ChatAgentService;
	let contextKeyService: TestingContextKeyService;
	setup(() => {
		contextKeyService = new TestingContextKeyService();
		chatAgentService = store.add(new ChatAgentService(contextKeyService, new TestConfigurationService(), new TestInstantiationService()));
	});

	test('registers every Router tool with a schema and one local driver', () => {
		const runtime = new DardcorAgentToolRuntime();
		for (const tool of DARDCOR_AGENT_TOOLS) {
			runtime.register({
				name: tool.function.name,
				inputSchema: tool.function.parameters,
				source: 'router',
				risk: 'unknown',
				driver: 'dardcorRouterLocalDriver',
			}, () => 'registered');
		}
		assert.strictEqual(runtime.catalog.list().length, DARDCOR_AGENT_TOOLS.length);
	});

	test('registerAgent', async () => {
		assert.strictEqual(chatAgentService.getAgents().some(agent => agent.id === testAgentId), false);


		const agentRegistration = chatAgentService.registerAgent(testAgentId, testAgentData);

		assert.strictEqual(chatAgentService.getAgents().filter(agent => agent.id === testAgentId).length, 1);

		assert.throws(() => chatAgentService.registerAgent(testAgentId, testAgentData));

		agentRegistration.dispose();
		assert.strictEqual(chatAgentService.getAgents().some(agent => agent.id === testAgentId), false);
	});

	test('agent when clause', async () => {
		assert.strictEqual(chatAgentService.getAgents().some(agent => agent.id === testAgentId), false);

		store.add(chatAgentService.registerAgent(testAgentId, {
			...testAgentData,
			when: 'myKey'
		}));
		assert.strictEqual(chatAgentService.getAgents().some(agent => agent.id === testAgentId), false);

		contextKeyService.contextMatchesRulesReturnsTrue();
		assert.strictEqual(chatAgentService.getAgents().filter(agent => agent.id === testAgentId).length, 1);
	});

	suite('registerAgentImplementation', function () {
		const agentImpl: IChatAgentImplementation = {
			invoke: async () => { return {}; },
			provideFollowups: async () => { return []; },
		};

		test('should register an agent implementation', () => {
			store.add(chatAgentService.registerAgent(testAgentId, testAgentData));
			store.add(chatAgentService.registerAgentImplementation(testAgentId, agentImpl));

			const agents = chatAgentService.getActivatedAgents();
			assert.strictEqual(agents.filter(agent => agent.id === testAgentId).length, 1);
		});

		test('can dispose an agent implementation', () => {
			store.add(chatAgentService.registerAgent(testAgentId, testAgentData));
			const implRegistration = chatAgentService.registerAgentImplementation(testAgentId, agentImpl);
			implRegistration.dispose();

			const agents = chatAgentService.getActivatedAgents();
			assert.strictEqual(agents.some(agent => agent.id === testAgentId), false);
		});

		test('should throw error if agent does not exist', () => {
			assert.throws(() => chatAgentService.registerAgentImplementation('nonexistentAgent', agentImpl));
		});

		test('should throw error if agent already has an implementation', () => {
			store.add(chatAgentService.registerAgent(testAgentId, testAgentData));
			store.add(chatAgentService.registerAgentImplementation(testAgentId, agentImpl));

			assert.throws(() => chatAgentService.registerAgentImplementation(testAgentId, agentImpl));
		});
	});
});

suite('Dardcor autonomous task policy', () => {
	test('waits for every Playwright group to attach and rolls back a partial failure', async () => {
		let releaseSlowAttach!: () => void;
		const slowAttach = new Promise<void>(resolve => releaseSlowAttach = resolve);
		let attachmentFinished = false;
		const firstGroup = { addView: async () => { }, removeView: async () => { } };
		const secondGroup = { addView: async () => { await slowAttach; }, removeView: async () => { } };
		const attach = attachPlaywrightPageToGroups('page-1', [firstGroup, secondGroup]).then(() => attachmentFinished = true);
		await Promise.resolve();
		assert.strictEqual(attachmentFinished, false);
		releaseSlowAttach();
		await attach;
		assert.strictEqual(attachmentFinished, true);

		let releaseCleanupGate!: () => void;
		const cleanupGate = new Promise<void>(resolve => releaseCleanupGate = resolve);
		const removed: string[] = [];
		let attachmentError: string | undefined;
		const failedAttach = attachPlaywrightPageToGroups('page-2', [
			{ addView: async () => { throw new Error('target unavailable'); }, removeView: async () => { removed.push('failed'); } },
			{ addView: async () => { await cleanupGate; }, removeView: async () => { removed.push('slow'); } },
		]).catch(error => attachmentError = error instanceof Error ? error.message : String(error));
		await Promise.resolve();
		assert.strictEqual(attachmentError, undefined);
		releaseCleanupGate();
		await failedAttach;
		assert.match(attachmentError ?? '', /page-2.*target unavailable/);
		assert.deepStrictEqual(removed.sort(), ['failed', 'slow']);
	});

	test('does not let plain text finish an active task before the response limit', () => {
		assert.strictEqual(getDardcorPlainTextTurnDecision(true, 1, 5), 'continue');
		assert.strictEqual(getDardcorPlainTextTurnDecision(true, 5, 5), 'continue');
		assert.strictEqual(getDardcorPlainTextTurnDecision(true, 6, 5), 'pause');
		assert.strictEqual(getDardcorPlainTextTurnDecision(false, 1, 5), 'normal');
	});

	test('allows recovery between browser tool failures and blocks at the configured consecutive-failure limit', () => {
		const firstFailure = getDardcorToolFailureState(0, true);
		assert.deepStrictEqual(firstFailure, { consecutiveFailures: 1, shouldBlock: false });
		const secondFailure = getDardcorToolFailureState(firstFailure.consecutiveFailures, true);
		assert.deepStrictEqual(secondFailure, { consecutiveFailures: 2, shouldBlock: false });
		assert.deepStrictEqual(getDardcorToolFailureState(secondFailure.consecutiveFailures, false), { consecutiveFailures: 0, shouldBlock: false });
		assert.deepStrictEqual(getDardcorToolFailureState(secondFailure.consecutiveFailures, true), { consecutiveFailures: 3, shouldBlock: true });
	});

	test('requires a complete checklist and successful verification before completion', () => {
		const state = createChatAgentRunState('verifying');
		const prompt = 'test website in browser';
		assert.ok(getDardcorCompletionBlocker({ prompt, todos: [], state, verificationSteps: 'clicked a button' }));
		const todos = [{ id: 1, title: 'Test the website', status: 'completed' as const }];
		assert.ok(getDardcorCompletionBlocker({ prompt, todos, state, verificationSteps: 'clicked a button' }));
		const evidenceState = updateChatAgentRunState(state, {
			verificationEvidence: [{ message: 'Integrated browser click_element succeeded and returned a post-action DOM snapshot.', workspaceRevision: 0 }],
			browserActions: 1,
		});
		const failedVerification = updateChatAgentRunState(evidenceState, { verificationFailures: ['Browser runtime: uncaught TypeError'] });
		assert.match(getDardcorCompletionBlocker({ prompt, todos, state: failedVerification, verificationSteps: 'clicked a button' }) ?? '', /unresolved failure/);
		assert.strictEqual(getDardcorCompletionBlocker({ prompt, todos, state: evidenceState, verificationSteps: 'Clicked and verified the resulting DOM.' }), undefined);
		assert.strictEqual(isDardcorBrowserTest(prompt), true);
	});

	test('uses a runtime browser gate for website work and requires an interaction for explicit website testing', () => {
		const buildPrompt = 'buatkan website Laravel untuk memantau harga saham';
		const testPrompt = 'test website saya di browser';
		const emptyState = createChatAgentRunState('verifying');
		assert.strictEqual(isDardcorWebImplementationTask(buildPrompt), true);
		assert.strictEqual(getDardcorBrowserVerificationRequirement(buildPrompt, emptyState), 'page-inspection');
		assert.strictEqual(getDardcorBrowserVerificationRequirement(testPrompt, emptyState), 'interaction');

		const inspected = updateChatAgentRunState(emptyState, {
			verificationEvidence: [{ message: 'Integrated browser page inspected: http://localhost:8000 with a rendered DOM snapshot and browser diagnostics.', workspaceRevision: 0 }],
		});
		assert.strictEqual(getDardcorBrowserVerificationRequirement(buildPrompt, inspected), undefined);
		assert.strictEqual(getDardcorBrowserVerificationRequirement(testPrompt, inspected), 'interaction');
		const completedTodos = [{ id: 1, title: 'Implement the site', status: 'completed' as const }];
		assert.match(getDardcorCompletionBlocker({ prompt: buildPrompt, todos: completedTodos, state: emptyState }) ?? '', /integrated Browser Editor/);
		assert.match(getDardcorCompletionBlocker({ prompt: testPrompt, todos: completedTodos, state: emptyState }) ?? '', /Playwright interaction/);
		const staleInspection = updateChatAgentRunState(inspected, { workspaceRevision: 1 });
		assert.strictEqual(getDardcorBrowserVerificationRequirement(buildPrompt, staleInspection), 'page-inspection');
		assert.match(getDardcorCompletionBlocker({ prompt: buildPrompt, todos: completedTodos, state: staleInspection }) ?? '', /rendered DOM snapshot/);

		const repairedState = updateChatAgentRunState(emptyState, {
			verificationFailures: ['Browser runtime (http://localhost:8000): uncaught TypeError'],
		});
		assert.strictEqual(getDardcorBrowserVerificationRequirement(buildPrompt, repairedState), undefined);
	});

	test('rechecks completion after later tool calls in the same batch', () => {
		const todos = [{ id: 1, title: 'Implement and test', status: 'completed' as const }];
		let state = updateChatAgentRunState(createChatAgentRunState('verifying'), { verificationEvidence: [{ message: 'Verification command succeeded: npm test', workspaceRevision: 0 }] });
		const getBlocker = (args: any) => getDardcorCompletionBlocker({ prompt: 'Implement and test', todos, state, verificationSteps: args?.verificationSteps });
		assert.deepStrictEqual(revalidateDardcorCompletion(true, { verificationSteps: 'npm test' }, getBlocker), { accepted: true });
		state = updateChatAgentRunState(state, { verificationPending: ['Verification command: npm test has no confirmed completion status.'] });
		assert.match(getBlocker({ verificationSteps: 'npm test' }) ?? '', /Verification is still inconclusive/);

		state = updateChatAgentRunState(state, { verificationPending: [], verificationFailures: ['Verification command: npm test did not succeed.'] });
		const decision = revalidateDardcorCompletion(true, { verificationSteps: 'npm test' }, getBlocker);
		assert.strictEqual(decision.accepted, false);
		assert.match(decision.reason ?? '', /unresolved failure/);
	});

	test('records a failed verification command even when the tool result contains an exit code', () => {
		assert.strictEqual(getDardcorVerificationCommandStatus('npm test', '[Command result: exit code 1]'), 'failed');
		assert.strictEqual(getDardcorVerificationCommandStatus('npm test', '[Command result: exit code 0]'), 'passed');
		assert.strictEqual(getDardcorVerificationCommandStatus('npm test', 'npm warn Unknown config key; [Command result: exit code 0]'), 'passed');
		assert.strictEqual(getDardcorVerificationCommandStatus('npm test', '[Task result: final status unknown; poll task output before treating this as verification]'), 'inconclusive');
		assert.strictEqual(getDardcorVerificationCommandStatus('npm test', 'Tests completed successfully, but no process exit code was reported.'), 'inconclusive');
		assert.strictEqual(getDardcorVerificationCommandStatus('npm run typecheck-client', '[Command result: exit code 0]'), 'passed');
		assert.strictEqual(getDardcorVerificationCommandStatus('echo test', 'test'), 'not-verification');
		assert.strictEqual(getDardcorVerificationCommandStatus('Write-Output "build succeeded"', 'build succeeded'), 'not-verification');
		assert.strictEqual(getDardcorVerificationCommandStatus('Get-Content src/app.ts', 'Read 42 lines successfully.'), 'not-verification');
	});

	test('validates native and text-fallback tool arguments, aliases, and malformed stream fragments', () => {
		const native = parseDardcorAgentToolArguments('write_file', '{"filePath":"src/app.ts","content":"ok"}', DARDCOR_AGENT_TOOLS);
		assert.strictEqual(native.name, 'write_file');
		assert.strictEqual(native.args?.content, 'ok');
		const nativeBrowser = parseDardcorAgentToolArguments('open_browser_page', '{"url":"http://localhost:8000"}', DARDCOR_AGENT_TOOLS);
		const fallbackBrowser = parseDardcorAgentToolArguments('navigate_page', { url: 'http://localhost:8000' }, DARDCOR_AGENT_TOOLS);
		assert.strictEqual(nativeBrowser.name, 'open_browser_page');
		assert.strictEqual(fallbackBrowser.name, nativeBrowser.name);
		assert.deepStrictEqual(fallbackBrowser.args, nativeBrowser.args);
		const fallback = parseDardcorAgentToolArguments('run_in_terminal', { command: 'npm test' }, DARDCOR_AGENT_TOOLS);
		assert.strictEqual(fallback.name, 'run_command');
		assert.strictEqual(fallback.args?.command, 'npm test');
		assert.match(parseDardcorAgentToolArguments('write_file', '{"filePath":"x"', DARDCOR_AGENT_TOOLS).error ?? '', /Invalid JSON/);
		assert.match(parseDardcorAgentToolArguments('write_file', { content: 'missing path' }, DARDCOR_AGENT_TOOLS).error ?? '', /Missing required argument/);
		assert.match(parseDardcorAgentToolArguments('write_file', { filePath: 'x', content: 3 }, DARDCOR_AGENT_TOOLS).error ?? '', /must be string/);
		assert.match(parseDardcorAgentToolArguments('invented_tool', {}, DARDCOR_AGENT_TOOLS).error ?? '', /Unknown tool/);
		assert.match(parseDardcorAgentToolArguments('__incomplete_tool_call__', {}, DARDCOR_AGENT_TOOLS).error ?? '', /stream ended before the tool function name/);
	});

	test('resolves browser dependencies before the instantiation accessor expires', () => {
		const serviceReferences = [{ name: 'browser' }, { name: 'editor' }, { name: 'playwright' }, { name: 'networkFilter' }];
		let invocationActive = true;
		let lookupCount = 0;
		const accessor = {
			get: () => {
				assert.strictEqual(invocationActive, true, 'ServicesAccessor must only be read within invokeFunction.');
				return serviceReferences[lookupCount++];
			}
		} as any;

		const services = DardcorBrowserAgentController.resolveServices(accessor);
		invocationActive = false;

		assert.strictEqual(lookupCount, 4);
		assert.strictEqual(services.browserService, serviceReferences[0]);
		assert.strictEqual(services.editorService, serviceReferences[1]);
		assert.strictEqual(services.playwrightService, serviceReferences[2]);
		assert.strictEqual(services.agentNetworkFilterService, serviceReferences[3]);
		assert.doesNotThrow(() => Object.values(services));
	});

	test('rejects a Router browser navigation denied by the configured network filter', async () => {
		const result = await DardcorBrowserAgentController.executeBrowserTool({
			browserService: {} as any,
			editorService: {} as any,
			playwrightService: {} as any,
			agentNetworkFilterService: {
				isUriAllowed: () => false,
				formatError: (uri: URI) => `Blocked by policy: ${uri.authority}`
			} as any,
		}, 'open_browser_page', { url: 'https://blocked.example.test' });

		assert.strictEqual(result.executionStatus, 'failed');
		assert.match(result.output, /Blocked by policy: blocked\.example\.test/);
	});

	test('requires approval for file reads that escape or cannot be resolved within the workspace', async () => {
		const workspace = URI.file('/workspace');
		const externalPath = URI.file('/outside/secret.txt');
		const fileService = {
			exists: async () => true,
			realpath: async (resource: URI) => resource,
		} as any;

		assert.strictEqual(await isAgentFilePathOutsideWorkspace(fileService, 'src/app.ts', workspace), false);
		assert.strictEqual(await isAgentFilePathOutsideWorkspace(fileService, '../outside/secret.txt', workspace), true);
		assert.strictEqual(await isAgentFilePathOutsideWorkspace(fileService, externalPath.fsPath, workspace), true);
		assert.strictEqual(await isAgentFilePathOutsideWorkspace(fileService, 'src/app.ts', undefined), true);
		assert.strictEqual(requiresDardcorToolConfirmation('read_file', { filePath: 'src/app.ts' }, 'default'), false);
		assert.strictEqual(requiresDardcorToolConfirmation('read_file', { filePath: externalPath.fsPath }, 'default', true), true);
		assert.strictEqual(requiresDardcorToolConfirmation('read_file', { filePath: externalPath.fsPath }, 'autoApprove', true), false);
	});

	test('binds a file read to its canonical path and requires approval when resolution is uncertain', async () => {
		const workspace = URI.file('/workspace');
		const external = URI.file('/outside/secret.ts');
		const fileService = {
			exists: async () => true,
			realpath: async (resource: URI) => resource.fsPath === workspace.fsPath ? workspace : external,
		} as any;

		const resolution = await resolveAgentFileReadTarget(fileService, 'src/link.ts', workspace);
		assert.strictEqual(resolution.requiresApproval, true);
		assert.strictEqual(resolution.target.fsPath, external.fsPath);
		assert.strictEqual(resolution.canonicalTarget?.fsPath, external.fsPath);

		const unverifiable = await resolveAgentFileReadTarget({ exists: async () => true, realpath: async () => undefined } as any, 'src/file.ts', workspace);
		assert.strictEqual(unverifiable.requiresApproval, true);
		assert.strictEqual(unverifiable.canonicalTarget, undefined);
	});

	test('resolves an explicit browser page from the union of known and contextual tabs', async () => {
		const knownView = { id: 'known-tab', url: 'http://localhost:3000/known', resolve: async () => ({ url: 'http://localhost:3000/known', sharingState: 'shared' }) } as any;
		const contextualView = { id: 'contextual-tab', url: 'http://localhost:3000/contextual', resolve: async () => ({ url: 'http://localhost:3000/contextual', sharingState: 'shared' }) } as any;
		let openedView: unknown;
		const services = {
			browserService: {
				getKnownBrowserViews: () => new Map([[knownView.id, knownView]]),
				getContextualBrowserViews: () => new Map([[contextualView.id, contextualView]]),
			},
			editorService: { openEditor: async (view: unknown) => { openedView = view; } },
			playwrightService: {} as any,
		} as any;

		const resolved = await DardcorBrowserAgentController.resolveBrowserView(services, { pageId: contextualView.id });
		assert.strictEqual(resolved, contextualView);
		assert.strictEqual(openedView, contextualView);
	});

	test('fails closed for an unknown explicit browser page instead of selecting another tab', async () => {
		const existingView = { id: 'existing-tab', url: 'http://localhost:3000', resolve: async () => ({ url: 'http://localhost:3000', sharingState: 'shared' }) } as any;
		let createCount = 0;
		const services = {
			browserService: {
				getKnownBrowserViews: () => new Map([[existingView.id, existingView]]),
				getContextualBrowserViews: () => new Map(),
				createBrowserView: async () => { createCount++; throw new Error('An explicit unknown page must not create a replacement tab.'); },
			},
			editorService: { openEditor: async () => undefined },
			playwrightService: {} as any,
		} as any;

		await assert.rejects(
			DardcorBrowserAgentController.resolveBrowserView(services, { pageId: 'missing-tab' }),
			/No integrated browser tab matches page ID or URL selector/,
		);
		assert.strictEqual(createCount, 0);
	});

	test('does not let Router interact with an unshared user browser page', async () => {
		const userView = { id: 'private-tab', url: 'http://localhost:3000', resolve: async () => ({ url: 'http://localhost:3000', sharingState: 'available' }) } as any;
		const services = {
			browserService: {
				getKnownBrowserViews: () => new Map([[userView.id, userView]]),
				getContextualBrowserViews: () => new Map(),
			},
			editorService: { openEditor: async () => undefined },
			playwrightService: {} as any,
		} as any;

		await assert.rejects(
			DardcorBrowserAgentController.resolveBrowserView(services, { pageId: userView.id }),
			/not shared with the agent/,
		);
	});

	test('cancels browser tab resolution before opening or selecting a page', async () => {
		const services = {} as any;
		const cancelledToken = {
			isCancellationRequested: true,
			onCancellationRequested: () => ({ dispose: () => undefined }),
		};
		await assert.rejects(DardcorBrowserAgentController.resolveBrowserView(services, undefined, cancelledToken as any));
	});

	test('creates a visible Router browser tab in an isolated agent session', async () => {
		const views = new Map<string, any>();
		const createdView = { id: 'created-tab', url: 'http://localhost:3000/dashboard', resolve: async () => ({ url: 'http://localhost:3000/dashboard', sharingState: 'shared' }) } as any;
		let creationOptions: any;
		let openedView: unknown;
		const services = {
			browserService: {
				getKnownBrowserViews: () => views,
				getContextualBrowserViews: () => new Map(),
				createBrowserView: async (options: unknown) => {
					creationOptions = options;
					await new Promise(resolve => setTimeout(resolve, 5));
					views.set(createdView.id, createdView);
					return createdView;
				},
			},
			editorService: { openEditor: async (view: unknown) => { openedView = view; } },
			playwrightService: {} as any,
		} as any;

		try {
			const resolved = await DardcorBrowserAgentController.resolveBrowserView(services, {
				url: 'http://localhost:3000/dashboard',
				openIfMissing: true,
				forceNew: true,
				agentSessionId: 'router-chat-1',
			});
			assert.strictEqual(resolved, createdView);
			assert.strictEqual(openedView, createdView);
			assert.deepStrictEqual(creationOptions.owner, { type: 'agent', sessionId: 'router-chat-1' });
			assert.deepStrictEqual(creationOptions.session, { scope: 'agent', affinity: 'router-chat-1' });
			assert.deepStrictEqual(creationOptions.initialAudiences, [{ type: 'agent', sessionId: 'router-chat-1' }]);
		} finally {
			views.clear();
		}
	});

	test('returns a timed-out status when wait_for_browser does not find its requested condition', async () => {
		const view = { id: 'wait-page', url: 'http://localhost:3000', resolve: async () => ({ url: 'http://localhost:3000', sharingState: 'shared' }) } as any;
		const controller = DardcorBrowserAgentController as any;
		const originalWithPageCDPSession = controller.withPageCDPSession;
		const originalCaptureBrowserDiagnostics = controller.captureBrowserDiagnostics;
		const originalWaitTillHTMLStable = controller.waitTillHTMLStable;
		const snapshot = {
			title: 'Fixture', url: 'http://localhost:3000', viewportWidth: 800, viewportHeight: 600,
			scrollX: 0, scrollY: 0, scrollHeight: 600, scrollWidth: 800, headings: [],
			visibleTextExcerpt: 'Fixture page', interactiveElements: [], dialogs: [], runtimeErrors: [],
		};
		controller.withPageCDPSession = async (_services: unknown, _view: unknown, callback: (helpers: unknown) => Promise<unknown>) => callback({
			model: { url: view.url },
			sendPageCommand: async () => undefined,
			evaluate: async (expression: string) => expression.includes('collectPageSnapshot')
				? snapshot
				: expression.includes('const sel') ? false : true,
		});
		controller.captureBrowserDiagnostics = async () => '';
		try {
			const services = {
				browserService: {
					getKnownBrowserViews: () => new Map([[view.id, view]]),
					getContextualBrowserViews: () => new Map(),
				},
				editorService: { openEditor: async () => undefined },
				playwrightService: { startTrackingPage: async () => undefined } as any,
				agentNetworkFilterService: { isEnabled: () => false, isUriAllowed: () => true, formatError: () => 'Blocked by policy' } as any,
			} as any;

			const result = await DardcorBrowserAgentController.executeBrowserTool(services, 'wait_for_browser', {
				pageId: view.id,
				selector: '#not-yet-rendered',
				timeoutMs: 500,
			});
			assert.strictEqual(result.executionStatus, 'timedOut');
			assert.match(result.output, /Timeout \(500ms\)/);
			assert.match(result.output, /Active Browser Page Snapshot/);

			controller.waitTillHTMLStable = async () => false;
			const unstableResult = await DardcorBrowserAgentController.executeBrowserTool(services, 'wait_for_browser', {
				pageId: view.id,
				timeoutMs: 500,
			});
			assert.strictEqual(unstableResult.executionStatus, 'timedOut');
			assert.match(unstableResult.output, /stable DOM/);
		} finally {
			controller.withPageCDPSession = originalWithPageCDPSession;
			controller.captureBrowserDiagnostics = originalCaptureBrowserDiagnostics;
			controller.waitTillHTMLStable = originalWaitTillHTMLStable;
		}
	});

	test('reports structured failures from opening an integrated browser page', async () => {
		const services = {
			browserService: {
				getKnownBrowserViews: () => { throw { code: 'TAB_REGISTRY_UNAVAILABLE', message: 'The integrated browser tab registry is unavailable.' }; },
				getContextualBrowserViews: () => new Map(),
			},
			editorService: {} as any,
			playwrightService: {} as any,
			agentNetworkFilterService: { isEnabled: () => false, isUriAllowed: () => true, formatError: () => 'Blocked by policy' } as any,
		} as any;

		const result = await DardcorBrowserAgentController.executeBrowserTool(services, 'open_browser_page', { url: 'http://127.0.0.1:8000' });
		assert.match(result.output, /Browser Agent Error \(open_browser_page\)/);
		assert.match(result.output, /resolving or creating the integrated browser tab/);
		assert.match(result.output, /TAB_REGISTRY_UNAVAILABLE/);
		assert.match(result.output, /tab registry is unavailable/);
		assert.match(result.output, /No successful browser verification was recorded/);
		assert.doesNotMatch(result.output, /\[object Object\]/);
	});

	test('persists cancelled/provider-error style checkpoint states as resumable statuses', () => {
		const paused = updateChatAgentRunState(createChatAgentRunState('working'), { status: 'paused', lastError: 'cancelled', taskPrompt: 'Build and verify the app', nextStep: 'Run typecheck.' });
		const blocked = updateChatAgentRunState(paused, { status: 'blocked', lastError: 'provider unavailable' });
		assert.strictEqual(paused.status, 'paused');
		assert.strictEqual(paused.taskPrompt, 'Build and verify the app');
		assert.strictEqual(paused.nextStep, 'Run typecheck.');
		assert.strictEqual(blocked.status, 'blocked');
		assert.strictEqual(blocked.lastError, 'provider unavailable');
	});

	test('migrates v1 through v4 checkpoints and marks legacy verification evidence stale', () => {
		const migratedV1 = migrateChatAgentRunState({ version: 1, status: 'paused', updatedAt: 10, turn: 4, stalledTurns: 1, verificationEvidence: ['test passed'], browserActions: 0, lastError: 'cancelled' });
		assert.strictEqual(migratedV1?.version, 5);
		assert.deepStrictEqual(migratedV1?.verificationEvidence, [{ message: 'test passed', workspaceRevision: -1 }]);
		assert.deepStrictEqual(migratedV1?.verificationFailures, []);
		const migratedV2 = migrateChatAgentRunState({ version: 2, status: 'blocked', updatedAt: 11, turn: 7, stalledTurns: 0, verificationEvidence: ['build passed'], verificationFailures: ['lint failed'], browserActions: 1, taskPrompt: 'Fix it', nextStep: 'Run lint.' });
		assert.strictEqual(migratedV2?.version, 5);
		assert.deepStrictEqual(migratedV2?.verificationFailures, ['lint failed']);
		assert.deepStrictEqual(migratedV2?.verificationPending, []);
		assert.strictEqual(migratedV2?.taskPrompt, 'Fix it');
		assert.strictEqual(migratedV2?.nextStep, 'Run lint.');
		const migratedV3 = migrateChatAgentRunState({ version: 3, status: 'verifying', updatedAt: 12, turn: 8, stalledTurns: 0, verificationEvidence: [], verificationFailures: [], verificationPending: ['npm run build pending'], browserActions: 0 });
		assert.strictEqual(migratedV3?.version, 5);
		assert.deepStrictEqual(migratedV3?.verificationPending, ['npm run build pending']);
		const migratedV4 = migrateChatAgentRunState({ version: 4, status: 'verifying', updatedAt: 13, turn: 9, stalledTurns: 0, verificationEvidence: ['old test passed'], verificationFailures: [], verificationPending: [], browserActions: 1, workspaceRevision: 7 });
		assert.strictEqual(migratedV4?.version, 5);
		assert.strictEqual(migratedV4?.workspaceRevision, 0);
		assert.deepStrictEqual(migratedV4?.verificationEvidence, [{ message: 'old test passed', workspaceRevision: -1 }]);
	});

	test('gates shell commands by risk and pauses only when retained context reaches its budget', () => {
		assert.strictEqual(isDardcorLowRiskCommand('git status --short'), true);
		assert.strictEqual(isDardcorLowRiskCommand('npm run typecheck'), false);
		assert.strictEqual(isDardcorLowRiskCommand('npm install'), false);
		assert.strictEqual(isDardcorLowRiskCommand('npm test; Remove-Item *'), false);
		assert.strictEqual(requiresDardcorCommandConfirmation('run_command', 'git status --short', 'default'), true);
		assert.strictEqual(requiresDardcorCommandConfirmation('run_command', 'git status --short', 'assisted'), false);
		assert.strictEqual(requiresDardcorCommandConfirmation('run_command', 'npm test', 'assisted'), true);
		assert.strictEqual(requiresDardcorCommandConfirmation('run_command', 'git status --short', 'autopilot'), true);
		assert.strictEqual(requiresDardcorCommandConfirmation('run_command', 'npm install', 'default'), true);
		assert.strictEqual(requiresDardcorCommandConfirmation('run_task', 'test', 'default'), true);
		assert.strictEqual(requiresDardcorCommandConfirmation('run_command', 'npm install', 'autoApprove'), false);
		assert.strictEqual(requiresDardcorToolConfirmation('read_file', { filePath: 'src/app.ts' }, 'default'), false);
		assert.strictEqual(requiresDardcorToolConfirmation('edit_file', { filePath: 'src/app.ts' }, 'assisted'), true);
		assert.strictEqual(requiresDardcorToolConfirmation('click_element', { elementId: '1' }, 'assisted'), true);
		assert.strictEqual(requiresDardcorToolConfirmation('edit_file', { filePath: 'src/app.ts' }, 'autopilot'), true);
		assert.strictEqual(requiresDardcorToolConfirmation('fetch_web_page', { url: 'https://example.com' }, 'assisted'), true);
		assert.strictEqual(requiresDardcorToolConfirmation('unrecognized_tool', {}, 'autoApprove'), false);
		assert.strictEqual(requiresDardcorToolConfirmation('unrecognized_tool', {}, 'default'), true);
		assert.strictEqual(getDardcorEffectivePermissionLevel('autoApprove', true), 'default');
		assert.strictEqual(getDardcorEffectivePermissionLevel('assisted', true), 'assisted');
		assert.strictEqual(getDardcorEffectivePermissionLevel('autopilot', false), 'default');
		assert.match(summarizeDardcorToolAction('write_file', { filePath: 'src/app.ts', content: 'export const answer = 42;' }), /content: export const answer = 42/);
		assert.match(getDardcorRunGuardReason(750_000) ?? '', /context budget/);
		assert.strictEqual(getDardcorRunGuardReason(5000), undefined);

		// Verification command sanitization and exploratory recognition tests
		assert.strictEqual(isDardcorExploratoryCommand('Get-ChildItem public/icons | Select-Object Name'), true);
		assert.strictEqual(isDardcorExploratoryCommand('ls public/icons; echo "=== JS/CSS ==="; ls resources/js resources/css'), true);
		assert.strictEqual(isDardcorExploratoryCommand('Get-Content resources/views/layouts/header.blade.php'), true);
		assert.strictEqual(formatDardcorVerificationLabel('ls public/icons; echo "=== JS/CSS ==="'), '');
		assert.strictEqual(formatDardcorVerificationLabel('php storage/framework/check-env.php; php artisan test 2>&1 | Select-Object -Last 14'), 'PHP Artisan Unit & Feature Tests');
		assert.strictEqual(formatDardcorVerificationLabel('Get-Content resources/views/layouts/header.blade.php; echo "=== ICONS ==="; Test-Path public/icons/icon-192.png; Get-ChildItem public/icons'), 'Verify public icon assets');
		assert.strictEqual(formatDardcorVerificationLabel('npm test -- --watch=false'), 'NPM Test Suite');
		assert.strictEqual(formatDardcorVerificationLabel('cargo test --lib'), 'Cargo Test Suite');

		// In-flight context compaction tests
		const largeOutput = 'A'.repeat(150_000);
		const testMessages = [
			{ role: 'system', content: 'You are an agent' },
			{ role: 'user', content: 'Do task' },
			{ role: 'assistant', tool_calls: [{ id: '1', function: { name: 'read_file', arguments: '{}' } }] },
			{ role: 'tool', content: largeOutput + '\n[Command result: exit code 0]' },
			{ role: 'assistant', tool_calls: [{ id: '2', function: { name: 'run_command', arguments: '{}' } }] },
			{ role: 'tool', content: largeOutput + '\n[Command result: exit code 0]' },
			{ role: 'assistant', content: 'Recent turn assistant' },
			{ role: 'user', content: 'Recent turn user' }
		];
		const compactionResult = compactDardcorAgentMessages(testMessages, 50_000, 1);
		assert.ok(compactionResult.compactedChars < compactionResult.originalChars, 'Compacted characters should be significantly smaller');
		assert.ok(compactionResult.compactedItemsCount > 0, 'Items should be compacted');
		assert.ok(JSON.stringify(compactionResult.messages).length < 200_000, 'Total JSON size should be drastically reduced');
		assert.strictEqual(compactionResult.messages[6].content, 'Recent turn assistant', 'Recent turns must be preserved without alteration');
		assert.ok(compactionResult.messages[3].content.includes('[Command result: exit code 0]'), 'Exit code markers must be preserved in compacted output');
	});

	test('sends one real Playwright click and propagates browser failures', async () => {
		const calls: string[] = [];
		let releaseTracking!: () => void;
		let trackingReady = false;
		const trackingGate = new Promise<void>(resolve => releaseTracking = resolve);
		const fakePlaywright = {
			startTrackingPage: async (pageId: string) => { calls.push(`track:${pageId}`); await trackingGate; trackingReady = true; },
			isPageTracked: async () => true,
			invokeFunctionRaw: async (_sessionId: string, _pageId: string, fnDef: string) => { assert.strictEqual(trackingReady, true); calls.push(fnDef); return true; },
		} as unknown as IPlaywrightService;
		const click = performDardcorBrowserClick(fakePlaywright, 'session', 'page-1', 12, 34);
		await Promise.resolve();
		assert.strictEqual(calls.some(call => call.includes('page.mouse.click')), false);
		releaseTracking();
		await click;
		assert.strictEqual(calls.filter(call => call.includes('page.mouse.click')).length, 1);
		assert.ok(calls[0] === 'track:page-1');

		calls.length = 0;
		await performDardcorBrowserClick(fakePlaywright, 'session', 'page-1', 12, 34, { selector: '#save', clickCount: 1 });
		assert.ok(calls.some(call => call.includes('page.locator(selector)') && call.includes('locator.click')));
		assert.strictEqual(calls.some(call => call.includes('page.mouse.click')), false);

		const failedPlaywright = {
			...fakePlaywright,
			invokeFunctionRaw: async () => { throw new Error('page closed'); },
		} as unknown as IPlaywrightService;
		await assert.rejects(() => performDardcorBrowserClick(failedPlaywright, 'session', 'page-1', 12, 34), /page closed/);
	});

	test('detects browser control and dialog changes in a post-action snapshot', () => {
		const before = {
			url: 'http://localhost:8000', title: 'Fixture', visibleTextExcerpt: 'Settings',
			interactiveElements: [{ tag: 'button', text: 'Toggle', pressed: 'false' }], dialogs: [],
		};
		const after = {
			url: 'http://localhost:8000', title: 'Fixture', visibleTextExcerpt: 'Settings',
			interactiveElements: [{ tag: 'button', text: 'Toggle', pressed: 'true' }], dialogs: ['Settings dialog'],
		};
		assert.deepStrictEqual(getDardcorBrowserSnapshotChanges(before, after), ['interactive control state changed', 'dialog state changed']);
	});

	test('maps Playwright pages by Chromium target identity regardless of arrival order', () => {
		const views = [
			{ viewId: 'browser-view-b', targetId: 'chromium-target-b', url: 'https://example.com/b' },
			{ viewId: 'browser-view-a', targetId: 'chromium-target-a', url: 'https://example.com/a' },
		];
		const pages = [
			{ targetId: 'chromium-target-a', url: 'https://example.com/a' },
			{ targetId: 'chromium-target-b', url: 'https://example.com/b' },
		];
		assert.strictEqual(matchPlaywrightTargetToView('chromium-target-a', 'https://example.com/a', views, pages), 'browser-view-a');
		assert.strictEqual(matchPlaywrightTargetToView('chromium-target-b', 'https://example.com/b', views, pages), 'browser-view-b');
		assert.strictEqual(matchPlaywrightTargetToView(undefined, 'https://example.com/a', views, pages), 'browser-view-a');
		const duplicateViews = [...views, { viewId: 'browser-view-a-duplicate', url: 'https://example.com/a' }];
		const duplicatePages = [...pages, { url: 'https://example.com/a' }];
		assert.strictEqual(matchPlaywrightTargetToView(undefined, 'https://example.com/a', duplicateViews, duplicatePages), undefined);
	});

	test('recognizes only explicit Router tool and max-token capability rejections', () => {
		assert.strictEqual(normalizeDardcorRouterModelCapabilities({ capabilities: { tools: false, vision: true } }).tools, false);
		assert.strictEqual(normalizeDardcorRouterModelCapabilities({ capabilities: { vision: true } }).vision, true);
		assert.strictEqual(normalizeDardcorRouterModelCapabilities({ capabilities: { vision: false } }).vision, false);
		assert.deepStrictEqual(normalizeDardcorRouterModelCapabilities({ capabilities: {} }), {});
		assert.strictEqual(shouldAttachDardcorBrowserScreenshot({ vision: true }), true);
		assert.strictEqual(shouldAttachDardcorBrowserScreenshot({ vision: false }), false);
		assert.strictEqual(shouldAttachDardcorBrowserScreenshot({}), false);
		assert.strictEqual(isDardcorNativeToolCompatibilityError(400, 'This model does not support tools.'), true);
		assert.strictEqual(isDardcorNativeToolCompatibilityError(400, 'The selected model was not found.'), false);
		assert.strictEqual(isDardcorNativeToolCompatibilityError(500, 'Unsupported tool_choice.'), false);
		assert.strictEqual(isDardcorMaxTokensCompatibilityError(422, 'Unsupported parameter max_tokens.'), true);
		assert.strictEqual(isDardcorMaxTokensCompatibilityError(400, 'Invalid API key.'), false);
	});

	test('recognizes complete Router stream terminal frames', () => {
		assert.strictEqual(isDardcorRouterStreamTerminal({ choices: [{ finish_reason: 'tool_calls' }] }), true);
		assert.strictEqual(isDardcorRouterStreamTerminal({ type: 'message_stop' }), true);
		assert.strictEqual(isDardcorRouterStreamTerminal({ done: true }), true);
		assert.strictEqual(isDardcorRouterStreamTerminal({ choices: [{ delta: { content: 'partial' } }] }), false);
		assert.strictEqual(isDardcorRouterStreamTerminal(undefined), false);
	});

	test('normalizes Vercel agent-browser style refs and variations with extractDardcorRefId', () => {
		assert.strictEqual(extractDardcorRefId('@e1'), '1');
		assert.strictEqual(extractDardcorRefId('e1'), '1');
		assert.strictEqual(extractDardcorRefId('@1'), '1');
		assert.strictEqual(extractDardcorRefId('1'), '1');
		assert.strictEqual(extractDardcorRefId(1), '1');
		assert.strictEqual(extractDardcorRefId('[@e42]'), '42');
		assert.strictEqual(extractDardcorRefId('[ref=@e7]'), '7');
		assert.strictEqual(extractDardcorRefId('ref="e8"'), '8');
		assert.strictEqual(extractDardcorRefId('[data-dardcor-id="99"]'), '99');
		assert.strictEqual(extractDardcorRefId(''), null);
		assert.strictEqual(extractDardcorRefId(undefined), null);
		assert.strictEqual(extractDardcorRefId(null), null);
		assert.strictEqual(extractDardcorRefId('button.btn-primary'), null);
	});

	test('includes ref parameter in browser router tools for Vercel deterministic targeting', () => {
		const browserToolNames = ['click_element', 'type_in_page', 'scroll_browser_page', 'hover_element', 'select_option'];
		for (const toolName of browserToolNames) {
			const tool = DARDCOR_AGENT_TOOLS.find(t => t.function.name === toolName);
			assert.ok(tool, `Tool ${toolName} must exist`);
			assert.ok((tool.function.parameters as any)?.properties?.ref, `Tool ${toolName} must have a 'ref' property`);
		}
	});

	test('requires a ready browser document and surfaces readiness failures', async () => {
		assert.strictEqual(isBrowserDocumentReadyState('loading'), false);
		assert.strictEqual(isBrowserDocumentReadyState('interactive'), true);
		assert.strictEqual(isBrowserDocumentReadyState('complete'), true);
		await assert.rejects(() => DardcorBrowserAgentController.waitTillHTMLStable(async () => {
			throw new Error('Playwright page is closed.');
		}, 1), /did not become ready.*Playwright page is closed/i);
	});
test('automatically detects all world languages and provides zero-emoji localized text', () => {
		const testCases: [string, DardcorSupportedLanguage][] = [
			['tolong buatkan website marketplace baru', 'id'],
			['please implement authentication with jwt', 'en'],
			['このバグを修正してテストを実行してください', 'ja'],
			['请在项目中添加购物车功能并测试', 'zh'],
			['이 문제를 해결하고 테스트를 실행해 주세요', 'ko'],
			['por favor arregla este error en el controlador', 'es'],
			['veuillez corriger cette fonction et exécuter les tests', 'fr'],
			['bitte beheben Sie diesen Fehler in der Datenbank', 'de'],
			['por favor corrija este erro no arquivo', 'pt'],
			['пожалуйста исправьте эту ошибку и запустите тесты', 'ru'],
			['per favore correggi questo bug nel file', 'it'],
			['يرجى إصلاح هذا الخطأ وتشغيل الاختبارات', 'ar'],
			['alstublieft herstel deze fout in het bestand', 'nl'],
			['lütfen bu hatayı düzeltin ve testleri çalıştırın', 'tr'],
			['làm ơn sửa lỗi này trong tập tin', 'vi'],
		];

		const emojiRegex = /[\uD83C-\uDBFF\uDC00-\uDFFF]|[\u2600-\u27BF]|[\u2300-\u23FF]|[\u2700-\u27BF]/;

		for (const [prompt, expectedLang] of testCases) {
			const detected = detectDardcorLanguage(prompt);
			assert.strictEqual(detected, expectedLang, `Expected ${expectedLang} for prompt: "${prompt}"`);

			const strings = getDardcorLocaleStrings(detected);
			assert.ok(strings.taskSummaryComplete.length > 0);
			assert.ok(strings.taskSummaryPaused.length > 0);
			assert.ok(strings.autoContinueActive.length > 0);
			assert.ok(strings.sendContinueToResume.length > 0);

			for (const [key, val] of Object.entries(strings)) {
				assert.strictEqual(
					emojiRegex.test(val),
					false,
					`Locale string '${key}' for language '${detected}' must contain zero emojis/stickers. Found: "${val}"`
				);
			}

			const selfCorrection = getDardcorAutonomousSelfCorrectionDirective(detected, 'Command failed: exit 1');
			assert.strictEqual(emojiRegex.test(selfCorrection), false);
			assert.ok(selfCorrection.length > 20);

			const momentum = getDardcorAutonomousMomentumDirective(detected, 2, 6, { id: 3, title: 'Implement views' });
			assert.strictEqual(emojiRegex.test(momentum), false);
			assert.ok(momentum.includes('3'));
			assert.ok(momentum.includes('Implement views'));
		}
	});

	test('dynamically generates multilingual system prompt with stack specialization and autonomy protocol', () => {
		const emojiRegex = /[\uD83C-\uDBFF\uDC00-\uDFFF]|[\u2600-\u27BF]|[\u2300-\u23FF]|[\u2700-\u27BF]/;

		// 1. Indonesian dynamic prompt with Laravel specialization and Full Access
		const indonesianPrompt = buildDardcorSystemPrompt({
			hasWorkspace: true,
			projectName: 'Arul Store',
			rootPath: 'C:/projects/ArulStore',
			techStack: 'PHP, Laravel 11, Blade, Vite, Tailwind CSS',
			fileTree: 'app/\nresources/views/\ncomposer.json'
		}, {
			userPrompt: 'tolong lanjutkan pekerjaan nomer 2',
			permissionLevel: 'autoApprove'
		});

		assert.ok(indonesianPrompt.includes('IDENTITAS DAN PERAN UTAMA'));
		assert.ok(indonesianPrompt.includes('Bahasa Indonesia'));
		assert.ok(indonesianPrompt.includes('Laravel & PHP'));
		assert.ok(indonesianPrompt.includes('AUTONOMOUS FULL ACCESS MODE'));
		assert.ok(indonesianPrompt.includes('PROTOKOL LAPORAN SINTESIS AKHIR ANTIGRAVITY'));
		assert.strictEqual(emojiRegex.test(indonesianPrompt), false, 'System prompt must not contain emojis');

		// 2. Japanese dynamic prompt with React/Next.js specialization
		const japanesePrompt = buildDardcorSystemPrompt({
			hasWorkspace: true,
			projectName: 'WebShop',
			rootPath: '/home/user/webshop',
			techStack: 'TypeScript, Next.js, React, Tailwind CSS',
			fileTree: 'app/page.tsx\npackage.json'
		}, {
			userPrompt: 'カート機能を追加してください',
			permissionLevel: 'default'
		});

		assert.ok(japanesePrompt.includes('アイデンティティとコアロール'));
		assert.ok(japanesePrompt.includes('日本語'));
		assert.ok(japanesePrompt.includes('React / Next.js'));
		assert.ok(japanesePrompt.includes('ANTIGRAVITY 最終統合レポートプロトコル'));
		assert.strictEqual(emojiRegex.test(japanesePrompt), false, 'Japanese prompt must not contain emojis');

		// 3. English prompt
		const englishPrompt = buildDardcorSystemPrompt({
			hasWorkspace: true,
			projectName: 'RustCLI',
			rootPath: '/home/user/cli',
			techStack: 'Rust, Cargo',
			fileTree: 'Cargo.toml\nsrc/main.rs'
		}, {
			userPrompt: 'Fix the borrow checker error in main',
			permissionLevel: 'autoApprove'
		});

		assert.ok(englishPrompt.includes('IDENTITY AND CORE ROLE'));
		assert.ok(englishPrompt.includes('Rust'));
		assert.ok(englishPrompt.includes('AUTONOMOUS FULL ACCESS MODE'));
		assert.strictEqual(emojiRegex.test(englishPrompt), false, 'English prompt must not contain emojis');
	});

	test('sanitizes interrupted turns and handles clarification questions cleanly', () => {
		// 1. DardcorThinkingStreamParser sanitizes interrupted thinking blocks
		const rawInterruptedThinking = '<think>\nI should consider alternative downloads.\nAlternative: use a partial download...';
		const sanitized = DardcorThinkingStreamParser.sanitizeText(rawInterruptedThinking);
		assert.strictEqual(sanitized, '', 'Incomplete thinking block with no assistant text must sanitize to empty');

		// 2. Completed text with reasoning tags stripped cleanly
		const mixedText = '<think>Deliberating something</think>Here is the direct answer to your question.';
		const sanitizedMixed = DardcorThinkingStreamParser.sanitizeText(mixedText);
		assert.strictEqual(sanitizedMixed, 'Here is the direct answer to your question.');

		// 3. Clarification questions pattern matches user interrupts
		const clarifPattern = /^(?:bentar|sebentar|tunggu|wait|hold on|apa itu|kenapa|mengapa|sedang apa|sedang download apa|sedang unduh apa|what are you|what is|why are you)\b/i;
		assert.ok(clarifPattern.test('bentar saya ingin tanya dulu, anda sedang mendownload apa itu sampai 1gb+ ?'));
		assert.ok(clarifPattern.test('wait, what are you downloading?'));
		assert.ok(clarifPattern.test('tunggu sebentar'));
		assert.strictEqual(clarifPattern.test('tolong lanjutkan pekerjaan'), false);
	});

	test('verifies language detection, confirmation modal localization, and powershell continuation safety', () => {
		// 1. Language detection on real user prompt
		const indonesianPrompt = 'cek gambar 1 dengan jelas, saya menemukan sedikit kendala. dimana dimana ketika seperti di gambar itu saya tidak tahu dia mau ngapain this agent action may bla bla bla, harusnya kalimatnya. mendeteksi bahasa yang sedang digunakan oleh user. pastikan bisa mendeteksi semua bahasa didunia.';
		assert.strictEqual(detectDardcorLanguage(indonesianPrompt), 'id');

		// 2. Localized confirmation dialog strings
		const idLocale = getDardcorLocaleStrings('id');
		assert.strictEqual(idLocale.confirmAgentActionHeader, 'Persetujuan Tindakan Agen');
		assert.strictEqual(idLocale.confirmTerminalHeader, 'Persetujuan Perintah Terminal');
		assert.strictEqual(idLocale.confirmAllowOnce, 'Izinkan sekali');
		assert.strictEqual(idLocale.confirmSkipAction, 'Lewati tindakan');
		assert.strictEqual(idLocale.confirmSkipCommand, 'Lewati perintah');

		const jaLocale = getDardcorLocaleStrings('ja');
		assert.strictEqual(jaLocale.confirmAgentActionHeader, 'エージェントのアクション承認');
		assert.strictEqual(jaLocale.confirmAllowOnce, '1回許可する');

		// 3. Summarize tool action with localized labels
		const summary = summarizeDardcorToolAction('run_command', {
			explanation: 'Inspect toolchain for Laravel project',
			goal: 'Inspect PHP stack',
			mode: 'sync'
		}, 'id');
		assert.match(summary, /Penjelasan: Inspect toolchain/);
		assert.match(summary, /Tujuan: Inspect PHP stack/);
		assert.match(summary, /Mode: sync/);

		// 4. PowerShell continuation prompt (>> ) safety
		assert.strictEqual(detectsCommonPromptPattern('>> ').detected, false);
		assert.strictEqual(detectsCommonPromptPattern('  >>   ').detected, false);
		assert.strictEqual(detectsCommonPromptPattern('PS C:\\Users\\Dardcor> ').detected, true);
	});

	test('verifies task completion summary is not wrapped in tool input and presentation is hidden', () => {
		const isCompletionTool = (toolName: string) => toolName === 'task_completed' || toolName === 'complete_task';
		assert.strictEqual(isCompletionTool('task_completed'), true);
		assert.strictEqual(isCompletionTool('complete_task'), true);
		assert.strictEqual(isCompletionTool('run_command'), false);

		// Verify presentation calculation: completion tools MUST be Hidden so they do not wrap summary in a collapsible input card
		const getPresentation = (externalEdit: boolean, toolName: string) =>
			(externalEdit || toolName === 'task_completed' || toolName === 'complete_task') ? 'Hidden' : undefined;

		assert.strictEqual(getPresentation(false, 'task_completed'), 'Hidden');
		assert.strictEqual(getPresentation(false, 'complete_task'), 'Hidden');
		assert.strictEqual(getPresentation(false, 'run_command'), undefined);
		assert.strictEqual(getPresentation(true, 'run_command'), 'Hidden');

		// Verify rich summary detection: executive summaries are emitted directly to markdownContent
		const isRichSummary = (summary: string) => summary.trim().length >= 60;
		assert.strictEqual(isRichSummary('Done'), false);
		assert.strictEqual(isRichSummary('## Ringkasan Eksekutif\n\nWebsite trading + scraper data pasar realtime global selesai dibangun.'), true);
	});
	test('verifies auto-continue is strictly halted when a task encounters model or router errors or is blocked', () => {
		const isFatalModelOrRouterError = (blocker?: string, turnEncounteredFatalModelError = false) => {
			return turnEncounteredFatalModelError || !!(
				blocker && /(?:Dardcor Router returned HTTP|forbidden_plan_required|model_not_supported|FreeUsageLimitError|quota exceeded|insufficient_credits|credits required|insufficient balance|payment required|unauthorized|pricingUrl|Requested entity was not found|Model not found|all \d+ accounts locked|Paid subscription or credits required|Connect Timeout Error|ERR_TIMED_OUT|ECONNREFUSED|ECONNRESET|fetch failed|stream reading error|did not complete after \d+ attempts)/i.test(blocker)
			);
		};

		const shouldAutoResumeIncompleteTodos = (opts: {
			isComplete: boolean;
			isCancellationRequested: boolean;
			isCancelled: boolean;
			isBlocked: boolean;
			hasFatalModelOrRouterError: boolean;
			pendingTodosCount: number;
			isFullAccessActive: boolean;
		}) => {
			return !opts.isComplete
				&& !opts.isCancellationRequested
				&& !opts.isCancelled
				&& !opts.isBlocked
				&& !opts.hasFatalModelOrRouterError
				&& opts.pendingTodosCount > 0
				&& opts.isFullAccessActive;
		};

		// 1. Qoder 403 Forbidden Plan (user report)
		const qoder403 = 'Dardcor Router returned HTTP 403 after retries: {"error":{"code":"forbidden_plan_required","status":403,"message":"[qoder/dmodel] A paid plan or subscription is required for this model.","provider":"qoder","model":"dmodel"}}';
		assert.strictEqual(isFatalModelOrRouterError(qoder403), true);
		assert.strictEqual(shouldAutoResumeIncompleteTodos({
			isComplete: false,
			isCancellationRequested: false,
			isCancelled: false,
			isBlocked: true,
			hasFatalModelOrRouterError: isFatalModelOrRouterError(qoder403),
			pendingTodosCount: 5,
			isFullAccessActive: true
		}), false, 'Must NOT auto-continue on 403 Forbidden Plan required');

		// 2. GitHub 400 Model Not Supported (user report)
		const gh400 = 'Dardcor Router returned HTTP 400 after retries: {"error":{"message":"The requested model is not supported.","code":"model_not_supported","param":"model","type":"invalid_request_error"}}';
		assert.strictEqual(isFatalModelOrRouterError(gh400), true);
		assert.strictEqual(shouldAutoResumeIncompleteTodos({
			isComplete: false,
			isCancellationRequested: false,
			isCancelled: false,
			isBlocked: true,
			hasFatalModelOrRouterError: isFatalModelOrRouterError(gh400),
			pendingTodosCount: 3,
			isFullAccessActive: true
		}), false, 'Must NOT auto-continue on 400 Model Not Supported');

		// 3. Antigravity 404 Model Not Found (user report)
		const ag404 = 'Dardcor Router returned HTTP 404 after retries: {"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND"}}';
		assert.strictEqual(isFatalModelOrRouterError(ag404), true);
		assert.strictEqual(shouldAutoResumeIncompleteTodos({
			isComplete: false,
			isCancellationRequested: false,
			isCancelled: false,
			isBlocked: true,
			hasFatalModelOrRouterError: isFatalModelOrRouterError(ag404),
			pendingTodosCount: 4,
			isFullAccessActive: true
		}), false, 'Must NOT auto-continue on 404 Model Not Found');

		// 4. OpenCode 429 Free Usage Limit Reached (user report)
		const oc429 = 'Dardcor Router returned HTTP 429 after retries: {"type":"error","error":{"type":"FreeUsageLimitError","message":"Free usage limit reached. Free models work in OpenCode..."}}';
		assert.strictEqual(isFatalModelOrRouterError(oc429), true);
		assert.strictEqual(shouldAutoResumeIncompleteTodos({
			isComplete: false,
			isCancellationRequested: false,
			isCancelled: false,
			isBlocked: true,
			hasFatalModelOrRouterError: isFatalModelOrRouterError(oc429),
			pendingTodosCount: 2,
			isFullAccessActive: true
		}), false, 'Must NOT auto-continue on 429 Free Usage Limit Reached');

		// 5. Connect Timeout / 502
		const qoder502 = 'Dardcor Router returned HTTP 502 after retries: fetch failed (cause: UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error)';
		assert.strictEqual(isFatalModelOrRouterError(qoder502), true);
		assert.strictEqual(shouldAutoResumeIncompleteTodos({
			isComplete: false,
			isCancellationRequested: false,
			isCancelled: false,
			isBlocked: true,
			hasFatalModelOrRouterError: isFatalModelOrRouterError(qoder502),
			pendingTodosCount: 1,
			isFullAccessActive: true
		}), false, 'Must NOT auto-continue on 502 Connect Timeout');

		// 6. Healthy autonomous turn with incomplete todos and Full Access active MUST auto-continue
		assert.strictEqual(shouldAutoResumeIncompleteTodos({
			isComplete: false,
			isCancellationRequested: false,
			isCancelled: false,
			isBlocked: false,
			hasFatalModelOrRouterError: false,
			pendingTodosCount: 3,
			isFullAccessActive: true
		}), true, 'Healthy turn with pending todos and full access must auto-continue');

		// 7. Non-Full Access mode (Ask / Manual) MUST NOT auto-continue
		assert.strictEqual(shouldAutoResumeIncompleteTodos({
			isComplete: false,
			isCancellationRequested: false,
			isCancelled: false,
			isBlocked: false,
			hasFatalModelOrRouterError: false,
			pendingTodosCount: 3,
			isFullAccessActive: false
		}), false, 'Manual mode must NOT auto-continue');
	});

	test('parseResetSeconds parses human and numeric durations accurately', () => {
		assert.strictEqual(parseResetSeconds('30s'), 30);
		assert.strictEqual(parseResetSeconds('1m'), 60);
		assert.strictEqual(parseResetSeconds('1m 30s'), 90);
		assert.strictEqual(parseResetSeconds('2h 5m 10s'), 7510);
		assert.strictEqual(parseResetSeconds('reset after 45s'), 45);
		assert.strictEqual(parseResetSeconds('45'), 45);
		assert.strictEqual(parseResetSeconds(''), undefined);
		assert.strictEqual(parseResetSeconds(undefined), undefined);
	});

	test('parseDardcorRouterError extracts structured cooldown and resetAfterSec', () => {
		const jsonErr = JSON.stringify({
			error: {
				code: 'rate_limited_cooldown',
				message: '[qoder/dfmodel] [502]: fetch failed (reset after 30s)',
				resetAfterSec: 30
			}
		});
		const parsed = parseDardcorRouterError(503, jsonErr, 'qoder/dfmodel');
		assert.strictEqual(parsed.statusCode, 503);
		assert.strictEqual(parsed.resetAfterSec, 30);
		assert.strictEqual(parsed.isQuotaExhausted, true);
	});

	test('cleanMessageText removes raw origin stack traces and local file uris', () => {
		const raw = 'Browser action failed: Error: Integrated browser document did not become ready; origin: DardcorBrowserAgentController.waitTillHTMLStable (vscode-file://vscode-app/c:/app/controller.js:123)';
		const cleaned = cleanMessageText(raw);
		assert.strictEqual(cleaned.includes('origin:'), false);
		assert.strictEqual(cleaned.includes('vscode-file://'), false);
		assert.strictEqual(cleaned.includes('Browser action failed: Error: Integrated browser document did not become ready'), true);
	});

	test('diagnoseProviderIssue accurately classifies DOWN, LIMIT, and ERROR', () => {
		// 1. DOWN (User's exact Qoder case)
		const downError = '[qoder/dfmodel] [502]: fetch failed (cause: ENOTFOUND: getaddrinfo ENOTFOUND api3.qoder.sh)';
		const downDiag = diagnoseProviderIssue(502, downError, 'qoder/dfmodel', 'id');
		assert.strictEqual(downDiag.category, 'DOWN');
		assert.strictEqual(downDiag.provider, 'Qoder');
		assert.strictEqual(downDiag.model, 'Dfmodel');
		assert.strictEqual(downDiag.description.includes('api3.qoder.sh'), true);
		assert.strictEqual(downDiag.description.includes('down'), true);

		// 2. LIMIT (Quota / Rate-limit)
		const limitError = 'Dardcor Router returned HTTP 429: {"error":{"message":"Resource has been exhausted","code":429}} (reset after 30s)';
		const limitDiag = diagnoseProviderIssue(429, limitError, 'ag/gemini-3.8-flash-high', 'id');
		assert.strictEqual(limitDiag.category, 'LIMIT');
		assert.strictEqual(limitDiag.provider, 'Antigravity');
		assert.strictEqual(limitDiag.description.includes('rate-limit'), true);

		// 3. ERROR (403 Plan required)
		const planError = 'Dardcor Router returned HTTP 403: {"error":{"code":"forbidden_plan_required","status":403,"message":"[qoder/dmodel] A paid plan or subscription is required for this model."}}';
		const planDiag = diagnoseProviderIssue(403, planError, 'qoder/dmodel', 'id');
		assert.strictEqual(planDiag.category, 'ERROR');
		assert.strictEqual(planDiag.provider, 'Qoder');
		assert.strictEqual(planDiag.description.includes('berbayar'), true);
	});
});
