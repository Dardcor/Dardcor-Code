/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Barrier } from '../../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../../../../base/common/errors.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IAccessibilityService } from '../../../../../../platform/accessibility/common/accessibility.js';
import { TestAccessibilityService } from '../../../../../../platform/accessibility/test/common/testAccessibilityService.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationChangeEvent, IConfigurationOverrides, IConfigurationValue } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../../platform/contextkey/browser/contextKeyService.js';
import { ContextKeyEqualsExpr, ContextKeyExpr, IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IConfirmation, IConfirmationResult, IDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import { TestDialogService } from '../../../../../../platform/dialogs/test/common/testDialogService.js';
import { ExtensionIdentifier } from '../../../../../../platform/extensions/common/extensions.js';
import { ConfirmationOptionKind } from '../../../../../../platform/agentHost/common/state/protocol/state.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';
import { workbenchInstantiationService } from '../../../../../test/browser/workbenchTestServices.js';
import { LanguageModelToolsService } from '../../../browser/tools/languageModelToolsService.js';
import { IChatToolRiskAssessmentService, IToolRiskAssessment, ToolRiskLevel, ToolRiskPromptKind } from '../../../browser/tools/chatToolRiskAssessmentService.js';
import { ChatModel, IChatModel } from '../../../common/model/chatModel.js';
import { IChatService, IChatProgress, IChatInfoMessage, IChatToolInputInvocationData, IChatToolInvocation, ToolConfirmKind } from '../../../common/chatService/chatService.js';
import { ChatConfiguration, ChatPermissionLevel } from '../../../common/constants.js';
import { SpecedToolAliases, isToolResultInputOutputDetails, IToolData, IToolImpl, IToolInvocation, ToolDataSource, IToolResultTextPart, ToolAndToolSetEnablementMap } from '../../../common/tools/languageModelToolsService.js';
import { MockChatService } from '../../common/chatService/mockChatService.js';
import { ChatToolInvocation } from '../../../common/model/chatProgressTypes/chatToolInvocation.js';
import { LocalChatSessionUri } from '../../../common/model/chatUri.js';
import { ILanguageModelToolsConfirmationService } from '../../../common/tools/languageModelToolsConfirmationService.js';
import { MockLanguageModelToolsConfirmationService } from '../../common/tools/mockLanguageModelToolsConfirmationService.js';
import { IToolResultCompressor } from '../../../common/tools/toolResultCompressor.js';
import { runWithFakedTimers } from '../../../../../../base/test/common/timeTravelScheduler.js';
import { ILanguageModelChatMetadata } from '../../../common/languageModels.js';


const noopToolResultCompressor: IToolResultCompressor = {
	_serviceBrand: undefined,
	registerFilter: () => { },
	registerCache: () => { },
	maybeCompress: () => undefined,
};

class TestAccessibilitySignalService implements Partial<IAccessibilitySignalService> {
	public signalPlayedCalls: { signal: AccessibilitySignal; options?: any }[] = [];

	async playSignal(signal: AccessibilitySignal, options?: any): Promise<void> {
		this.signalPlayedCalls.push({ signal, options });
	}

	reset() {
		this.signalPlayedCalls = [];
	}
}

class TestTelemetryService implements Partial<ITelemetryService> {
	public events: Array<{ eventName: string; data: any }> = [];

	publicLog2<E extends Record<string, any>, T extends Record<string, any>>(eventName: string, data?: E): void {
		this.events.push({ eventName, data });
	}

	reset() {
		this.events = [];
	}
}

class CountingDialogService extends TestDialogService {
	confirmCalls = 0;

	override confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.confirmCalls++;
		return super.confirm(confirmation);
	}
}

class TestChatToolRiskAssessmentService implements IChatToolRiskAssessmentService {
	declare readonly _serviceBrand: undefined;

	public enabled = false;
	public assessment: IToolRiskAssessment | undefined = undefined;
	public assessError: Error | undefined = undefined;
	public onAssess: (() => void) | undefined = undefined;
	public readonly assessCalls: { toolId: string; parameters: unknown; kind?: ToolRiskPromptKind }[] = [];

	isEnabled(): boolean {
		return this.enabled;
	}

	getCached(): IToolRiskAssessment | undefined {
		return undefined;
	}

	async assess(tool: IToolData, parameters: unknown, _token: CancellationToken, kind?: ToolRiskPromptKind, options?: { ignoreEnablement?: boolean }): Promise<IToolRiskAssessment | undefined> {
		this.assessCalls.push({ toolId: tool.id, parameters, kind });
		this.onAssess?.();
		if (!options?.ignoreEnablement && !this.enabled) {
			return undefined;
		}
		if (this.assessError) {
			throw this.assessError;
		}
		return this.assessment;
	}
}

function registerToolForTest(service: LanguageModelToolsService, store: any, id: string, impl: IToolImpl, data?: Partial<IToolData>) {
	const toolData: IToolData = {
		id,
		modelDescription: data?.modelDescription ?? 'Test Tool',
		displayName: data?.displayName ?? 'Test Tool',
		source: ToolDataSource.Internal,
		...data,
	};
	store.add(service.registerTool(toolData, impl));
	return {
		id,
		makeDto: (parameters: any, context?: { sessionId: string }, callId: string = '1'): IToolInvocation => ({
			callId,
			toolId: id,
			tokenBudget: 100,
			parameters,
			context: context ? {
				sessionResource: LocalChatSessionUri.forSession(context.sessionId),
			} : undefined,
		}),
	};
}

function stubGetSession(chatService: MockChatService, sessionId: string, options?: { requestId?: string; capture?: { invocation?: any }; modeInfo?: { permissionLevel?: ChatPermissionLevel } }): IChatModel {
	const requestId = options?.requestId ?? 'requestId';
	const capture = options?.capture;
	const fakeModel = {
		sessionId,
		sessionResource: LocalChatSessionUri.forSession(sessionId),
		getRequests: () => [{ id: requestId, modelId: 'test-model', modeInfo: options?.modeInfo }],
	} as ChatModel;
	chatService.addSession(fakeModel);
	chatService.appendProgress = (request, progress) => {
		if (capture) { capture.invocation = progress; }
	};

	return fakeModel;
}

async function waitForPublishedInvocation(capture: { invocation?: any }, tries = 10): Promise<ChatToolInvocation> {
	for (let i = 0; i < tries && !capture.invocation; i++) {
		await Promise.resolve();
	}
	return capture.invocation;
}

class AutoApprovePolicyTestConfigurationService extends TestConfigurationService {
	override inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationValue<T> {
		const result = super.inspect<T>(key, overrides);
		return key === ChatConfiguration.GlobalAutoApprove
			? { ...result, policyValue: false as T }
			: result;
	}
}

interface TestToolsServiceSetup {
	configurationService: TestConfigurationService;
	chatService: MockChatService;
	service: LanguageModelToolsService;
	contextKeyService: IContextKeyService;
	riskAssessmentService: TestChatToolRiskAssessmentService;
}

interface TestToolsServiceOptions {
	accessibilityService?: IAccessibilityService;
	accessibilitySignalService?: Partial<IAccessibilitySignalService>;
	telemetryService?: Partial<ITelemetryService>;
	commandService?: Partial<ICommandService>;
	dialogService?: IDialogService;
	configurationService?: TestConfigurationService;
	configureServices?: (config: TestConfigurationService) => void;
}

function createTestToolsService(store: ReturnType<typeof ensureNoDisposablesAreLeakedInTestSuite>, options?: TestToolsServiceOptions): TestToolsServiceSetup {
	const configurationService = options?.configurationService ?? new TestConfigurationService();
	configurationService.setUserConfiguration(ChatConfiguration.ExtensionToolsEnabled, true);

	options?.configureServices?.(configurationService);

	const instaService = workbenchInstantiationService({
		contextKeyService: () => store.add(new ContextKeyService(configurationService)),
		configurationService: () => configurationService
	}, store);
	const contextKeyService = instaService.get(IContextKeyService);
	const chatService = new MockChatService();
	instaService.stub(IChatService, chatService);
	instaService.stub(ILanguageModelToolsConfirmationService, new MockLanguageModelToolsConfirmationService());
	instaService.stub(IToolResultCompressor, noopToolResultCompressor);
	const riskAssessmentService = new TestChatToolRiskAssessmentService();
	instaService.stub(IChatToolRiskAssessmentService, riskAssessmentService);

	if (options?.accessibilityService) {
		instaService.stub(IAccessibilityService, options.accessibilityService);
	}
	if (options?.accessibilitySignalService) {
		instaService.stub(IAccessibilitySignalService, options.accessibilitySignalService as unknown as IAccessibilitySignalService);
	}
	if (options?.telemetryService) {
		instaService.stub(ITelemetryService, options.telemetryService);
	}
	if (options?.commandService) {
		instaService.stub(ICommandService, options.commandService as ICommandService);
	}
	if (options?.dialogService) {
		instaService.stub(IDialogService, options.dialogService);
	}

	const service = store.add(instaService.createInstance(LanguageModelToolsService));
	return { configurationService, chatService, service, contextKeyService, riskAssessmentService };
}

function setupRiskGateTool(
	setup: TestToolsServiceSetup,
	store: any,
	opts?: { withConfirmation?: boolean; permissionLevel?: ChatPermissionLevel; advancedEnabled?: boolean; toolId?: string },
): { invoke: (token?: CancellationToken) => Promise<{ content: { value: string }[] }>; wasInvoked: () => boolean } {
	const withConfirmation = opts?.withConfirmation ?? true;
	const permissionLevel = opts?.permissionLevel ?? ChatPermissionLevel.Autopilot;
	const advancedEnabled = opts?.advancedEnabled ?? true;
	const toolId = opts?.toolId ?? 'riskGateTool';

	setup.configurationService.setUserConfiguration(ChatConfiguration.AutopilotAdvancedEnabled, advancedEnabled);
	setup.configurationService.setUserConfiguration('chat.tools.global.autoApprove', false);

	let invoked = false;
	const tool = registerToolForTest(setup.service, store, toolId, {
		prepareToolInvocation: async () => (withConfirmation ? { confirmationMessages: { title: 'Confirm?', message: 'Proceed?' } } : {}),
		invoke: async () => { invoked = true; return { content: [{ kind: 'text', value: 'ran' }] }; },
	});

	const sessionId = 'riskGateSession';
	stubGetSession(setup.chatService, sessionId, { requestId: 'req-risk', modeInfo: { permissionLevel } });

	return {
		invoke: (token: CancellationToken = CancellationToken.None) => setup.service.invokeTool(tool.makeDto({ x: 1 }, { sessionId }), async () => 0, token) as Promise<{ content: { value: string }[] }>,
		wasInvoked: () => invoked,
	};
}

suite('LanguageModelToolsService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let contextKeyService: IContextKeyService;
	let service: LanguageModelToolsService;
	let chatService: MockChatService;
	let configurationService: TestConfigurationService;

	setup(() => {
		const setup = createTestToolsService(store);
		configurationService = setup.configurationService;
		chatService = setup.chatService;
		service = setup.service;
		contextKeyService = setup.contextKeyService;
	});

	function setupToolsForTest(service: LanguageModelToolsService, store: any) {


		const tool1: IToolData = {
			id: 'tool1',
			toolReferenceName: 'tool1RefName',
			modelDescription: 'Test Tool 1',
			displayName: 'Tool1 Display Name',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
		};
		store.add(service.registerToolData(tool1));

		const tool2: IToolData = {
			id: 'tool2',
			modelDescription: 'Test Tool 2',
			displayName: 'Tool2 Display Name',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
		};
		store.add(service.registerToolData(tool2));


		const extTool1: IToolData = {
			id: 'extTool1',
			toolReferenceName: 'extTool1RefName',
			modelDescription: 'Test Extension Tool 1',
			displayName: 'ExtTool1 Display Name',
			source: { type: 'extension', label: 'My Extension', extensionId: new ExtensionIdentifier('my.extension') },
			canBeReferencedInPrompt: true,
		};
		store.add(service.registerToolData(extTool1));


		const internalToolSetTool1: IToolData = {
			id: 'internalToolSetTool1',
			toolReferenceName: 'internalToolSetTool1RefName',
			modelDescription: 'Test Internal Tool Set 1',
			displayName: 'InternalToolSet1 Display Name',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(internalToolSetTool1));

		const internalToolSet = store.add(service.createToolSet(
			ToolDataSource.Internal,
			'internalToolSet',
			'internalToolSetRefName',
			{ description: 'Test Set' }
		));
		store.add(internalToolSet.addTool(internalToolSetTool1));


		const userToolSet = store.add(service.createToolSet(
			{ type: 'user', label: 'User', file: URI.file('/test/userToolSet.json') },
			'userToolSet',
			'userToolSetRefName',
			{ description: 'Test Set' }
		));
		store.add(userToolSet.addTool(tool2));


		const mcpDataSource: ToolDataSource = { type: 'mcp', label: 'My MCP Server', serverLabel: 'MCP Server', instructions: undefined, collectionId: 'testMCPCollection', definitionId: 'testMCPDefId' };
		const mcpTool1: IToolData = {
			id: 'mcpTool1',
			toolReferenceName: 'mcpTool1RefName',
			modelDescription: 'Test MCP Tool 1',
			displayName: 'McpTool1 Display Name',
			source: mcpDataSource,
			canBeReferencedInPrompt: true,
		};
		store.add(service.registerToolData(mcpTool1));

		const mcpToolSet = store.add(service.createToolSet(
			mcpDataSource,
			'mcpToolSet',
			'mcpToolSetRefName',
			{ description: 'MCP Test ToolSet' }
		));
		store.add(mcpToolSet.addTool(mcpTool1));
	}


	test('registerToolData', () => {
		const toolData: IToolData = {
			id: 'testTool',
			modelDescription: 'Test Tool',
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		const disposable = service.registerToolData(toolData);
		assert.strictEqual(service.getTool('testTool')?.id, 'testTool');
		disposable.dispose();
		assert.strictEqual(service.getTool('testTool'), undefined);
	});

	test('registerToolImplementation', () => {
		const toolData: IToolData = {
			id: 'testTool',
			modelDescription: 'Test Tool',
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		store.add(service.registerToolData(toolData));

		const toolImpl: IToolImpl = {
			invoke: async () => ({ content: [{ kind: 'text', value: 'result' }] }),
		};

		store.add(service.registerToolImplementation('testTool', toolImpl));
		assert.strictEqual(service.getTool('testTool')?.id, 'testTool');
	});

	test('getTools', () => {
		contextKeyService.createKey('testKey', true);
		const toolData1: IToolData = {
			id: 'testTool1',
			modelDescription: 'Test Tool 1',
			when: ContextKeyEqualsExpr.create('testKey', false),
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		const toolData2: IToolData = {
			id: 'testTool2',
			modelDescription: 'Test Tool 2',
			when: ContextKeyEqualsExpr.create('testKey', true),
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		const toolData3: IToolData = {
			id: 'testTool3',
			modelDescription: 'Test Tool 3',
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		store.add(service.registerToolData(toolData1));
		store.add(service.registerToolData(toolData2));
		store.add(service.registerToolData(toolData3));

		const tools = Array.from(service.getTools(undefined));
		assert.strictEqual(tools.length, 2);
		assert.strictEqual(tools[0].id, 'testTool2');
		assert.strictEqual(tools[1].id, 'testTool3');
	});

	test('getToolByName', () => {
		contextKeyService.createKey('testKey', true);
		const toolData1: IToolData = {
			id: 'testTool1',
			toolReferenceName: 'testTool1',
			modelDescription: 'Test Tool 1',
			when: ContextKeyEqualsExpr.create('testKey', false),
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		const toolData2: IToolData = {
			id: 'testTool2',
			toolReferenceName: 'testTool2',
			modelDescription: 'Test Tool 2',
			when: ContextKeyEqualsExpr.create('testKey', true),
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		const toolData3: IToolData = {
			id: 'testTool3',
			toolReferenceName: 'testTool3',
			modelDescription: 'Test Tool 3',
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		store.add(service.registerToolData(toolData1));
		store.add(service.registerToolData(toolData2));
		store.add(service.registerToolData(toolData3));

		assert.strictEqual(service.getToolByName('testTool1')?.id, 'testTool1');
		assert.strictEqual(service.getToolByName('testTool2')?.id, 'testTool2');
		assert.strictEqual(service.getToolByName('testTool3')?.id, 'testTool3');
	});

	test('invokeTool', async () => {
		const toolData: IToolData = {
			id: 'testTool',
			modelDescription: 'Test Tool',
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		store.add(service.registerToolData(toolData));

		const toolImpl: IToolImpl = {
			invoke: async (invocation) => {
				assert.strictEqual(invocation.callId, '1');
				assert.strictEqual(invocation.toolId, 'testTool');
				assert.deepStrictEqual(invocation.parameters, { a: 1 });
				return { content: [{ kind: 'text', value: 'result' }] };
			}
		};

		store.add(service.registerToolImplementation('testTool', toolImpl));

		const dto: IToolInvocation = {
			callId: '1',
			toolId: 'testTool',
			tokenBudget: 100,
			parameters: {
				a: 1
			},
			context: undefined,
		};

		const result = await service.invokeTool(dto, async () => 0, CancellationToken.None);
		assert.strictEqual(result.content[0].value, 'result');
	});

	test('invokeTool uses re-registered implementation after prepareToolInvocation', async () => {
		const toolData: IToolData = {
			id: 'reRegisteredTool',
			modelDescription: 'Re-registered Tool',
			displayName: 'Re-registered Tool',
			source: ToolDataSource.Internal,
		};

		const registration = store.add(service.registerTool(toolData, {
			prepareToolInvocation: async () => {
				registration.dispose();
				store.add(service.registerTool(toolData, {
					invoke: async () => ({ content: [{ kind: 'text', value: 'replacement result' }] }),
				}));
				return undefined;
			},
			invoke: async () => ({ content: [{ kind: 'text', value: 'stale result' }] }),
		}));

		const result = await service.invokeTool({
			callId: '1',
			toolId: toolData.id,
			tokenBudget: 100,
			parameters: {},
			context: undefined,
		}, async () => 0, CancellationToken.None);

		assert.strictEqual(result.content[0].value, 'replacement result');
	});

	test('invokeTool reports a tool removed during prepareToolInvocation as not contributed', async () => {
		const toolData: IToolData = {
			id: 'removedTool',
			modelDescription: 'Removed Tool',
			displayName: 'Removed Tool',
			source: ToolDataSource.Internal,
		};

		const registration = store.add(service.registerTool(toolData, {
			prepareToolInvocation: async () => {
				registration.dispose();
				return undefined;
			},
			invoke: async () => ({ content: [{ kind: 'text', value: 'stale result' }] }),
		}));

		await assert.rejects(service.invokeTool({
			callId: '1',
			toolId: toolData.id,
			tokenBudget: 100,
			parameters: {},
			context: undefined,
		}, async () => 0, CancellationToken.None), /Tool removedTool was not contributed/);
	});

	test('invocation parameters are overridden by input toolSpecificData', async () => {
		const rawInput = { b: 2 };
		const tool = registerToolForTest(service, store, 'testToolInputOverride', {
			prepareToolInvocation: async () => ({
				toolSpecificData: { kind: 'input', rawInput } satisfies IChatToolInputInvocationData,
				confirmationMessages: {
					title: 'a',
					message: 'b',
				}
			}),
			invoke: async (invocation) => {
				assert.deepStrictEqual(invocation.parameters, rawInput);
				assert.strictEqual(invocation.toolSpecificData, undefined);
				return { content: [{ kind: 'text', value: 'ok' }] };
			},
		});

		const sessionId = 'sessionId';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'requestId-io', capture });
		const dto = tool.makeDto({ a: 1 }, { sessionId });

		const invokeP = service.invokeTool(dto, async () => 0, CancellationToken.None);
		const published = await waitForPublishedInvocation(capture);
		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await invokeP;
		assert.strictEqual(result.content[0].value, 'ok');
	});

	test('chat invocation injects input toolSpecificData for confirmation when alwaysDisplayInputOutput', async () => {
		const toolData: IToolData = {
			id: 'testToolDisplayIO',
			modelDescription: 'Test Tool',
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
			alwaysDisplayInputOutput: true,
		};

		const tool = registerToolForTest(service, store, 'testToolDisplayIO', {
			prepareToolInvocation: async () => ({
				confirmationMessages: { title: 'Confirm', message: 'Proceed?' }
			}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'done' }] }),
		}, toolData);

		const sessionId = 'sessionId-io';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'requestId-io', capture });

		const dto = tool.makeDto({ a: 1 }, { sessionId });

		const invokeP = service.invokeTool(dto, async () => 0, CancellationToken.None);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published, 'expected ChatToolInvocation to be published');
		assert.strictEqual(published.toolId, tool.id);
		assert.strictEqual(published.toolSpecificData?.kind, 'input');
		assert.deepStrictEqual(published.toolSpecificData?.rawInput, dto.parameters);

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await invokeP;
		assert.strictEqual(result.content[0].value, 'done');
	});

	test('chat invocation waits for user confirmation before invoking', async () => {
		const toolData: IToolData = {
			id: 'testToolConfirm',
			modelDescription: 'Test Tool',
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		let invoked = false;
		const tool = registerToolForTest(service, store, toolData.id, {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Confirm', message: 'Go?' } }),
			invoke: async () => {
				invoked = true;
				return { content: [{ kind: 'text', value: 'ran' }] };
			},
		}, toolData);

		const sessionId = 'sessionId-confirm';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'requestId-confirm', capture });

		const dto = tool.makeDto({ x: 1 }, { sessionId });

		const promise = service.invokeTool(dto, async () => 0, CancellationToken.None);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published, 'expected ChatToolInvocation to be published');
		assert.strictEqual(invoked, false, 'invoke should not run before confirmation');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await promise;
		assert.strictEqual(invoked, true, 'invoke should have run after confirmation');
		assert.strictEqual(result.content[0].value, 'ran');
	});

	test('selectedCustomButton is passed to tool invoke when user selects a custom button', async () => {
		let receivedInvocation: IToolInvocation | undefined;
		const tool = registerToolForTest(service, store, 'testToolCustomButton', {
			prepareToolInvocation: async () => ({
				confirmationMessages: {
					title: 'Confirm',
					message: 'Pick an option',
					customOptions: [
						{ id: 'Option A', label: 'Option A', kind: ConfirmationOptionKind.Approve },
						{ id: 'Option B', label: 'Option B', kind: ConfirmationOptionKind.Deny },
					],
					allowAutoConfirm: false,
				}
			}),
			invoke: async (invocation) => {
				receivedInvocation = invocation;
				return { content: [{ kind: 'text', value: invocation.selectedCustomButton ?? 'none' }] };
			},
		});

		const sessionId = 'sessionId-custom-btn';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'requestId-custom-btn', capture });

		const dto = tool.makeDto({ x: 1 }, { sessionId });

		const promise = service.invokeTool(dto, async () => 0, CancellationToken.None);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published, 'expected ChatToolInvocation to be published');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction, selectedButton: 'Option A' });
		const result = await promise;
		assert.strictEqual(receivedInvocation?.selectedCustomButton, 'Option A');
		assert.strictEqual(result.content[0].value, 'Option A');
	});

	test('selectedCustomButton is not set when user confirms without custom button', async () => {
		let receivedInvocation: IToolInvocation | undefined;
		const tool = registerToolForTest(service, store, 'testToolNoCustomBtn', {
			prepareToolInvocation: async () => ({
				confirmationMessages: { title: 'Confirm', message: 'Go?' }
			}),
			invoke: async (invocation) => {
				receivedInvocation = invocation;
				return { content: [{ kind: 'text', value: 'ok' }] };
			},
		});

		const sessionId = 'sessionId-no-custom-btn';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'requestId-no-custom-btn', capture });

		const dto = tool.makeDto({ x: 1 }, { sessionId });

		const promise = service.invokeTool(dto, async () => 0, CancellationToken.None);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published);

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await promise;
		assert.strictEqual(receivedInvocation?.selectedCustomButton, undefined);
		assert.strictEqual(result.content[0].value, 'ok');
	});

	test('confirmationMessages with customOptions disables allowAutoConfirm', async () => {
		const tool = registerToolForTest(service, store, 'testToolCustomBtnNoAuto', {
			prepareToolInvocation: async () => ({
				confirmationMessages: {
					title: 'Confirm',
					message: 'Choose',
					customOptions: [
						{ id: 'Yes', label: 'Yes', kind: ConfirmationOptionKind.Approve },
						{ id: 'No', label: 'No', kind: ConfirmationOptionKind.Deny },
					],
					allowAutoConfirm: false,
				}
			}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'done' }] }),
		});

		const sessionId = 'sessionId-custom-noauto';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'requestId-custom-noauto', capture });

		const dto = tool.makeDto({ x: 1 }, { sessionId });

		const promise = service.invokeTool(dto, async () => 0, CancellationToken.None);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published, 'expected ChatToolInvocation to be published');
		assert.deepStrictEqual(published.confirmationMessages?.customOptions?.map(o => o.label), ['Yes', 'No']);

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction, selectedButton: 'Yes' });
		await promise;
	});

	test('skipping modified-files confirmation returns the shared skip message and does not invoke the tool', async () => {
		let invoked = false;
		const tool = registerToolForTest(service, store, 'testModifiedFilesConfirmationSkip', {
			prepareToolInvocation: async () => ({
				confirmationMessages: {
					title: 'Confirm',
					message: 'Choose',
					allowAutoConfirm: false,
				},
				toolSpecificData: {
					kind: 'modifiedFilesConfirmation',
					options: ['Copy Changes', 'Move Changes'],
					modifiedFiles: [{
						uri: URI.parse('file:///workspace/file1.ts')
					}]
				}
			}),
			invoke: async () => {
				invoked = true;
				return { content: [{ kind: 'text', value: 'should not run' }] };
			},
		});

		const sessionId = 'sessionId-modified-files-skip';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'requestId-modified-files-skip', capture });

		const dto = tool.makeDto({ x: 1 }, { sessionId });
		const promise = service.invokeTool(dto, async () => 0, CancellationToken.None);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published, 'expected ChatToolInvocation to be published');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.Skipped });
		const result = await promise;

		assert.strictEqual(invoked, false);
		assert.deepStrictEqual(result.content, [{
			kind: 'text',
			value: 'The user chose to skip the tool call, they want to proceed without running it'
		}]);
	});

	test('cancel tool call', async () => {
		const toolBarrier = new Barrier();
		const tool = registerToolForTest(service, store, 'testTool', {
			invoke: async (invocation, countTokens, progress, cancelToken) => {
				assert.strictEqual(invocation.callId, '1');
				assert.strictEqual(invocation.toolId, 'testTool');
				assert.deepStrictEqual(invocation.parameters, { a: 1 });
				await toolBarrier.wait();
				if (cancelToken.isCancellationRequested) {
					throw new CancellationError();
				} else {
					throw new Error('Tool call should be cancelled');
				}
			}
		});

		const sessionId = 'sessionId';
		const requestId = 'requestId';
		const dto = tool.makeDto({ a: 1 }, { sessionId });
		stubGetSession(chatService, sessionId, { requestId });
		const toolPromise = service.invokeTool(dto, async () => 0, CancellationToken.None);
		service.cancelToolCallsForRequest(requestId);
		toolBarrier.open();
		await assert.rejects(toolPromise, err => {
			return isCancellationError(err);
		}, 'Expected tool call to be cancelled');
	});

	test('rejects tool invocation for cancelled request id', async () => {
		let invoked = false;
		const tool = registerToolForTest(service, store, 'testTool', {
			invoke: async () => {
				invoked = true;
				return { content: [{ kind: 'text', value: 'done' }] };
			}
		});

		const sessionId = 'sessionId-cancelled-request';
		const requestId = 'requestId-cancelled-request';
		const fakeModel = {
			sessionId,
			sessionResource: LocalChatSessionUri.forSession(sessionId),
			getRequests: () => [{
				id: requestId,
				modelId: 'test-model',
				response: { isCanceled: true },
			}],
		} as ChatModel;
		chatService.addSession(fakeModel);

		const dto: IToolInvocation = {
			...tool.makeDto({ a: 1 }, { sessionId }),
			chatRequestId: requestId,
		};

		await assert.rejects(service.invokeTool(dto, async () => 0, CancellationToken.None), err => {
			return isCancellationError(err);
		}, 'Expected tool invocation to be rejected for cancelled request id');

		assert.strictEqual(invoked, false, 'Tool implementation should not run after request cancellation');
	});

	test('toFullReferenceNames', () => {
		setupToolsForTest(service, store);

		const tool1 = service.getToolByFullReferenceName('tool1RefName');
		const extTool1 = service.getToolByFullReferenceName('my.extension/extTool1RefName');
		const mcpToolSet = service.getToolByFullReferenceName('mcpToolSetRefName/*');
		const mcpTool1 = service.getToolByFullReferenceName('mcpToolSetRefName/mcpTool1RefName');
		const internalToolSet = service.getToolByFullReferenceName('internalToolSetRefName');
		const internalTool = service.getToolByFullReferenceName('internalToolSetRefName/internalToolSetTool1RefName');
		const userToolSet = service.getToolSet('userToolSet');
		const unknownTool = { id: 'unregisteredTool', toolReferenceName: 'unregisteredToolRefName', modelDescription: 'Unregistered Tool', displayName: 'Unregistered Tool', source: ToolDataSource.Internal, canBeReferencedInPrompt: true } satisfies IToolData;
		const unknownToolSet = service.createToolSet(ToolDataSource.Internal, 'unknownToolSet', 'unknownToolSetRefName', { description: 'Unknown Test Set' });
		unknownToolSet.dispose();
		assert.ok(tool1);
		assert.ok(extTool1);
		assert.ok(mcpTool1);
		assert.ok(mcpToolSet);
		assert.ok(internalToolSet);
		assert.ok(internalTool);
		assert.ok(userToolSet);

		{
			const map = ToolAndToolSetEnablementMap.fromEntries([[tool1, true], [extTool1, true], [mcpToolSet, true], [mcpTool1, true]]);
			const fullReferenceNames = service.toFullReferenceNames(map);
			const expectedFullReferenceNames = ['tool1RefName', 'my.extension/extTool1RefName', 'mcpToolSetRefName/*'];
			assert.deepStrictEqual(fullReferenceNames.sort(), expectedFullReferenceNames.sort(), 'toFullReferenceNames should return the original enabled names');
		}
		{
			const map = ToolAndToolSetEnablementMap.fromEntries([[tool1, true], [userToolSet, true], [internalToolSet, false], [internalTool, true]]);
			const fullReferenceNames = service.toFullReferenceNames(map);
			const expectedFullReferenceNames = ['tool1RefName', 'internalToolSetRefName/internalToolSetTool1RefName'];
			assert.deepStrictEqual(fullReferenceNames.sort(), expectedFullReferenceNames.sort(), 'toFullReferenceNames should return the original enabled names');
		}
		{
			const map = ToolAndToolSetEnablementMap.fromEntries([[unknownTool, true], [unknownToolSet, true], [internalToolSet, true], [internalTool, true]]);
			const fullReferenceNames = service.toFullReferenceNames(map);
			const expectedFullReferenceNames = ['internalToolSetRefName'];
			assert.deepStrictEqual(fullReferenceNames.sort(), expectedFullReferenceNames.sort(), 'toFullReferenceNames should return the original enabled names');
		}
	});

	test('getFullReferenceName returns qualified names for tools and tool sets', () => {
		setupToolsForTest(service, store);

		const extTool1 = service.getToolByFullReferenceName('my.extension/extTool1RefName');
		const mcpToolSet = service.getToolByFullReferenceName('mcpToolSetRefName/*');
		const mcpTool1 = service.getToolByFullReferenceName('mcpToolSetRefName/mcpTool1RefName');
		const internalToolSet = service.getToolByFullReferenceName('internalToolSetRefName');
		const internalTool = service.getToolByFullReferenceName('internalToolSetRefName/internalToolSetTool1RefName');
		assert.ok(extTool1);
		assert.ok(mcpToolSet);
		assert.ok(mcpTool1);
		assert.ok(internalToolSet);
		assert.ok(internalTool);

		assert.strictEqual(service.getFullReferenceName(extTool1), 'my.extension/extTool1RefName');
		assert.strictEqual(service.getFullReferenceName(mcpToolSet), 'mcpToolSetRefName/*');
		assert.strictEqual(service.getFullReferenceName(mcpTool1), 'mcpToolSetRefName/mcpTool1RefName');
		assert.strictEqual(service.getFullReferenceName(internalToolSet), 'internalToolSetRefName');
		assert.strictEqual(service.getFullReferenceName(internalTool), 'internalToolSetRefName/internalToolSetTool1RefName');

		for (const item of [extTool1, mcpToolSet, mcpTool1, internalToolSet, internalTool]) {
			assert.strictEqual(service.getToolByFullReferenceName(service.getFullReferenceName(item)), item);
		}
	});


	test('toToolAndToolSetEnablementMap', () => {
		setupToolsForTest(service, store);

		const allFullReferenceNames = [
			'tool1RefName',
			'Tool2 Display Name',
			'my.extension/extTool1RefName',
			'mcpToolSetRefName/*',
			'mcpToolSetRefName/mcpTool1RefName',
			'internalToolSetRefName',
			'internalToolSetRefName/internalToolSetTool1RefName',
			'vscode',
			'execute',
			'read',
			'agent'
		];
		const numOfTools = allFullReferenceNames.length + 1;

		const tool1 = service.getToolByFullReferenceName('tool1RefName');
		const tool2 = service.getToolByFullReferenceName('Tool2 Display Name');
		const extTool1 = service.getToolByFullReferenceName('my.extension/extTool1RefName');
		const mcpToolSet = service.getToolByFullReferenceName('mcpToolSetRefName/*');
		const mcpTool1 = service.getToolByFullReferenceName('mcpToolSetRefName/mcpTool1RefName');
		const internalToolSet = service.getToolByFullReferenceName('internalToolSetRefName');
		const internalTool = service.getToolByFullReferenceName('internalToolSetRefName/internalToolSetTool1RefName');
		const userToolSet = service.getToolSet('userToolSet');
		const vscodeToolSet = service.getToolSet('vscode');
		const executeToolSet = service.getToolSet('execute');
		const readToolSet = service.getToolSet('read');
		const agentToolSet = service.getToolSet('agent');
		assert.ok(tool1);
		assert.ok(tool2);
		assert.ok(extTool1);
		assert.ok(mcpTool1);
		assert.ok(mcpToolSet);
		assert.ok(internalToolSet);
		assert.ok(internalTool);
		assert.ok(userToolSet);
		assert.ok(vscodeToolSet);
		assert.ok(executeToolSet);
		assert.ok(readToolSet);
		assert.ok(agentToolSet);
		{
			const fullReferenceNames = ['tool1RefName'];
			const result1 = service.toToolAndToolSetEnablementMap(fullReferenceNames, undefined);
			assert.strictEqual(result1.size, numOfTools, `Expected ${numOfTools} tools and tool sets`);
			assert.strictEqual([...result1.entries()].filter(([_, enabled]) => enabled).length, 1, 'Expected 1 tool to be enabled');
			assert.strictEqual(result1.get(tool1), true, 'tool1 should be enabled');

			const fullReferenceNames1 = service.toFullReferenceNames(result1);
			assert.deepStrictEqual(fullReferenceNames1.sort(), fullReferenceNames.sort(), 'toFullReferenceNames should return the original enabled names');

		}
		{
			const fullReferenceNames = ['my.extension/extTool1RefName', 'mcpToolSetRefName/*', 'internalToolSetRefName/internalToolSetTool1RefName'];
			const result1 = service.toToolAndToolSetEnablementMap(fullReferenceNames, undefined);
			assert.strictEqual(result1.size, numOfTools, `Expected ${numOfTools} tools and tool sets`);
			assert.strictEqual([...result1.entries()].filter(([_, enabled]) => enabled).length, 4, 'Expected 4 tools to be enabled');
			assert.strictEqual(result1.get(extTool1), true, 'extTool1 should be enabled');
			assert.strictEqual(result1.get(mcpToolSet), true, 'mcpToolSet should be enabled');
			assert.strictEqual(result1.get(mcpTool1), true, 'mcpTool1 should be enabled because the set is enabled');
			assert.strictEqual(result1.get(internalTool), true, 'internalTool should be enabled because the set is enabled');

			const fullReferenceNames1 = service.toFullReferenceNames(result1);
			assert.deepStrictEqual(fullReferenceNames1.sort(), fullReferenceNames.sort(), 'toFullReferenceNames should return the expected names');
		}
		{
			const result1 = service.toToolAndToolSetEnablementMap(allFullReferenceNames, undefined);
			assert.strictEqual(result1.size, numOfTools, `Expected ${numOfTools} tools and tool sets`);
			assert.strictEqual([...result1.entries()].filter(([_, enabled]) => enabled).length, 12, 'Expected 12 tools to be enabled');

			const fullReferenceNames1 = service.toFullReferenceNames(result1);
			const expectedFullReferenceNames = ['tool1RefName', 'Tool2 Display Name', 'my.extension/extTool1RefName', 'mcpToolSetRefName/*', 'internalToolSetRefName', 'vscode', 'execute', 'read', 'agent'];
			assert.deepStrictEqual(fullReferenceNames1.sort(), expectedFullReferenceNames.sort(), 'toFullReferenceNames should return the original enabled names');
		}
		{
			const fullReferenceNames: string[] = [];
			const result1 = service.toToolAndToolSetEnablementMap(fullReferenceNames, undefined);
			assert.strictEqual(result1.size, numOfTools, `Expected ${numOfTools} tools and tool sets`);
			assert.strictEqual([...result1.entries()].filter(([_, enabled]) => enabled).length, 0, 'Expected 0 tools to be enabled');

			const fullReferenceNames1 = service.toFullReferenceNames(result1);
			assert.deepStrictEqual(fullReferenceNames1.sort(), fullReferenceNames.sort(), 'toFullReferenceNames should return the original enabled names');
		}
		{
			const fullReferenceNames: string[] = ['unknownToolRefName'];
			const result1 = service.toToolAndToolSetEnablementMap(fullReferenceNames, undefined);
			assert.strictEqual(result1.size, numOfTools, `Expected ${numOfTools} tools and tool sets`);
			assert.strictEqual([...result1.entries()].filter(([_, enabled]) => enabled).length, 0, 'Expected 0 tools to be enabled');

			const fullReferenceNames1 = service.toFullReferenceNames(result1);
			assert.deepStrictEqual(fullReferenceNames1.sort(), [], 'toFullReferenceNames should return no enabled names');
		}
		{
			const fullReferenceNames: string[] = ['extTool1RefName', 'mcpToolSetRefName', 'internalToolSetTool1RefName'];
			const result1 = service.toToolAndToolSetEnablementMap(fullReferenceNames, undefined);
			assert.strictEqual(result1.size, numOfTools, `Expected ${numOfTools} tools and tool sets`);
			assert.strictEqual([...result1.entries()].filter(([_, enabled]) => enabled).length, 4, 'Expected 4 tools to be enabled');
			assert.strictEqual(result1.get(extTool1), true, 'extTool1 should be enabled');
			assert.strictEqual(result1.get(mcpToolSet), true, 'mcpToolSet should be enabled');
			assert.strictEqual(result1.get(mcpTool1), true, 'mcpTool1 should be enabled because the set is enabled');
			assert.strictEqual(result1.get(internalTool), true, 'internalTool should be enabled');

			const fullReferenceNames1 = service.toFullReferenceNames(result1);
			const expectedFullReferenceNames: string[] = ['my.extension/extTool1RefName', 'mcpToolSetRefName/*', 'internalToolSetRefName/internalToolSetTool1RefName'];
			assert.deepStrictEqual(fullReferenceNames1.sort(), expectedFullReferenceNames.sort(), 'toFullReferenceNames should return the original enabled names');
		}
		{
			const fullReferenceNames = ['Tool2 Display Name'];
			const result1 = service.toToolAndToolSetEnablementMap(fullReferenceNames, undefined);
			assert.strictEqual(result1.size, numOfTools, `Expected ${numOfTools} tools and tool sets`);
			assert.strictEqual([...result1.entries()].filter(([_, enabled]) => enabled).length, 2, 'Expected 1 tool and user tool set to be enabled');
			assert.strictEqual(result1.get(tool2), true, 'tool2 should be enabled');
			assert.strictEqual(result1.get(userToolSet), true, 'userToolSet should be enabled');

			const fullReferenceNames1 = service.toFullReferenceNames(result1);
			assert.deepStrictEqual(fullReferenceNames1.sort(), fullReferenceNames.sort(), 'toFullReferenceNames should return the original enabled names');

		}
	});

	test('toToolAndToolSetEnablementMap with extension tool', () => {
		const toolData1: IToolData = {
			id: 'tool1',
			toolReferenceName: 'refTool1',
			modelDescription: 'Test Tool 1',
			displayName: 'Test Tool 1',
			source: { type: 'extension', label: 'My Extension', extensionId: new ExtensionIdentifier('My.extension') },
			canBeReferencedInPrompt: true,
		};

		store.add(service.registerToolData(toolData1));

		const enabledNames = [toolData1].map(t => service.getFullReferenceName(t));
		const result = service.toToolAndToolSetEnablementMap(enabledNames, undefined);

		assert.strictEqual(result.get(toolData1), true, 'individual tool should be enabled');

		const fullReferenceNames = service.toFullReferenceNames(result);
		assert.deepStrictEqual(fullReferenceNames.sort(), enabledNames.sort(), 'toFullReferenceNames should return the original enabled names');
	});

	test('toToolAndToolSetEnablementMap with tool sets', () => {
		const toolData1: IToolData = {
			id: 'tool1',
			toolReferenceName: 'refTool1',
			modelDescription: 'Test Tool 1',
			displayName: 'Test Tool 1',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
		};

		const toolData2: IToolData = {
			id: 'tool2',
			modelDescription: 'Test Tool 2',
			displayName: 'Test Tool 2',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
		};

		store.add(service.registerToolData(toolData1));
		store.add(service.registerToolData(toolData2));

		const toolSet = store.add(service.createToolSet(
			ToolDataSource.Internal,
			'testToolSet',
			'refToolSet',
			{ description: 'Test Tool Set' }
		));

		const toolSetTool1: IToolData = {
			id: 'toolSetTool1',
			modelDescription: 'Tool Set Tool 1',
			displayName: 'Tool Set Tool 1',
			source: ToolDataSource.Internal,
		};

		const toolSetTool2: IToolData = {
			id: 'toolSetTool2',
			modelDescription: 'Tool Set Tool 2',
			displayName: 'Tool Set Tool 2',
			source: ToolDataSource.Internal,
		};

		store.add(service.registerToolData(toolSetTool1));
		store.add(service.registerToolData(toolSetTool2));
		store.add(toolSet.addTool(toolSetTool1));
		store.add(toolSet.addTool(toolSetTool2));

		const enabledNames = [toolSet, toolData1].map(t => service.getFullReferenceName(t));
		const result = service.toToolAndToolSetEnablementMap(enabledNames, undefined);

		assert.strictEqual(result.get(toolData1), true, 'individual tool should be enabled');
		assert.strictEqual(result.get(toolData2), false);
		assert.strictEqual(result.get(toolSet), true, 'tool set should be enabled');
		assert.strictEqual(result.get(toolSetTool1), true, 'tool set tool 1 should be enabled');
		assert.strictEqual(result.get(toolSetTool2), true, 'tool set tool 2 should be enabled');

		const fullReferenceNames = service.toFullReferenceNames(result);
		assert.deepStrictEqual(fullReferenceNames.sort(), enabledNames.sort(), 'toFullReferenceNames should return the original enabled names');
	});

	test('toFullReferenceNames does not emit a tool set when a member tool is unchecked', () => {
		const toolSet = store.add(service.createToolSet(
			ToolDataSource.Internal,
			'testToolSet',
			'refToolSet',
			{ description: 'Test Tool Set' }
		));

		const toolSetTool1: IToolData = {
			id: 'toolSetTool1',
			toolReferenceName: 'toolSetTool1Ref',
			modelDescription: 'Tool Set Tool 1',
			displayName: 'Tool Set Tool 1',
			source: ToolDataSource.Internal,
		};

		const toolSetTool2: IToolData = {
			id: 'toolSetTool2',
			toolReferenceName: 'toolSetTool2Ref',
			modelDescription: 'Tool Set Tool 2',
			displayName: 'Tool Set Tool 2',
			source: ToolDataSource.Internal,
		};

		store.add(service.registerToolData(toolSetTool1));
		store.add(service.registerToolData(toolSetTool2));
		store.add(toolSet.addTool(toolSetTool1));
		store.add(toolSet.addTool(toolSetTool2));

		const selection = service.toToolAndToolSetEnablementMap(['refToolSet', 'toolSetTool1Ref'], undefined);

		const fullReferenceNames = service.toFullReferenceNames(selection);
		assert.deepStrictEqual(fullReferenceNames, [service.getFullReferenceName(toolSet)]);
	});

	test('toToolAndToolSetEnablementMap with non-existent tool names', () => {
		const toolData: IToolData = {
			id: 'tool1',
			toolReferenceName: 'refTool1',
			modelDescription: 'Test Tool 1',
			displayName: 'Test Tool 1',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
		};

		store.add(service.registerToolData(toolData));

		const unregisteredToolData: IToolData = {
			id: 'toolX',
			toolReferenceName: 'refToolX',
			modelDescription: 'Test Tool X',
			displayName: 'Test Tool X',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
		};

		const enabledNames = [toolData, unregisteredToolData].map(t => service.getFullReferenceName(t));
		const result = service.toToolAndToolSetEnablementMap(enabledNames, undefined);

		assert.strictEqual(result.get(toolData), true, 'existing tool should be enabled');
		assert.strictEqual(result.get(unregisteredToolData), undefined, 'non-existent tool should not be in result');

		const fullReferenceNames = service.toFullReferenceNames(result);
		const expectedNames = [service.getFullReferenceName(toolData)];
		assert.deepStrictEqual(fullReferenceNames.sort(), expectedNames.sort(), 'toFullReferenceNames should return the original enabled names');

	});


	test('toToolAndToolSetEnablementMap with legacy names', () => {

		const toolWithLegacy: IToolData = {
			id: 'newTool',
			toolReferenceName: 'newToolRef',
			modelDescription: 'New Tool',
			displayName: 'New Tool',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
			legacyToolReferenceFullNames: ['oldToolName', 'deprecatedToolName']
		};
		store.add(service.registerToolData(toolWithLegacy));

		const toolSetWithLegacy = store.add(service.createToolSet(
			ToolDataSource.Internal,
			'newToolSet',
			'newToolSetRef',
			{ description: 'New Tool Set', legacyFullNames: ['oldToolSet', 'deprecatedToolSet'] }
		));

		const toolInSet: IToolData = {
			id: 'toolInSet',
			toolReferenceName: 'toolInSetRef',
			modelDescription: 'Tool In Set',
			displayName: 'Tool In Set',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(toolInSet));
		store.add(toolSetWithLegacy.addTool(toolInSet));

		{
			const result = service.toToolAndToolSetEnablementMap(['oldToolName'], undefined);
			assert.strictEqual(result.get(toolWithLegacy), true, 'tool should be enabled via legacy name');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames, ['newToolRef'], 'should return current full reference name, not legacy');
		}

		{
			const result = service.toToolAndToolSetEnablementMap(['deprecatedToolName'], undefined);
			assert.strictEqual(result.get(toolWithLegacy), true, 'tool should be enabled via another legacy name');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames, ['newToolRef'], 'should return current full reference name, not legacy');
		}

		{
			const result = service.toToolAndToolSetEnablementMap(['oldToolSet'], undefined);
			assert.strictEqual(result.get(toolSetWithLegacy), true, 'toolset should be enabled via legacy name');
			assert.strictEqual(result.get(toolInSet), true, 'tool in set should be enabled when set is enabled via legacy name');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames, ['newToolSetRef'], 'should return current full reference name, not legacy');
		}

		{
			const result = service.toToolAndToolSetEnablementMap(['deprecatedToolSet'], undefined);
			assert.strictEqual(result.get(toolSetWithLegacy), true, 'toolset should be enabled via another legacy name');
			assert.strictEqual(result.get(toolInSet), true, 'tool in set should be enabled when set is enabled via legacy name');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames, ['newToolSetRef'], 'should return current full reference name, not legacy');
		}

		{
			const result = service.toToolAndToolSetEnablementMap(['newToolRef', 'oldToolSet'], undefined);
			assert.strictEqual(result.get(toolWithLegacy), true, 'tool should be enabled via current name');
			assert.strictEqual(result.get(toolSetWithLegacy), true, 'toolset should be enabled via legacy name');
			assert.strictEqual(result.get(toolInSet), true, 'tool in set should be enabled');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames.sort(), ['newToolRef', 'newToolSetRef'].sort(), 'should return current full reference names');
		}

		{
			const result = service.toToolAndToolSetEnablementMap(['newToolRef', 'oldToolName', 'deprecatedToolName'], undefined);
			assert.strictEqual(result.get(toolWithLegacy), true, 'tool should be enabled (redundant legacy names should not cause issues)');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames, ['newToolRef'], 'should return single current full reference name');
		}
	});

	test('toToolAndToolSetEnablementMap with orphaned toolset in legacy names', () => {

		const toolWithOrphanedToolSet: IToolData = {
			id: 'migratedTool',
			toolReferenceName: 'newToolRef',
			modelDescription: 'Migrated Tool',
			displayName: 'Migrated Tool',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
			legacyToolReferenceFullNames: ['oldToolSet/oldToolName']
		};
		store.add(service.registerToolData(toolWithOrphanedToolSet));

		{
			const result = service.toToolAndToolSetEnablementMap(['oldToolSet/oldToolName'], undefined);
			assert.strictEqual(result.get(toolWithOrphanedToolSet), true, 'tool should be enabled via full legacy name');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames, ['newToolRef'], 'should return current full reference name');
		}

		{
			const result = service.toToolAndToolSetEnablementMap(['oldToolSet'], undefined);
			assert.strictEqual(result.get(toolWithOrphanedToolSet), true, 'tool should be enabled via orphaned toolset name');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames, ['newToolRef'], 'should return current full reference name');
		}

		const anotherToolFromOrphanedSet: IToolData = {
			id: 'anotherMigratedTool',
			toolReferenceName: 'anotherNewToolRef',
			modelDescription: 'Another Migrated Tool',
			displayName: 'Another Migrated Tool',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
			legacyToolReferenceFullNames: ['oldToolSet/anotherOldToolName']
		};
		store.add(service.registerToolData(anotherToolFromOrphanedSet));

		{
			const result = service.toToolAndToolSetEnablementMap(['oldToolSet'], undefined);
			assert.strictEqual(result.get(toolWithOrphanedToolSet), true, 'first tool should be enabled via orphaned toolset name');
			assert.strictEqual(result.get(anotherToolFromOrphanedSet), true, 'second tool should also be enabled via orphaned toolset name');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames.sort(), ['newToolRef', 'anotherNewToolRef'].sort(), 'should return both current full reference names');
		}

		const unrelatedTool: IToolData = {
			id: 'unrelatedTool',
			toolReferenceName: 'unrelatedToolRef',
			modelDescription: 'Unrelated Tool',
			displayName: 'Unrelated Tool',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
			legacyToolReferenceFullNames: ['differentToolSet/oldName']
		};
		store.add(service.registerToolData(unrelatedTool));

		{
			const result = service.toToolAndToolSetEnablementMap(['oldToolSet'], undefined);
			assert.strictEqual(result.get(toolWithOrphanedToolSet), true, 'tool from oldToolSet should be enabled');
			assert.strictEqual(result.get(anotherToolFromOrphanedSet), true, 'another tool from oldToolSet should be enabled');
			assert.strictEqual(result.get(unrelatedTool), false, 'tool from different toolset should NOT be enabled');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames.sort(), ['newToolRef', 'anotherNewToolRef'].sort(), 'should only return tools from oldToolSet');
		}

		const newToolSetWithSameName = store.add(service.createToolSet(
			ToolDataSource.Internal,
			'recreatedToolSet',
			'oldToolSet',
			{ description: 'Recreated Tool Set' }
		));

		const toolInRecreatedSet: IToolData = {
			id: 'toolInRecreatedSet',
			toolReferenceName: 'toolInRecreatedSetRef',
			modelDescription: 'Tool In Recreated Set',
			displayName: 'Tool In Recreated Set',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(toolInRecreatedSet));
		store.add(newToolSetWithSameName.addTool(toolInRecreatedSet));

		{
			const result = service.toToolAndToolSetEnablementMap(['oldToolSet'], undefined);
			assert.strictEqual(result.get(newToolSetWithSameName), true, 'recreated toolset should be enabled');
			assert.strictEqual(result.get(toolInRecreatedSet), true, 'tool in recreated set should be enabled');
			assert.strictEqual(result.get(toolWithOrphanedToolSet), true, 'tool with legacy toolset should still be enabled');
			assert.strictEqual(result.get(anotherToolFromOrphanedSet), true, 'another tool with legacy toolset should still be enabled');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames.sort(), ['oldToolSet', 'newToolRef', 'anotherNewToolRef'].sort(), 'should return toolset and individual tools');
		}
	});

	test('toToolAndToolSetEnablementMap map Github to VSCode tools', () => {
		const runInTerminalToolData: IToolData = {
			id: 'runInTerminalId',
			toolReferenceName: 'runInTerminal',
			modelDescription: 'runInTerminal Description',
			displayName: 'runInTerminal displayName',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: false,
		};

		store.add(service.registerToolData(runInTerminalToolData));
		store.add(service.executeToolSet.addTool(runInTerminalToolData));


		const runSubagentToolData: IToolData = {
			id: 'runSubagentId',
			toolReferenceName: 'runSubagent',
			modelDescription: 'runSubagent Description',
			displayName: 'runSubagent displayName',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: false,
		};

		store.add(service.registerToolData(runSubagentToolData));
		store.add(service.agentToolSet.addTool(runSubagentToolData));

		const githubMcpDataSource: ToolDataSource = { type: 'mcp', label: 'Github', serverLabel: 'Github MCP Server', instructions: undefined, collectionId: 'githubMCPCollection', definitionId: 'githubMCPDefId' };
		const githubMcpTool1: IToolData = {
			id: 'create_branch',
			toolReferenceName: 'create_branch',
			modelDescription: 'Test Github MCP Tool 1',
			displayName: 'Create Branch',
			source: githubMcpDataSource,
			canBeReferencedInPrompt: true,
		};
		store.add(service.registerToolData(githubMcpTool1));

		const githubMcpToolSet = store.add(service.createToolSet(
			githubMcpDataSource,
			'githubMcpToolSet',
			'github/github-mcp-server',
			{ description: 'Github MCP Test ToolSet' }
		));
		store.add(githubMcpToolSet.addTool(githubMcpTool1));

		assert.equal(githubMcpToolSet.referenceName, 'github', 'github/github-mcp-server will be normalized to github');

		const playwrightMcpDataSource: ToolDataSource = { type: 'mcp', label: 'playwright', serverLabel: 'playwright MCP Server', instructions: undefined, collectionId: 'playwrightMCPCollection', definitionId: 'playwrightMCPDefId' };
		const playwrightMcpTool1: IToolData = {
			id: 'browser_click',
			toolReferenceName: 'browser_click',
			modelDescription: 'Test playwright MCP Tool 1',
			displayName: 'Create Branch',
			source: playwrightMcpDataSource,
			canBeReferencedInPrompt: true,
		};
		store.add(service.registerToolData(playwrightMcpTool1));

		const playwrightMcpToolSet = store.add(service.createToolSet(
			playwrightMcpDataSource,
			'playwrightMcpToolSet',
			'microsoft/playwright-mcp',
			{ description: 'playwright MCP Test ToolSet' }
		));
		store.add(playwrightMcpToolSet.addTool(playwrightMcpTool1));

		const deprecated = service.getDeprecatedFullReferenceNames();
		const deprecatesTo = (key: string): string[] | undefined => {
			const values = deprecated.get(key);
			return values ? Array.from(values).sort() : undefined;
		};

		assert.equal(playwrightMcpToolSet.referenceName, 'playwright', 'microsoft/playwright-mcp will be normalized to playwright');

		{
			const toolNames = ['custom-agent', 'shell'];
			const result = service.toToolAndToolSetEnablementMap(toolNames, undefined);

			assert.strictEqual(result.get(service.executeToolSet), true, 'execute should be enabled');
			assert.strictEqual(result.get(service.agentToolSet), true, 'agent should be enabled');

			const fullReferenceNames = service.toFullReferenceNames(result).sort();
			assert.deepStrictEqual(fullReferenceNames, [SpecedToolAliases.agent, SpecedToolAliases.execute].sort(), 'toFullReferenceNames should return the VS Code tool names');

			assert.deepStrictEqual(toolNames.map(name => service.getToolByFullReferenceName(name)), [service.agentToolSet, service.executeToolSet]);

			assert.deepStrictEqual(deprecatesTo('custom-agent'), [SpecedToolAliases.agent], 'customAgent should map to agent');
			assert.deepStrictEqual(deprecatesTo('shell'), [SpecedToolAliases.execute], 'shell is now execute');
		}
		{
			const toolNames = ['github/*', 'playwright/*'];
			const result = service.toToolAndToolSetEnablementMap(toolNames, undefined);

			assert.strictEqual(result.get(githubMcpToolSet), true, 'githubMcpToolSet should be enabled');
			assert.strictEqual(result.get(playwrightMcpToolSet), true, 'playwrightMcpToolSet should be enabled');
			const fullReferenceNames = service.toFullReferenceNames(result).sort();
			assert.deepStrictEqual(fullReferenceNames, ['github/*', 'playwright/*'], 'toFullReferenceNames should return the VS Code tool names');

			assert.deepStrictEqual(toolNames.map(name => service.getToolByFullReferenceName(name)), [githubMcpToolSet, playwrightMcpToolSet]);

			assert.deepStrictEqual(deprecatesTo('github/*'), undefined, 'github/* is fine');
			assert.deepStrictEqual(deprecatesTo('playwright/*'), undefined, 'playwright/* is fine');
		}

		{
			const toolNames = ['github/create_branch', 'playwright/browser_click'];
			const result = service.toToolAndToolSetEnablementMap(toolNames, undefined);

			assert.strictEqual(result.get(githubMcpTool1), true, 'githubMcpTool1 should be enabled');
			assert.strictEqual(result.get(playwrightMcpTool1), true, 'playwrightMcpTool1 should be enabled');
			const fullReferenceNames = service.toFullReferenceNames(result).sort();
			assert.deepStrictEqual(fullReferenceNames, ['github/create_branch', 'playwright/browser_click'], 'toFullReferenceNames should return the speced names');

			assert.deepStrictEqual(toolNames.map(name => service.getToolByFullReferenceName(name)), [githubMcpTool1, playwrightMcpTool1]);

			assert.deepStrictEqual(deprecatesTo('github/create_branch'), undefined, 'github/create_branch is fine');
			assert.deepStrictEqual(deprecatesTo('playwright/browser_click'), undefined, 'playwright/browser_click is fine');
		}

		{
			const toolNames = ['github/github-mcp-server/*', 'microsoft/playwright-mcp/*'];
			const result = service.toToolAndToolSetEnablementMap(toolNames, undefined);

			assert.strictEqual(result.get(githubMcpToolSet), true, 'githubMcpToolSet should be enabled');
			assert.strictEqual(result.get(playwrightMcpToolSet), true, 'playwrightMcpToolSet should be enabled');
			const fullReferenceNames = service.toFullReferenceNames(result).sort();
			assert.deepStrictEqual(fullReferenceNames, ['github/*', 'playwright/*'], 'toFullReferenceNames should return the speced names');

			assert.deepStrictEqual(toolNames.map(name => service.getToolByFullReferenceName(name)), [githubMcpToolSet, playwrightMcpToolSet]);

			assert.deepStrictEqual(deprecatesTo('github/github-mcp-server/*'), ['github/*']);
			assert.deepStrictEqual(deprecatesTo('microsoft/playwright-mcp/*'), ['playwright/*']);
		}
		{
			const toolNames = ['github/github-mcp-server/create_branch', 'microsoft/playwright-mcp/browser_click'];
			const result = service.toToolAndToolSetEnablementMap(toolNames, undefined);

			assert.strictEqual(result.get(githubMcpTool1), true, 'githubMcpTool1 should be enabled');
			assert.strictEqual(result.get(playwrightMcpTool1), true, 'playwrightMcpTool1 should be enabled');
			const fullReferenceNames = service.toFullReferenceNames(result).sort();
			assert.deepStrictEqual(fullReferenceNames, ['github/create_branch', 'playwright/browser_click'], 'toFullReferenceNames should return the speced names');

			assert.deepStrictEqual(toolNames.map(name => service.getToolByFullReferenceName(name)), [githubMcpTool1, playwrightMcpTool1]);

			assert.deepStrictEqual(deprecatesTo('github/github-mcp-server/create_branch'), ['github/create_branch']);
			assert.deepStrictEqual(deprecatesTo('microsoft/playwright-mcp/browser_click'), ['playwright/browser_click']);
		}

		{
			const toolNames = ['io.github.github/github-mcp-server/*', 'com.microsoft/playwright-mcp/*'];
			const result = service.toToolAndToolSetEnablementMap(toolNames, undefined);

			assert.strictEqual(result.get(githubMcpToolSet), true, 'githubMcpToolSet should be enabled');
			assert.strictEqual(result.get(playwrightMcpToolSet), true, 'playwrightMcpToolSet should be enabled');
			const fullReferenceNames = service.toFullReferenceNames(result).sort();
			assert.deepStrictEqual(fullReferenceNames, ['github/*', 'playwright/*'], 'toFullReferenceNames should return the speced names');

			assert.deepStrictEqual(toolNames.map(name => service.getToolByFullReferenceName(name)), [githubMcpToolSet, playwrightMcpToolSet]);

			assert.deepStrictEqual(deprecatesTo('io.github.github/github-mcp-server/*'), ['github/*']);
			assert.deepStrictEqual(deprecatesTo('com.microsoft/playwright-mcp/*'), ['playwright/*']);
		}

		{
			const toolNames = ['io.github.github/github-mcp-server/create_branch', 'com.microsoft/playwright-mcp/browser_click'];
			const result = service.toToolAndToolSetEnablementMap(toolNames, undefined);

			assert.strictEqual(result.get(githubMcpTool1), true, 'githubMcpTool1 should be enabled');
			assert.strictEqual(result.get(playwrightMcpTool1), true, 'playwrightMcpTool1 should be enabled');
			const fullReferenceNames = service.toFullReferenceNames(result).sort();
			assert.deepStrictEqual(fullReferenceNames, ['github/create_branch', 'playwright/browser_click'], 'toFullReferenceNames should return the speced names');

			assert.deepStrictEqual(toolNames.map(name => service.getToolByFullReferenceName(name)), [githubMcpTool1, playwrightMcpTool1]);

			assert.deepStrictEqual(deprecatesTo('io.github.github/github-mcp-server/create_branch'), ['github/create_branch']);
			assert.deepStrictEqual(deprecatesTo('com.microsoft/playwright-mcp/browser_click'), ['playwright/browser_click']);
		}

		{
			const toolNames = ['github-mcp-server/create_branch'];
			const result = service.toToolAndToolSetEnablementMap(toolNames, undefined);

			assert.strictEqual(result.get(githubMcpTool1), true, 'githubMcpTool1 should be enabled');
			const fullReferenceNames = service.toFullReferenceNames(result).sort();
			assert.deepStrictEqual(fullReferenceNames, ['github/create_branch'], 'toFullReferenceNames should return the VS Code tool names');

			assert.deepStrictEqual(toolNames.map(name => service.getToolByFullReferenceName(name)), [githubMcpTool1]);

			assert.deepStrictEqual(deprecatesTo('github-mcp-server/create_branch'), ['github/create_branch']);
		}

	});

	test('accessibility signal for tool confirmation', async () => {
		const testAccessibilityService = new class extends TestAccessibilityService {
			override isScreenReaderOptimized(): boolean { return true; }
		}();

		const testAccessibilitySignalService = new TestAccessibilitySignalService();

		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			accessibilityService: testAccessibilityService,
			accessibilitySignalService: testAccessibilitySignalService,
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', false);
				config.setUserConfiguration('accessibility.signals.chatUserActionRequired', { sound: 'auto', announcement: 'auto' });
			}
		});

		const toolData: IToolData = {
			id: 'testAccessibilityTool',
			modelDescription: 'Test Accessibility Tool',
			displayName: 'Test Accessibility Tool',
			source: ToolDataSource.Internal,
		};

		const tool = registerToolForTest(testService, store, toolData.id, {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Accessibility Test', message: 'Testing accessibility signal' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'executed' }] }),
		}, toolData);

		const sessionId = 'sessionId-accessibility';
		const capture: { invocation?: any } = {};
		stubGetSession(testChatService, sessionId, { requestId: 'requestId-accessibility', capture });

		const dto = tool.makeDto({ param: 'value' }, { sessionId });

		const promise = testService.invokeTool(dto, async () => 0, CancellationToken.None);
		const published = await waitForPublishedInvocation(capture);

		assert.ok(published, 'expected ChatToolInvocation to be published');
		assert.ok(published.confirmationMessages, 'should have confirmation messages');

		assert.strictEqual(testAccessibilitySignalService.signalPlayedCalls.length, 1, 'accessibility signal should have been played once');
		const signalCall = testAccessibilitySignalService.signalPlayedCalls[0];
		assert.strictEqual(signalCall.signal, AccessibilitySignal.chatUserActionRequired, 'correct signal should be played');
		assert.ok(signalCall.options?.customAlertMessage.includes('Accessibility Test'), 'alert message should include tool title');
		assert.ok(signalCall.options?.customAlertMessage.includes('Chat confirmation required'), 'alert message should include confirmation text');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await promise;
		assert.strictEqual(result.content[0].value, 'executed');
	});

	test('accessibility signal respects autoApprove configuration', async () => {
		const testAccessibilityService = new class extends TestAccessibilityService {
			override isScreenReaderOptimized(): boolean { return true; }
		}();

		const testAccessibilitySignalService = new TestAccessibilitySignalService();

		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			accessibilityService: testAccessibilityService,
			accessibilitySignalService: testAccessibilitySignalService,
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', true);
				config.setUserConfiguration('accessibility.signals.chatUserActionRequired', { sound: 'auto', announcement: 'auto' });
			}
		});

		const toolData: IToolData = {
			id: 'testAutoApproveTool',
			modelDescription: 'Test Auto Approve Tool',
			displayName: 'Test Auto Approve Tool',
			source: ToolDataSource.Internal,
		};

		const tool = registerToolForTest(testService, store, toolData.id, {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Auto Approve Test', message: 'Testing auto approve' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'auto approved' }] }),
		}, toolData);

		const sessionId = 'sessionId-auto-approve';
		const capture: { invocation?: any } = {};
		stubGetSession(testChatService, sessionId, { requestId: 'requestId-auto-approve', capture });

		const dto = tool.makeDto({ config: 'test' }, { sessionId });

		const result = await testService.invokeTool(dto, async () => 0, CancellationToken.None);

		assert.strictEqual(result.content[0].value, 'auto approved');
		assert.strictEqual(testAccessibilitySignalService.signalPlayedCalls.length, 0, 'accessibility signal should not be played when auto-approve is enabled');
	});

	test('autopilot permission level bypasses global auto-approve check', async () => {

		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', false);
			}
		});

		const tool = registerToolForTest(testService, store, 'autopilotTool', {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Confirm?', message: 'Should be auto-approved by autopilot' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'autopilot approved' }] })
		});

		const sessionId = 'test-autopilot';
		stubGetSession(testChatService, sessionId, {
			requestId: 'req1',
			modeInfo: { permissionLevel: ChatPermissionLevel.Autopilot },
		});


		const result = await testService.invokeTool(
			tool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(result.content[0].value, 'autopilot approved');
	});

	test('autopilot finds correct request by chatRequestId', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', false);
			}
		});

		const tool = registerToolForTest(testService, store, 'autopilotIdTool', {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Confirm?', message: 'Test' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'found by id' }] })
		});

		const sessionId = 'test-autopilot-id';
		const fakeModel = {
			sessionId,
			sessionResource: LocalChatSessionUri.forSession(sessionId),
			getRequests: () => [
				{ id: 'req-old', modelId: 'test-model', modeInfo: undefined },
				{ id: 'req-autopilot', modelId: 'test-model', modeInfo: { permissionLevel: ChatPermissionLevel.Autopilot } },
			],
		} as ChatModel;
		testChatService.addSession(fakeModel);

		const dto = tool.makeDto({ test: 1 }, { sessionId });
		dto.chatRequestId = 'req-autopilot';

		const result = await testService.invokeTool(dto, async () => 0, CancellationToken.None);
		assert.strictEqual(result.content[0].value, 'found by id');
	});

	test('autopilot auto-approves terminal tool with confirmation messages', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', false);
			}
		});

		const tool = registerToolForTest(testService, store, 'terminalTool', {
			prepareToolInvocation: async () => ({
				confirmationMessages: {
					title: 'Run shell command?',
					message: 'echo hello',
				},
				toolSpecificData: {
					kind: 'terminal' as const,
					terminalToolSessionId: 'test',
					terminalCommandId: 'cmd-1',
					commandLine: { original: 'echo hello' },
					language: 'sh',
				},
			}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'terminal executed' }] })
		});

		const sessionId = 'test-autopilot-terminal';
		stubGetSession(testChatService, sessionId, {
			requestId: 'req1',
			modeInfo: { permissionLevel: ChatPermissionLevel.Autopilot },
		});

		const result = await testService.invokeTool(
			tool.makeDto({ command: 'echo hello', explanation: 'test', goal: 'test', isBackground: false }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(result.content[0].value, 'terminal executed');
	});

	test('autopilot risk gate skips a tool assessed as high-risk (red)', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Red, explanation: 'Deletes source files irreversibly.' };
		const t = setupRiskGateTool(setup, store);

		const result = await t.invoke();

		assert.deepStrictEqual(
			{
				invoked: t.wasInvoked(),
				assessCalls: setup.riskAssessmentService.assessCalls.length,
				mentionsRisk: String(result.content[0].value).includes('Deletes source files irreversibly.'),
			},
			{ invoked: false, assessCalls: 1, mentionsRisk: true },
		);
	});

	test('autopilot risk gate allows a low-risk (green) tool call', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Green, explanation: 'Reads a file.' };
		const t = setupRiskGateTool(setup, store);

		const result = await t.invoke();

		assert.deepStrictEqual(
			{ invoked: t.wasInvoked(), assessCalls: setup.riskAssessmentService.assessCalls.length, value: result.content[0].value },
			{ invoked: true, assessCalls: 1, value: 'ran' },
		);
	});

	test('autopilot risk gate allows a medium-risk (orange) tool call (red-only threshold)', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Orange, explanation: 'Edits a file.' };
		const t = setupRiskGateTool(setup, store);

		const result = await t.invoke();

		assert.deepStrictEqual(
			{ invoked: t.wasInvoked(), assessCalls: setup.riskAssessmentService.assessCalls.length, value: result.content[0].value },
			{ invoked: true, assessCalls: 1, value: 'ran' },
		);
	});

	test('autopilot risk gate fails open when the classifier returns no assessment', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = undefined;
		const t = setupRiskGateTool(setup, store);

		const result = await t.invoke();

		assert.deepStrictEqual(
			{ invoked: t.wasInvoked(), assessCalls: setup.riskAssessmentService.assessCalls.length, value: result.content[0].value },
			{ invoked: true, assessCalls: 1, value: 'ran' },
		);
	});

	test('autopilot risk gate fails open when the classifier throws', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessError = new Error('network down');
		const t = setupRiskGateTool(setup, store);

		const result = await t.invoke();

		assert.deepStrictEqual(
			{ invoked: t.wasInvoked(), value: result.content[0].value },
			{ invoked: true, value: 'ran' },
		);
	});

	test('autopilot risk gate does not assess tool calls that have no confirmation', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Red, explanation: 'should not matter' };
		const t = setupRiskGateTool(setup, store, { withConfirmation: false });

		const result = await t.invoke();

		assert.deepStrictEqual(
			{ invoked: t.wasInvoked(), assessCalls: setup.riskAssessmentService.assessCalls.length, value: result.content[0].value },
			{ invoked: true, assessCalls: 0, value: 'ran' },
		);
	});

	test('autopilot risk gate classifies a terminal command even when it has no confirmation', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Red, explanation: 'Force-pushes main, overwriting history.' };
		const t = setupRiskGateTool(setup, store, { withConfirmation: false, toolId: 'run_in_terminal' });

		const result = await t.invoke();

		assert.deepStrictEqual(
			{
				invoked: t.wasInvoked(),
				assessCalls: setup.riskAssessmentService.assessCalls.length,
				isRiskMessage: String(result.content[0].value).startsWith('Autopilot skipped this tool call'),
			},
			{ invoked: false, assessCalls: 1, isRiskMessage: true },
		);
	});

	test('autopilot risk gate runs a non-red terminal command that has no confirmation', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Orange, explanation: 'Installs a package.' };
		const t = setupRiskGateTool(setup, store, { withConfirmation: false, toolId: 'run_in_terminal' });

		const result = await t.invoke();

		assert.deepStrictEqual(
			{ invoked: t.wasInvoked(), assessCalls: setup.riskAssessmentService.assessCalls.length, value: result.content[0].value },
			{ invoked: true, assessCalls: 1, value: 'ran' },
		);
	});

	test('autopilot risk gate classifies a fetch web page call even when it has no confirmation', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Red, explanation: 'Sends workspace secrets to an untrusted host.' };
		const t = setupRiskGateTool(setup, store, { withConfirmation: false, toolId: 'vscode_fetchWebPage_internal' });

		const result = await t.invoke();

		assert.deepStrictEqual(
			{
				invoked: t.wasInvoked(),
				assessCalls: setup.riskAssessmentService.assessCalls.length,
				isRiskMessage: String(result.content[0].value).startsWith('Autopilot skipped this tool call'),
			},
			{ invoked: false, assessCalls: 1, isRiskMessage: true },
		);
	});

	test('autopilot risk gate runs a non-red fetch web page call that has no confirmation', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Green, explanation: 'Fetches public documentation.' };
		const t = setupRiskGateTool(setup, store, { withConfirmation: false, toolId: 'copilot_fetchWebPage' });

		const result = await t.invoke();

		assert.deepStrictEqual(
			{ invoked: t.wasInvoked(), assessCalls: setup.riskAssessmentService.assessCalls.length, value: result.content[0].value },
			{ invoked: true, assessCalls: 1, value: 'ran' },
		);
	});

	test('autopilot risk gate is inert when Advanced Autopilot is disabled', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Red, explanation: 'should not matter' };
		const t = setupRiskGateTool(setup, store, { advancedEnabled: false });

		const result = await t.invoke();

		assert.deepStrictEqual(
			{ invoked: t.wasInvoked(), assessCalls: setup.riskAssessmentService.assessCalls.length, value: result.content[0].value },
			{ invoked: true, assessCalls: 0, value: 'ran' },
		);
	});

	test('autopilot risk gate does not apply at the plain Auto-Approve level', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Red, explanation: 'should not matter' };
		const t = setupRiskGateTool(setup, store, { permissionLevel: ChatPermissionLevel.AutoApprove });

		const result = await t.invoke();

		assert.deepStrictEqual(
			{ invoked: t.wasInvoked(), assessCalls: setup.riskAssessmentService.assessCalls.length, value: result.content[0].value },
			{ invoked: true, assessCalls: 0, value: 'ran' },
		);
	});

	test('autopilot risk gate runs even when the risk assessment badge setting is disabled', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = false;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Red, explanation: 'Deletes source files irreversibly.' };
		const t = setupRiskGateTool(setup, store);

		const result = await t.invoke();

		assert.deepStrictEqual(
			{
				invoked: t.wasInvoked(),
				assessCalls: setup.riskAssessmentService.assessCalls.length,
				isRiskMessage: String(result.content[0].value).startsWith('Autopilot skipped this tool call'),
			},
			{ invoked: false, assessCalls: 1, isRiskMessage: true },
		);
	});

	test('autopilot risk gate skips on red even when the classifier explanation is empty', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Red, explanation: '' };
		const t = setupRiskGateTool(setup, store);

		const result = await t.invoke();

		assert.deepStrictEqual(
			{
				invoked: t.wasInvoked(),
				assessCalls: setup.riskAssessmentService.assessCalls.length,
				isRiskMessage: String(result.content[0].value).startsWith('Autopilot skipped this tool call'),
				isUserSkipMessage: String(result.content[0].value).includes('The user chose to skip'),
			},
			{ invoked: false, assessCalls: 1, isRiskMessage: true, isUserSkipMessage: false },
		);
	});

	test('autopilot risk gate does not skip when cancelled during assessment', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Red, explanation: 'Deletes source files irreversibly.' };
		const t = setupRiskGateTool(setup, store);

		const cts = store.add(new CancellationTokenSource());
		setup.riskAssessmentService.onAssess = () => cts.cancel();

		await assert.rejects(() => t.invoke(cts.token), err => isCancellationError(err));
		assert.deepStrictEqual(
			{ invoked: t.wasInvoked(), assessCalls: setup.riskAssessmentService.assessCalls.length },
			{ invoked: false, assessCalls: 1 },
		);
	});

	test('autopilot risk gate surfaces an info note to the user when it skips a high-risk tool', async () => {
		const setup = createTestToolsService(store);
		setup.riskAssessmentService.enabled = true;
		setup.riskAssessmentService.assessment = { risk: ToolRiskLevel.Red, explanation: 'Deletes source files irreversibly.' };
		const t = setupRiskGateTool(setup, store);

		const progresses: IChatProgress[] = [];
		setup.chatService.appendProgress = (_request, progress) => { progresses.push(progress); };

		await t.invoke();

		const info = progresses.find((p): p is IChatInfoMessage => p.kind === 'info');
		assert.deepStrictEqual(
			{
				hasInfo: !!info,
				mentionsRisk: !!info && info.content.value.includes('Deletes source files irreversibly.'),
			},
			{ hasInfo: true, mentionsRisk: true },
		);
	});

	test('bypass approvals auto-approves terminal tool with confirmation messages', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', false);
			}
		});

		const tool = registerToolForTest(testService, store, 'terminalToolBypass', {
			prepareToolInvocation: async () => ({
				confirmationMessages: {
					title: 'Run shell command?',
					message: 'ls -la',
				},
				toolSpecificData: {
					kind: 'terminal' as const,
					terminalToolSessionId: 'test',
					terminalCommandId: 'cmd-2',
					commandLine: { original: 'ls -la' },
					language: 'sh',
				},
			}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'bypass executed' }] })
		});

		const sessionId = 'test-bypass-terminal';
		stubGetSession(testChatService, sessionId, {
			requestId: 'req1',
			modeInfo: { permissionLevel: ChatPermissionLevel.AutoApprove },
		});

		const result = await testService.invokeTool(
			tool.makeDto({ command: 'ls -la', explanation: 'test', goal: 'test', isBackground: false }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(result.content[0].value, 'bypass executed');
	});

	test('bypass approvals does not auto-approve tools in toolIdsThatCannotBeAutoApproved for CLI sessions', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', false);
			}
		});

		registerToolForTest(testService, store, 'vscode_get_modified_files_confirmation', {
			prepareToolInvocation: async () => ({
				confirmationMessages: {
					title: 'Uncommitted Changes',
					message: 'Should these changes be included?',
				},
			}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'confirmed' }] })
		});

		const sessionId = 'test-bypass-no-auto-confirm';
		const cliSessionResource = URI.from({
			scheme: LocalChatSessionUri.scheme,
			authority: 'copilotcli',
			path: '/' + sessionId
		});

		const capture: { invocation?: any } = {};
		const fakeModel = {
			sessionId,
			sessionResource: cliSessionResource,
			getRequests: () => [{ id: 'req1', modelId: 'test-model', modeInfo: { permissionLevel: ChatPermissionLevel.AutoApprove } }],
		} as ChatModel;
		testChatService.addSession(fakeModel);
		testChatService.appendProgress = (_request, progress) => {
			capture.invocation = progress;
		};

		const resultPromise = testService.invokeTool(
			{
				callId: '1',
				toolId: 'vscode_get_modified_files_confirmation',
				tokenBudget: 100,
				parameters: { test: true },
				context: { sessionResource: cliSessionResource },
			},
			async () => 0,
			CancellationToken.None
		);

		const published = await waitForPublishedInvocation(capture);
		assert.ok(published?.confirmationMessages, 'tool in toolIdsThatCannotBeAutoApproved should require confirmation for CLI sessions even with Bypass Approvals');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await resultPromise;
		assert.strictEqual(result.content[0].value, 'confirmed');
	});

	test('bypass approvals auto-approves tools in toolIdsThatCannotBeAutoApproved for local sessions', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', false);
			}
		});

		const tool = registerToolForTest(testService, store, 'vscode_get_modified_files_confirmation', {
			prepareToolInvocation: async () => ({
				confirmationMessages: {
					title: 'Uncommitted Changes',
					message: 'Should these changes be included?',
				},
			}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'auto approved for local' }] })
		});

		const sessionId = 'test-bypass-local-auto-confirm';
		stubGetSession(testChatService, sessionId, {
			requestId: 'req1',
			modeInfo: { permissionLevel: ChatPermissionLevel.AutoApprove },
		});

		const result = await testService.invokeTool(
			tool.makeDto({ test: true }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(result.content[0].value, 'auto approved for local');
	});

	test('shouldAutoConfirm with basic configuration', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', true);
			}
		});

		const autoTool = registerToolForTest(testService, store, 'autoTool', {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Test', message: 'Should auto-approve' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'auto approved' }] })
		});

		const sessionId = 'test-basic-config';
		stubGetSession(testChatService, sessionId, { requestId: 'req1' });


		const result = await testService.invokeTool(
			autoTool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(result.content[0].value, 'auto approved');
	});

	test('shouldAutoConfirm with per-tool configuration object', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', {
					'approvedTool': true,
					'deniedTool': false
				});
			}
		});

		const approvedTool = registerToolForTest(testService, store, 'approvedTool', {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Test', message: 'Should auto-approve' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'approved' }] })
		});

		const sessionId = 'test-per-tool';
		stubGetSession(testChatService, sessionId, { requestId: 'req1' });

		const approvedResult = await testService.invokeTool(
			approvedTool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(approvedResult.content[0].value, 'approved');

		const unspecifiedTool = registerToolForTest(testService, store, 'unspecifiedTool', {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Test', message: 'Should require confirmation' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'unspecified' }] })
		});

		const capture: { invocation?: any } = {};
		stubGetSession(testChatService, sessionId + '2', { requestId: 'req2', capture });
		const unspecifiedPromise = testService.invokeTool(
			unspecifiedTool.makeDto({ test: 2 }, { sessionId: sessionId + '2' }),
			async () => 0,
			CancellationToken.None
		);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published?.confirmationMessages, 'unspecified tool should require confirmation');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const unspecifiedResult = await unspecifiedPromise;
		assert.strictEqual(unspecifiedResult.content[0].value, 'unspecified');
	});

	test('eligibleForAutoApproval setting controls tool eligibility', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
					'eligibleToolRef': true,
					'ineligibleToolRef': false
				});
			}
		});

		const eligibleTool = registerToolForTest(testService, store, 'eligibleTool', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'eligible tool ran' }] })
		}, {
			toolReferenceName: 'eligibleToolRef'
		});

		const sessionId = 'test-eligible';
		stubGetSession(testChatService, sessionId, { requestId: 'req1' });

		const eligibleResult = await testService.invokeTool(
			eligibleTool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(eligibleResult.content[0].value, 'eligible tool ran');

		const ineligibleTool = registerToolForTest(testService, store, 'ineligibleTool', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'ineligible requires confirmation' }] })
		}, {
			toolReferenceName: 'ineligibleToolRef'
		});

		const capture: { invocation?: any } = {};
		stubGetSession(testChatService, sessionId + '2', { requestId: 'req2', capture });
		const ineligiblePromise = testService.invokeTool(
			ineligibleTool.makeDto({ test: 2 }, { sessionId: sessionId + '2' }),
			async () => 0,
			CancellationToken.None
		);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published?.confirmationMessages, 'ineligible tool should require confirmation');
		assert.ok(published?.confirmationMessages?.title, 'should have default confirmation title');
		assert.strictEqual(published?.confirmationMessages?.allowAutoConfirm, false, 'should not allow auto confirm');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const ineligibleResult = await ineligiblePromise;
		assert.strictEqual(ineligibleResult.content[0].value, 'ineligible requires confirmation');

		const unspecifiedTool = registerToolForTest(testService, store, 'unspecifiedTool', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'unspecified defaults to eligible' }] })
		}, {
			toolReferenceName: 'unspecifiedToolRef'
		});

		const unspecifiedResult = await testService.invokeTool(
			unspecifiedTool.makeDto({ test: 3 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(unspecifiedResult.content[0].value, 'unspecified defaults to eligible');
	});

	test('auto-approve policy restriction disables reusable actions while allowing approval once', async () => {
		const configurationService = new AutoApprovePolicyTestConfigurationService();
		const { service: testService, chatService: testChatService } = createTestToolsService(store, { configurationService });
		const tool = registerToolForTest(testService, store, 'policyRestrictedTool', {
			prepareToolInvocation: async () => ({
				confirmationMessages: {
					title: 'Confirm this action?',
					message: 'This tool requires confirmation',
					allowAutoConfirm: true,
				},
			}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'approved once' }] }),
		});
		const capture: { invocation?: any } = {};
		stubGetSession(testChatService, 'policy-restricted-session', { capture });

		const invocation = testService.invokeTool(
			tool.makeDto({}, { sessionId: 'policy-restricted-session' }),
			async () => 0,
			CancellationToken.None,
		);
		const published = await waitForPublishedInvocation(capture);
		assert.strictEqual(published.confirmationMessages?.allowAutoConfirm, false);

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		assert.deepStrictEqual(await invocation, { content: [{ kind: 'text', value: 'approved once' }] });
	});

	test('tool content formatting with alwaysDisplayInputOutput', async () => {
		const toolData: IToolData = {
			id: 'formatTool',
			modelDescription: 'Format Test Tool',
			displayName: 'Format Test Tool',
			source: ToolDataSource.Internal,
			alwaysDisplayInputOutput: true
		};

		const tool = registerToolForTest(service, store, toolData.id, {
			prepareToolInvocation: async () => ({}),
			invoke: async (invocation) => ({
				content: [
					{ kind: 'text', value: 'Text result' },
					{ kind: 'data', value: { data: VSBuffer.fromByteArray([1, 2, 3]), mimeType: 'application/octet-stream' } }
				]
			})
		}, toolData);

		const input = { a: 1, b: 'test', c: [1, 2, 3] };
		const result = await service.invokeTool(
			tool.makeDto(input),
			async () => 0,
			CancellationToken.None
		);

		assert.ok(result.toolResultDetails, 'should have toolResultDetails');
		const details = result.toolResultDetails;
		assert.ok(isToolResultInputOutputDetails(details));

		const expectedInputJson = JSON.stringify(input, undefined, 2);
		assert.strictEqual(details.input, expectedInputJson, 'input should be formatted JSON');

		assert.strictEqual(details.output.length, 2, 'should have 2 output items');

		const textOutput = details.output[0];
		assert.strictEqual(textOutput.type, 'embed');
		assert.strictEqual(textOutput.isText, true);
		assert.strictEqual(textOutput.value, 'Text result');

		const dataOutput = details.output[1];
		assert.strictEqual(dataOutput.type, 'embed');
		assert.strictEqual(dataOutput.mimeType, 'application/octet-stream');
		assert.strictEqual(dataOutput.value, 'AQID');
	});

	test('tool error handling and telemetry', async () => {
		const testTelemetryService = new TestTelemetryService();

		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			telemetryService: testTelemetryService
		});

		const successTool = registerToolForTest(testService, store, 'successTool', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'success' }] })
		});

		const sessionId = 'telemetry-test';
		stubGetSession(testChatService, sessionId, { requestId: 'req1' });

		await testService.invokeTool(
			successTool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);

		const successEvents = testTelemetryService.events.filter(e => e.eventName === 'languageModelToolInvoked');
		assert.strictEqual(successEvents.length, 1, 'should have success telemetry event');
		assert.strictEqual(successEvents[0].data.result, 'success');
		assert.strictEqual(successEvents[0].data.toolId, 'successTool');
		assert.strictEqual(successEvents[0].data.chatSessionId, sessionId);

		testTelemetryService.reset();

		const errorTool = registerToolForTest(testService, store, 'errorTool', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => { throw new Error('Tool error'); }
		});

		stubGetSession(testChatService, sessionId + '2', { requestId: 'req2' });

		try {
			await testService.invokeTool(
				errorTool.makeDto({ test: 2 }, { sessionId: sessionId + '2' }),
				async () => 0,
				CancellationToken.None
			);
			assert.fail('Should have thrown');
		} catch (err) {
		}

		const errorEvents = testTelemetryService.events.filter(e => e.eventName === 'languageModelToolInvoked');
		assert.strictEqual(errorEvents.length, 1, 'should have error telemetry event');
		assert.strictEqual(errorEvents[0].data.result, 'error');
		assert.strictEqual(errorEvents[0].data.toolId, 'errorTool');
	});

	test('call tracking and cleanup', async () => {
		const sessionId = 'tracking-session';
		const requestId = 'tracking-request';
		stubGetSession(chatService, sessionId, { requestId });

		assert.doesNotThrow(() => {
			service.cancelToolCallsForRequest(requestId);
		}, 'cancelToolCallsForRequest should not throw');

		assert.doesNotThrow(() => {
			service.cancelToolCallsForRequest('non-existent-request');
		}, 'cancelToolCallsForRequest with non-existent ID should not throw');
	});

	test('accessibility signal with different settings combinations', async () => {
		const testAccessibilitySignalService = new TestAccessibilitySignalService();

		const testConfigService1 = new TestConfigurationService();
		testConfigService1.setUserConfiguration('chat.tools.global.autoApprove', false);
		testConfigService1.setUserConfiguration('accessibility.signals.chatUserActionRequired', { sound: 'on', announcement: 'off' });

		const testAccessibilityService1 = new class extends TestAccessibilityService {
			override isScreenReaderOptimized(): boolean { return false; }
		}();

		const instaService1 = workbenchInstantiationService({
			contextKeyService: () => store.add(new ContextKeyService(testConfigService1)),
			configurationService: () => testConfigService1
		}, store);
		instaService1.stub(IChatService, chatService);
		instaService1.stub(IAccessibilityService, testAccessibilityService1);
		instaService1.stub(IAccessibilitySignalService, testAccessibilitySignalService as unknown as IAccessibilitySignalService);
		instaService1.stub(ILanguageModelToolsConfirmationService, new MockLanguageModelToolsConfirmationService());
		instaService1.stub(IToolResultCompressor, noopToolResultCompressor);
		const testService1 = store.add(instaService1.createInstance(LanguageModelToolsService));

		const tool1 = registerToolForTest(testService1, store, 'soundOnlyTool', {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Sound Test', message: 'Testing sound only' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'executed' }] })
		});

		const sessionId1 = 'sound-test';
		const capture1: { invocation?: any } = {};
		stubGetSession(chatService, sessionId1, { requestId: 'req1', capture: capture1 });

		const promise1 = testService1.invokeTool(tool1.makeDto({ test: 1 }, { sessionId: sessionId1 }), async () => 0, CancellationToken.None);
		const published1 = await waitForPublishedInvocation(capture1);

		assert.strictEqual(testAccessibilitySignalService.signalPlayedCalls.length, 1, 'sound should be played when sound=on');
		const call1 = testAccessibilitySignalService.signalPlayedCalls[0];
		assert.strictEqual(call1.options?.modality, undefined, 'should use default modality for sound');

		IChatToolInvocation.confirmWith(published1, { type: ToolConfirmKind.UserAction });
		await promise1;

		testAccessibilitySignalService.reset();

		const testConfigService2 = new TestConfigurationService();
		testConfigService2.setUserConfiguration('chat.tools.global.autoApprove', false);
		testConfigService2.setUserConfiguration('accessibility.signals.chatUserActionRequired', { sound: 'auto', announcement: 'auto' });

		const testAccessibilityService2 = new class extends TestAccessibilityService {
			override isScreenReaderOptimized(): boolean { return true; }
		}();

		const instaService2 = workbenchInstantiationService({
			contextKeyService: () => store.add(new ContextKeyService(testConfigService2)),
			configurationService: () => testConfigService2
		}, store);
		instaService2.stub(IChatService, chatService);
		instaService2.stub(IAccessibilityService, testAccessibilityService2);
		instaService2.stub(IAccessibilitySignalService, testAccessibilitySignalService as unknown as IAccessibilitySignalService);
		instaService2.stub(ILanguageModelToolsConfirmationService, new MockLanguageModelToolsConfirmationService());
		instaService2.stub(IToolResultCompressor, noopToolResultCompressor);
		const testService2 = store.add(instaService2.createInstance(LanguageModelToolsService));

		const tool2 = registerToolForTest(testService2, store, 'autoScreenReaderTool', {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Auto Test', message: 'Testing auto with screen reader' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'executed' }] })
		});

		const sessionId2 = 'auto-sr-test';
		const capture2: { invocation?: any } = {};
		stubGetSession(chatService, sessionId2, { requestId: 'req2', capture: capture2 });

		const promise2 = testService2.invokeTool(tool2.makeDto({ test: 2 }, { sessionId: sessionId2 }), async () => 0, CancellationToken.None);
		const published2 = await waitForPublishedInvocation(capture2);

		assert.strictEqual(testAccessibilitySignalService.signalPlayedCalls.length, 1, 'signal should be played with screen reader optimization');
		const call2 = testAccessibilitySignalService.signalPlayedCalls[0];
		assert.ok(call2.options?.customAlertMessage, 'should have custom alert message');
		assert.strictEqual(call2.options?.userGesture, true, 'should mark as user gesture');

		IChatToolInvocation.confirmWith(published2, { type: ToolConfirmKind.UserAction });
		await promise2;

		testAccessibilitySignalService.reset();

		const testConfigService3 = new TestConfigurationService();
		testConfigService3.setUserConfiguration('chat.tools.global.autoApprove', false);
		testConfigService3.setUserConfiguration('accessibility.signals.chatUserActionRequired', { sound: 'off', announcement: 'off' });

		const testAccessibilityService3 = new class extends TestAccessibilityService {
			override isScreenReaderOptimized(): boolean { return true; }
		}();

		const instaService3 = workbenchInstantiationService({
			contextKeyService: () => store.add(new ContextKeyService(testConfigService3)),
			configurationService: () => testConfigService3
		}, store);
		instaService3.stub(IChatService, chatService);
		instaService3.stub(IAccessibilityService, testAccessibilityService3);
		instaService3.stub(IAccessibilitySignalService, testAccessibilitySignalService as unknown as IAccessibilitySignalService);
		instaService3.stub(ILanguageModelToolsConfirmationService, new MockLanguageModelToolsConfirmationService());
		instaService3.stub(IToolResultCompressor, noopToolResultCompressor);
		const testService3 = store.add(instaService3.createInstance(LanguageModelToolsService));

		const tool3 = registerToolForTest(testService3, store, 'offTool', {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Off Test', message: 'Testing off settings' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'executed' }] })
		});

		const sessionId3 = 'off-test';
		const capture3: { invocation?: any } = {};
		stubGetSession(chatService, sessionId3, { requestId: 'req3', capture: capture3 });

		const promise3 = testService3.invokeTool(tool3.makeDto({ test: 3 }, { sessionId: sessionId3 }), async () => 0, CancellationToken.None);
		const published3 = await waitForPublishedInvocation(capture3);

		assert.strictEqual(testAccessibilitySignalService.signalPlayedCalls.length, 0, 'no signal should be played when both sound and announcement are off');

		IChatToolInvocation.confirmWith(published3, { type: ToolConfirmKind.UserAction });
		await promise3;
	});

	test('createToolSet and getToolSet', () => {
		const toolSet = store.add(service.createToolSet(
			ToolDataSource.Internal,
			'testToolSetId',
			'testToolSetName',
			{ icon: undefined, description: 'Test tool set' }
		));

		const retrieved = service.getToolSet('testToolSetId');
		assert.ok(retrieved);
		assert.strictEqual(retrieved.id, 'testToolSetId');
		assert.strictEqual(retrieved.referenceName, 'testToolSetName');

		assert.strictEqual(service.getToolSet('nonExistentId'), undefined);

		toolSet.dispose();
		assert.strictEqual(service.getToolSet('testToolSetId'), undefined);
	});

	test('getToolSetByName', () => {
		store.add(service.createToolSet(
			ToolDataSource.Internal,
			'toolSet1',
			'refName1'
		));

		store.add(service.createToolSet(
			ToolDataSource.Internal,
			'toolSet2',
			'refName2'
		));

		assert.strictEqual(service.getToolSetByName('refName1')?.id, 'toolSet1');
		assert.strictEqual(service.getToolSetByName('refName2')?.id, 'toolSet2');

		assert.strictEqual(service.getToolSetByName('nonExistentName'), undefined);
	});

	test('getTools with includeDisabled parameter', () => {
		contextKeyService.createKey('testKey', false);
		const disabledTool: IToolData = {
			id: 'disabledTool',
			modelDescription: 'Disabled Tool',
			displayName: 'Disabled Tool',
			source: ToolDataSource.Internal,
			when: ContextKeyEqualsExpr.create('testKey', true),
		};

		const enabledTool: IToolData = {
			id: 'enabledTool',
			modelDescription: 'Enabled Tool',
			displayName: 'Enabled Tool',
			source: ToolDataSource.Internal,
		};

		store.add(service.registerToolData(disabledTool));
		store.add(service.registerToolData(enabledTool));

		const enabledTools = Array.from(service.getTools(undefined));
		assert.strictEqual(enabledTools.length, 1, 'Should only return enabled tools');
		assert.strictEqual(enabledTools[0].id, 'enabledTool');

		const allTools = Array.from(service.getAllToolsIncludingDisabled());
		assert.strictEqual(allTools.length, 2, 'getAllToolsIncludingDisabled should return all tools');
	});

	test('tool registration duplicate error', () => {
		const toolData: IToolData = {
			id: 'duplicateTool',
			modelDescription: 'Duplicate Tool',
			displayName: 'Duplicate Tool',
			source: ToolDataSource.Internal,
		};

		store.add(service.registerToolData(toolData));

		assert.throws(() => {
			service.registerToolData(toolData);
		}, /Tool "duplicateTool" is already registered/);
	});

	test('tool implementation registration without data throws', () => {
		const toolImpl: IToolImpl = {
			invoke: async () => ({ content: [] }),
		};

		assert.throws(() => {
			service.registerToolImplementation('nonExistentTool', toolImpl);
		}, /Tool "nonExistentTool" was not contributed/);
	});

	test('tool implementation duplicate registration throws', () => {
		const toolData: IToolData = {
			id: 'testTool',
			modelDescription: 'Test Tool',
			displayName: 'Test Tool',
			source: ToolDataSource.Internal,
		};

		const toolImpl1: IToolImpl = {
			invoke: async () => ({ content: [] }),
		};

		const toolImpl2: IToolImpl = {
			invoke: async () => ({ content: [] }),
		};

		store.add(service.registerToolData(toolData));
		store.add(service.registerToolImplementation('testTool', toolImpl1));

		assert.throws(() => {
			service.registerToolImplementation('testTool', toolImpl2);
		}, /Tool "testTool" already has an implementation/);
	});

	test('invokeTool with unknown tool throws', async () => {
		const dto: IToolInvocation = {
			callId: '1',
			toolId: 'unknownTool',
			tokenBudget: 100,
			parameters: {},
			context: undefined,
		};

		await assert.rejects(
			service.invokeTool(dto, async () => 0, CancellationToken.None),
			/Tool unknownTool was not contributed/
		);
	});

	test('invokeTool without implementation activates extension and throws if still not found', async () => {
		const toolData: IToolData = {
			id: 'extensionActivationTool',
			modelDescription: 'Extension Tool',
			displayName: 'Extension Tool',
			source: ToolDataSource.Internal,
		};

		store.add(service.registerToolData(toolData));

		const dto: IToolInvocation = {
			callId: '1',
			toolId: 'extensionActivationTool',
			tokenBudget: 100,
			parameters: {},
			context: undefined,
		};

		await assert.rejects(
			service.invokeTool(dto, async () => 0, CancellationToken.None),
			/Tool extensionActivationTool does not have an implementation registered/
		);
	});

	test('invokeTool without context (non-chat scenario)', async () => {
		const tool = registerToolForTest(service, store, 'nonChatTool', {
			invoke: async (invocation) => {
				assert.strictEqual(invocation.context, undefined);
				return { content: [{ kind: 'text', value: 'non-chat result' }] };
			}
		});

		const dto = tool.makeDto({ test: 1 });

		const result = await service.invokeTool(dto, async () => 0, CancellationToken.None);
		assert.strictEqual(result.content[0].value, 'non-chat result');
	});

	test('invokeTool with unknown chat session throws', async () => {
		const tool = registerToolForTest(service, store, 'unknownSessionTool', {
			invoke: async () => ({ content: [{ kind: 'text', value: 'should not reach' }] })
		});

		const dto = tool.makeDto({ test: 1 }, { sessionId: 'unknownSession' });

		let threwError = false;
		try {
			await service.invokeTool(dto, async () => 0, CancellationToken.None);
		} catch (err) {
			threwError = true;
			assert.ok(
				err instanceof Error && (
					err.message.includes('Tool called for unknown chat session') ||
					err.message.includes('getRequests is not a function')
				),
				`Unexpected error: ${err.message}`
			);
		}
		assert.strictEqual(threwError, true, 'Should have thrown an error');
	});

	test('tool error with alwaysDisplayInputOutput includes details', async () => {
		const toolData: IToolData = {
			id: 'errorToolWithIO',
			modelDescription: 'Error Tool With IO',
			displayName: 'Error Tool With IO',
			source: ToolDataSource.Internal,
			alwaysDisplayInputOutput: true
		};

		const tool = registerToolForTest(service, store, toolData.id, {
			invoke: async () => { throw new Error('Tool execution failed'); }
		}, toolData);

		const input = { param: 'testValue' };

		try {
			await service.invokeTool(
				tool.makeDto(input),
				async () => 0,
				CancellationToken.None
			);
			assert.fail('Should have thrown');
		} catch (err: any) {
			assert.strictEqual(err.message, 'Tool execution failed');
		}
	});

	test('context key changes trigger tool updates', async () => {
		let changeEventFired = false;
		const disposable = service.onDidChangeTools(() => {
			changeEventFired = true;
		});
		store.add(disposable);

		contextKeyService.createKey('dynamicKey', false);
		const toolData: IToolData = {
			id: 'contextTool',
			modelDescription: 'Context Tool',
			displayName: 'Context Tool',
			source: ToolDataSource.Internal,
			when: ContextKeyEqualsExpr.create('dynamicKey', true),
		};

		store.add(service.registerToolData(toolData));

		contextKeyService.createKey('dynamicKey', true);

		service.flushToolUpdates();

		assert.strictEqual(changeEventFired, true, 'onDidChangeTools should fire when context keys change');
	});

	test('configuration changes trigger tool updates', async () => {
		let changeEventFired = false;
		const disposable = service.onDidChangeTools(() => {
			changeEventFired = true;
		});
		store.add(disposable);

		configurationService.setUserConfiguration('chat.extensionTools.enabled', false);
		configurationService.onDidChangeConfigurationEmitter.fire({
			affectsConfiguration: () => true,
			affectedKeys: new Set(['chat.extensionTools.enabled']),
			change: null!,
			source: ConfigurationTarget.USER
		} satisfies IConfigurationChangeEvent);

		service.flushToolUpdates();

		assert.strictEqual(changeEventFired, true, 'onDidChangeTools should fire when configuration changes');
	});

	test('toToolAndToolSetEnablementMap with MCP toolset enables contained tools', () => {
		const mcpToolSet = store.add(service.createToolSet(
			{ type: 'mcp', label: 'testServer', serverLabel: 'testServer', instructions: undefined, collectionId: 'testCollection', definitionId: 'testDef' },
			'mcpSet',
			'mcpSetRef'
		));

		const mcpTool: IToolData = {
			id: 'mcpTool',
			modelDescription: 'MCP Tool',
			displayName: 'MCP Tool',
			source: { type: 'mcp', label: 'testServer', serverLabel: 'testServer', instructions: undefined, collectionId: 'testCollection', definitionId: 'testDef' },
			canBeReferencedInPrompt: true,
			toolReferenceName: 'mcpToolRef'
		};

		store.add(service.registerToolData(mcpTool));
		store.add(mcpToolSet.addTool(mcpTool));

		{
			const enabledNames = [mcpToolSet].map(t => service.getFullReferenceName(t));
			const result = service.toToolAndToolSetEnablementMap(enabledNames, undefined);

			assert.strictEqual(result.get(mcpToolSet), true, 'MCP toolset should be enabled');
			assert.strictEqual(result.get(mcpTool), true, 'MCP tool should be enabled when its toolset is enabled');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames.sort(), enabledNames.sort(), 'toFullReferenceNames should return the original enabled names');
		}
		{
			const enabledNames = [mcpTool].map(t => service.getFullReferenceName(t, mcpToolSet));
			const result = service.toToolAndToolSetEnablementMap(enabledNames, undefined);

			assert.strictEqual(result.get(mcpToolSet), false, 'MCP toolset should be disabled');
			assert.strictEqual(result.get(mcpTool), true, 'MCP tool should be enabled');

			const fullReferenceNames = service.toFullReferenceNames(result);
			assert.deepStrictEqual(fullReferenceNames.sort(), enabledNames.sort(), 'toFullReferenceNames should return the original enabled names');
		}

	});

	test('shouldAutoConfirm with workspace-specific tool configuration', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration('chat.tools.global.autoApprove', { 'workspaceTool': true });
			}
		});

		const workspaceTool = registerToolForTest(testService, store, 'workspaceTool', {
			prepareToolInvocation: async () => ({ confirmationMessages: { title: 'Test', message: 'Workspace tool' } }),
			invoke: async () => ({ content: [{ kind: 'text', value: 'workspace result' }] })
		}, { runsInWorkspace: true });

		const sessionId = 'workspace-test';
		stubGetSession(testChatService, sessionId, { requestId: 'req1' });

		const result = await testService.invokeTool(
			workspaceTool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(result.content[0].value, 'workspace result');
	});

	test('getFullReferenceNames', () => {
		setupToolsForTest(service, store);

		const fullReferenceNames = Array.from(service.getFullReferenceNames()).sort();

		const expectedNames = [
			'tool1RefName',
			'Tool2 Display Name',
			'my.extension/extTool1RefName',
			'mcpToolSetRefName/*',
			'mcpToolSetRefName/mcpTool1RefName',
			'internalToolSetRefName',
			'internalToolSetRefName/internalToolSetTool1RefName',
			'vscode',
			'execute',
			'read',
			'agent'
		].sort();

		assert.deepStrictEqual(fullReferenceNames, expectedNames, 'getFullReferenceNames should return correct full reference names');
	});

	test('getDeprecatedFullReferenceNames', () => {
		setupToolsForTest(service, store);

		const deprecatedNames = service.getDeprecatedFullReferenceNames();

		assert.deepStrictEqual(deprecatedNames.get('internalToolSetTool1RefName'), new Set(['internalToolSetRefName/internalToolSetTool1RefName']));
		assert.strictEqual(deprecatedNames.get('internalToolSetRefName'), undefined);

		assert.deepStrictEqual(deprecatedNames.get('extTool1RefName'), new Set(['my.extension/extTool1RefName']));

		assert.deepStrictEqual(deprecatedNames.get('mcpToolSetRefName'), new Set(['mcpToolSetRefName/*']));
		assert.deepStrictEqual(deprecatedNames.get('mcpTool1RefName'), new Set(['mcpToolSetRefName/mcpTool1RefName']));

		assert.strictEqual(deprecatedNames.get('Tool2 Display Name'), undefined);
		assert.strictEqual(deprecatedNames.get('tool1RefName'), undefined);
		assert.strictEqual(deprecatedNames.get('userToolSetRefName'), undefined);
	});

	test('getDeprecatedFullReferenceNames includes namespaced legacy names for tools in toolsets', () => {
		const toolWithLegacy: IToolData = {
			id: 'myNewBrowser',
			toolReferenceName: 'openIntegratedBrowser',
			legacyToolReferenceFullNames: ['openSimpleBrowser'],
			modelDescription: 'Open browser',
			displayName: 'Open Integrated Browser',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
		};
		store.add(service.registerToolData(toolWithLegacy));
		store.add(service.vscodeToolSet.addTool(toolWithLegacy));

		const deprecated = service.getDeprecatedFullReferenceNames();

		assert.deepStrictEqual(deprecated.get('openSimpleBrowser'), new Set(['vscode/openIntegratedBrowser']));

		assert.deepStrictEqual(deprecated.get('vscode/openSimpleBrowser'), new Set(['vscode/openIntegratedBrowser']));
	});

	test('getToolByFullReferenceName', () => {
		setupToolsForTest(service, store);

		const tool1 = service.getToolByFullReferenceName('tool1RefName');
		assert.ok(tool1);
		assert.strictEqual(tool1.id, 'tool1');

		const tool2 = service.getToolByFullReferenceName('Tool2 Display Name');
		assert.ok(tool2);
		assert.strictEqual(tool2.id, 'tool2');

		const extTool = service.getToolByFullReferenceName('my.extension/extTool1RefName');
		assert.ok(extTool);
		assert.strictEqual(extTool.id, 'extTool1');

		const mcpTool = service.getToolByFullReferenceName('mcpToolSetRefName/mcpTool1RefName');
		assert.ok(mcpTool);
		assert.strictEqual(mcpTool.id, 'mcpTool1');


		const mcpToolSet = service.getToolByFullReferenceName('mcpToolSetRefName/*');
		assert.ok(mcpToolSet);
		assert.strictEqual(mcpToolSet.id, 'mcpToolSet');

		const internalToolSet = service.getToolByFullReferenceName('internalToolSetRefName/internalToolSetTool1RefName');
		assert.ok(internalToolSet);
		assert.strictEqual(internalToolSet.id, 'internalToolSetTool1');

		const toolInSet = service.getToolByFullReferenceName('internalToolSetRefName');
		assert.ok(toolInSet);
		assert.strictEqual(toolInSet!.id, 'internalToolSet');

	});

	test('eligibleForAutoApproval setting can be configured via policy', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
					'toolA': true,
					'toolB': false
				});
			}
		});

		const toolA = registerToolForTest(testService, store, 'toolA', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'toolA executed' }] })
		}, {
			toolReferenceName: 'toolA'
		});

		const toolB = registerToolForTest(testService, store, 'toolB', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'toolB executed' }] })
		}, {
			toolReferenceName: 'toolB'
		});

		const sessionId = 'test-policy';
		stubGetSession(testChatService, sessionId, { requestId: 'req1' });

		const resultA = await testService.invokeTool(
			toolA.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(resultA.content[0].value, 'toolA executed');

		const capture: { invocation?: any } = {};
		stubGetSession(testChatService, sessionId + '2', { requestId: 'req2', capture });
		const promiseB = testService.invokeTool(
			toolB.makeDto({ test: 2 }, { sessionId: sessionId + '2' }),
			async () => 0,
			CancellationToken.None
		);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published?.confirmationMessages, 'toolB should require confirmation due to policy');
		assert.strictEqual(published?.confirmationMessages?.allowAutoConfirm, false, 'should not allow auto confirm');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const resultB = await promiseB;
		assert.strictEqual(resultB.content[0].value, 'toolB executed');
	});

	test('eligibleForAutoApproval with legacy tool reference names - eligible', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
					'oldToolName': true
				});
			}
		});

		const renamedTool = registerToolForTest(testService, store, 'renamedTool', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'tool executed via legacy name' }] })
		}, {
			toolReferenceName: 'newToolName',
			legacyToolReferenceFullNames: ['oldToolName']
		});

		const sessionId = 'test-legacy-eligible';
		stubGetSession(testChatService, sessionId, { requestId: 'req1' });

		const result = await testService.invokeTool(
			renamedTool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(result.content[0].value, 'tool executed via legacy name');
	});

	test('eligibleForAutoApproval with legacy tool reference names - ineligible', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
					'deprecatedToolName': false
				});
			}
		});

		const renamedTool = registerToolForTest(testService, store, 'renamedTool2', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'tool requires confirmation' }] })
		}, {
			toolReferenceName: 'modernToolName',
			legacyToolReferenceFullNames: ['deprecatedToolName']
		});

		const sessionId = 'test-legacy-ineligible';
		const capture: { invocation?: any } = {};
		stubGetSession(testChatService, sessionId, { requestId: 'req1', capture });

		const promise = testService.invokeTool(
			renamedTool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published?.confirmationMessages, 'tool should require confirmation when legacy name is ineligible');
		assert.strictEqual(published?.confirmationMessages?.allowAutoConfirm, false, 'should not allow auto confirm');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await promise;
		assert.strictEqual(result.content[0].value, 'tool requires confirmation');
	});

	test('eligibleForAutoApproval with multiple legacy names', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
					'secondLegacyName': true
				});
			}
		});

		const multiLegacyTool = registerToolForTest(testService, store, 'multiLegacyTool', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'multi legacy executed' }] })
		}, {
			toolReferenceName: 'currentToolName',
			legacyToolReferenceFullNames: ['firstLegacyName', 'secondLegacyName', 'thirdLegacyName']
		});

		const sessionId = 'test-multi-legacy';
		stubGetSession(testChatService, sessionId, { requestId: 'req1' });

		const result = await testService.invokeTool(
			multiLegacyTool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(result.content[0].value, 'multi legacy executed');
	});

	test('eligibleForAutoApproval current name takes precedence over legacy names', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
					'currentName': false,
					'oldName': true
				});
			}
		});

		const tool = registerToolForTest(testService, store, 'precedenceTool', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'precedence test' }] })
		}, {
			toolReferenceName: 'currentName',
			legacyToolReferenceFullNames: ['oldName']
		});

		const sessionId = 'test-precedence';
		const capture: { invocation?: any } = {};
		stubGetSession(testChatService, sessionId, { requestId: 'req1', capture });

		const promise = testService.invokeTool(
			tool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published?.confirmationMessages, 'current name should take precedence over legacy name');
		assert.strictEqual(published?.confirmationMessages?.allowAutoConfirm, false, 'should not allow auto confirm');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await promise;
		assert.strictEqual(result.content[0].value, 'precedence test');
	});

	test('eligibleForAutoApproval with legacy full reference names from toolsets', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
					'oldToolSet/oldToolName': false
				});
			}
		});

		const migratedTool = registerToolForTest(testService, store, 'migratedTool', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'migrated tool' }] })
		}, {
			toolReferenceName: 'standaloneToolName',
			legacyToolReferenceFullNames: ['oldToolSet/oldToolName']
		});

		const sessionId = 'test-fullReferenceName-legacy';
		const capture: { invocation?: any } = {};
		stubGetSession(testChatService, sessionId, { requestId: 'req1', capture });

		const promise = testService.invokeTool(
			migratedTool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published?.confirmationMessages, 'tool should be ineligible via legacy full reference name');
		assert.strictEqual(published?.confirmationMessages?.allowAutoConfirm, false, 'should not allow auto confirm');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await promise;
		assert.strictEqual(result.content[0].value, 'migrated tool');
	});

	test('eligibleForAutoApproval mixed current and legacy names', async () => {
		const { service: testService, chatService: testChatService } = createTestToolsService(store, {
			configureServices: config => {
				config.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
					'modernTool': true,
					'legacyToolOld': false,
					'unchangedTool': true
				});
			}
		});

		const tool1 = registerToolForTest(testService, store, 'tool1', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'modern executed' }] })
		}, {
			toolReferenceName: 'modernTool'
		});

		const tool2 = registerToolForTest(testService, store, 'tool2', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'legacy needs confirmation' }] })
		}, {
			toolReferenceName: 'legacyToolNew',
			legacyToolReferenceFullNames: ['legacyToolOld']
		});

		const tool3 = registerToolForTest(testService, store, 'tool3', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'unchanged executed' }] })
		}, {
			toolReferenceName: 'unchangedTool'
		});

		const sessionId = 'test-mixed';
		stubGetSession(testChatService, sessionId, { requestId: 'req1' });

		const result1 = await testService.invokeTool(
			tool1.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(result1.content[0].value, 'modern executed');

		const capture2: { invocation?: any } = {};
		stubGetSession(testChatService, sessionId + '2', { requestId: 'req2', capture: capture2 });
		const promise2 = testService.invokeTool(
			tool2.makeDto({ test: 2 }, { sessionId: sessionId + '2' }),
			async () => 0,
			CancellationToken.None
		);
		const published2 = await waitForPublishedInvocation(capture2);
		assert.ok(published2?.confirmationMessages, 'tool2 should require confirmation via legacy name');

		IChatToolInvocation.confirmWith(published2, { type: ToolConfirmKind.UserAction });
		const result2 = await promise2;
		assert.strictEqual(result2.content[0].value, 'legacy needs confirmation');

		const result3 = await testService.invokeTool(
			tool3.makeDto({ test: 3 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		assert.strictEqual(result3.content[0].value, 'unchanged executed');
	});

	test('eligibleForAutoApproval with namespaced legacy names - full tool name eligible', async () => {
		const testConfigService = new TestConfigurationService();
		testConfigService.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
			'gitTools/gitCommit': true
		});

		const instaService = workbenchInstantiationService({
			contextKeyService: () => store.add(new ContextKeyService(testConfigService)),
			configurationService: () => testConfigService
		}, store);
		instaService.stub(IChatService, chatService);
		instaService.stub(ILanguageModelToolsConfirmationService, new MockLanguageModelToolsConfirmationService());
		instaService.stub(IToolResultCompressor, noopToolResultCompressor);
		const testService = store.add(instaService.createInstance(LanguageModelToolsService));

		const tool = registerToolForTest(testService, store, 'gitCommitTool', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'commit executed' }] })
		}, {
			toolReferenceName: 'commit',
			legacyToolReferenceFullNames: ['gitTools/gitCommit']
		});

		const sessionId = 'test-extension-prefix';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'req1' });

		const result = await testService.invokeTool(
			tool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);

		const published = await waitForPublishedInvocation(capture);
		assert.strictEqual(published, undefined, 'tool should not require confirmation when legacy trimmed name is eligible');
		assert.strictEqual(result.content[0].value, 'commit executed');
	});

	test('eligibleForAutoApproval with namespaced and renamed toolname - just last segment eligible', async () => {
		const testConfigService = new TestConfigurationService();
		testConfigService.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
			'gitCommit': true
		});

		const instaService = workbenchInstantiationService({
			contextKeyService: () => store.add(new ContextKeyService(testConfigService)),
			configurationService: () => testConfigService
		}, store);
		instaService.stub(IChatService, chatService);
		instaService.stub(ILanguageModelToolsConfirmationService, new MockLanguageModelToolsConfirmationService());
		instaService.stub(IToolResultCompressor, noopToolResultCompressor);
		const testService = store.add(instaService.createInstance(LanguageModelToolsService));

		const tool = registerToolForTest(testService, store, 'gitCommitTool2', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'commit executed' }] })
		}, {
			toolReferenceName: 'commit',
			legacyToolReferenceFullNames: ['gitTools/gitCommit']
		});

		const sessionId = 'test-renamed-prefix';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'req1' });

		const result = await testService.invokeTool(
			tool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);

		const published = await waitForPublishedInvocation(capture);
		assert.strictEqual(published, undefined, 'tool should not require confirmation when legacy trimmed name is eligible');
		assert.strictEqual(result.content[0].value, 'commit executed');
	});

	test('eligibleForAutoApproval with namespaced legacy names - full tool name ineligible', async () => {
		const testConfigService = new TestConfigurationService();
		testConfigService.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
			'gitTools/gitCommit': false
		});

		const instaService = workbenchInstantiationService({
			contextKeyService: () => store.add(new ContextKeyService(testConfigService)),
			configurationService: () => testConfigService
		}, store);
		instaService.stub(IChatService, chatService);
		instaService.stub(ILanguageModelToolsConfirmationService, new MockLanguageModelToolsConfirmationService());
		instaService.stub(IToolResultCompressor, noopToolResultCompressor);
		const testService = store.add(instaService.createInstance(LanguageModelToolsService));

		const tool = registerToolForTest(testService, store, 'gitCommitTool3', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'commit blocked' }] })
		}, {
			toolReferenceName: 'commit',
			legacyToolReferenceFullNames: ['something/random', 'gitTools/bar', 'gitTools/gitCommit']
		});

		const sessionId = 'test-extension-prefix-blocked';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'req1', capture });

		const promise = testService.invokeTool(
			tool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published?.confirmationMessages, 'tool should require confirmation when legacy full name is ineligible');
		assert.strictEqual(published?.confirmationMessages?.allowAutoConfirm, false, 'should not allow auto confirm');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await promise;
		assert.strictEqual(result.content[0].value, 'commit blocked');
	});

	test('eligibleForAutoApproval with namespaced and renamed toolname - just last segment ineligible', async () => {
		const testConfigService = new TestConfigurationService();
		testConfigService.setUserConfiguration(ChatConfiguration.EligibleForAutoApproval, {
			'gitCommit': false
		});

		const instaService = workbenchInstantiationService({
			contextKeyService: () => store.add(new ContextKeyService(testConfigService)),
			configurationService: () => testConfigService
		}, store);
		instaService.stub(IChatService, chatService);
		instaService.stub(ILanguageModelToolsConfirmationService, new MockLanguageModelToolsConfirmationService());
		instaService.stub(IToolResultCompressor, noopToolResultCompressor);
		const testService = store.add(instaService.createInstance(LanguageModelToolsService));

		const tool = registerToolForTest(testService, store, 'gitCommitTool4', {
			prepareToolInvocation: async () => ({}),
			invoke: async () => ({ content: [{ kind: 'text', value: 'commit blocked' }] })
		}, {
			toolReferenceName: 'commit',
			legacyToolReferenceFullNames: ['something/random', 'gitTools/bar', 'gitTools/gitCommit']
		});

		const sessionId = 'test-renamed-prefix-blocked';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId: 'req1', capture });

		const promise = testService.invokeTool(
			tool.makeDto({ test: 1 }, { sessionId }),
			async () => 0,
			CancellationToken.None
		);
		const published = await waitForPublishedInvocation(capture);
		assert.ok(published?.confirmationMessages, 'tool should require confirmation when legacy trimmed name is ineligible');
		assert.strictEqual(published?.confirmationMessages?.allowAutoConfirm, false, 'should not allow auto confirm');

		IChatToolInvocation.confirmWith(published, { type: ToolConfirmKind.UserAction });
		const result = await promise;
		assert.strictEqual(result.content[0].value, 'commit blocked');
	});

	test('beginToolCall creates streaming tool invocation', () => {
		const tool = registerToolForTest(service, store, 'streamingTool', {
			invoke: async () => ({ content: [{ kind: 'text', value: 'result' }] }),
			handleToolStream: async () => ({ invocationMessage: 'Processing...' }),
		});

		const sessionId = 'streaming-session';
		const requestId = 'streaming-request';
		stubGetSession(chatService, sessionId, { requestId });

		const invocation = service.beginToolCall({
			toolCallId: 'call-123',
			toolId: tool.id,
			chatRequestId: requestId,
			sessionResource: LocalChatSessionUri.forSession(sessionId),
		});

		assert.ok(invocation, 'beginToolCall should return an invocation');
		assert.strictEqual(invocation.toolId, tool.id);
	});

	test('beginToolCall returns undefined for unknown tool', () => {
		const invocation = service.beginToolCall({
			toolCallId: 'call-unknown',
			toolId: 'nonExistentTool',
		});

		assert.strictEqual(invocation, undefined, 'beginToolCall should return undefined for unknown tools');
	});

	test('beginToolCall returns undefined for tool without handleToolStream', () => {
		const tool = registerToolForTest(service, store, 'noStreamTool', {
			invoke: async () => ({ content: [{ kind: 'text', value: 'result' }] }),
		});

		const invocation = service.beginToolCall({
			toolCallId: 'call-no-stream',
			toolId: tool.id,
		});

		assert.strictEqual(invocation, undefined, 'beginToolCall should return undefined when tool lacks handleToolStream');
	});

	test('beginToolCall with force creates invocation even without handleToolStream', () => {
		const tool = registerToolForTest(service, store, 'forceStreamTool', {
			invoke: async () => ({ content: [{ kind: 'text', value: 'result' }] }),
		});

		const invocation = service.beginToolCall({
			toolCallId: 'call-force',
			toolId: tool.id,
			force: true,
		});

		assert.ok(invocation, 'beginToolCall with force should return an invocation');
		assert.strictEqual(invocation.toolId, tool.id);
	});

	test('updateToolStream calls handleToolStream on tool implementation', async () => {
		let handleToolStreamCalled = false;
		let receivedRawInput: unknown;

		const tool = registerToolForTest(service, store, 'streamHandlerTool', {
			invoke: async () => ({ content: [{ kind: 'text', value: 'result' }] }),
			handleToolStream: async (context) => {
				handleToolStreamCalled = true;
				receivedRawInput = context.rawInput;
				return { invocationMessage: 'Processing...' };
			},
		});

		const sessionId = 'stream-handler-session';
		const requestId = 'stream-handler-request';
		stubGetSession(chatService, sessionId, { requestId });

		const invocation = service.beginToolCall({
			toolCallId: 'call-stream',
			toolId: tool.id,
			chatRequestId: requestId,
			sessionResource: LocalChatSessionUri.forSession(sessionId),
		});

		assert.ok(invocation, 'should create invocation');

		const partialInput = { partial: 'data' };
		await service.updateToolStream('call-stream', partialInput, CancellationToken.None);

		assert.strictEqual(handleToolStreamCalled, true, 'handleToolStream should be called');
		assert.deepStrictEqual(receivedRawInput, partialInput, 'should receive the partial input');
	});

	test('updateToolStream does nothing for unknown tool call', async () => {
		await service.updateToolStream('unknown-call-id', { data: 'test' }, CancellationToken.None);
	});

	test('toToolAndToolSetEnablementMap with model metadata filters tools', () => {

		const gpt4ToolDef: IToolData = {
			id: 'gpt4Tool',
			toolReferenceName: 'gpt4ToolRef',
			modelDescription: 'GPT-4 Tool',
			displayName: 'GPT-4 Tool',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
			models: [{ family: 'gpt-4' }],
		};

		const anyModelToolDef: IToolData = {
			id: 'anyModelTool',
			toolReferenceName: 'anyModelToolRef',
			modelDescription: 'Any Model Tool',
			displayName: 'Any Model Tool',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
		};

		const claudeToolDef: IToolData = {
			id: 'claudeTool',
			toolReferenceName: 'claudeToolRef',
			modelDescription: 'Claude Tool',
			displayName: 'Claude Tool',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
			models: [{ family: 'claude-3' }],
		};

		store.add(service.registerToolData(gpt4ToolDef));
		store.add(service.registerToolData(anyModelToolDef));
		store.add(service.registerToolData(claudeToolDef));

		const gpt4Tool = service.getTool('gpt4Tool');
		const anyModelTool = service.getTool('anyModelTool');
		const claudeTool = service.getTool('claudeTool');
		assert.ok(gpt4Tool && anyModelTool && claudeTool, 'tools should be registered');

		const modelMetadata = { id: 'gpt-4-turbo', vendor: 'openai', family: 'gpt-4', version: '1.0' } as ILanguageModelChatMetadata;
		const enabledNames = ['gpt4ToolRef', 'anyModelToolRef', 'claudeToolRef'];
		const result = service.toToolAndToolSetEnablementMap(enabledNames, modelMetadata);

		assert.strictEqual(result.get(gpt4Tool), true, 'gpt4Tool should be enabled');
		assert.strictEqual(result.get(anyModelTool), true, 'anyModelTool should be enabled');
		assert.strictEqual(result.has(claudeTool), false, 'claudeTool should be filtered out by model');
	});

	test('observeTools returns tools filtered by context', async () => {
		return runWithFakedTimers({}, async () => {
			contextKeyService.createKey('featureEnabled', true);

			const enabledTool: IToolData = {
				id: 'enabledObsTool',
				modelDescription: 'Enabled Tool',
				displayName: 'Enabled Tool',
				source: ToolDataSource.Internal,
				when: ContextKeyEqualsExpr.create('featureEnabled', true),
			};

			const disabledTool: IToolData = {
				id: 'disabledObsTool',
				modelDescription: 'Disabled Tool',
				displayName: 'Disabled Tool',
				source: ToolDataSource.Internal,
				when: ContextKeyEqualsExpr.create('featureEnabled', false),
			};

			store.add(service.registerToolData(enabledTool));
			store.add(service.registerToolData(disabledTool));

			const toolsObs = service.observeTools(undefined);

			const tools = toolsObs.get();

			assert.strictEqual(tools.length, 1, 'should only include enabled tool');
			assert.strictEqual(tools[0].id, 'enabledObsTool');
		});
	});

	test('invokeTool with chatStreamToolCallId correlates with pending streaming call', async () => {
		const tool = registerToolForTest(service, store, 'correlatedTool', {
			invoke: async () => ({ content: [{ kind: 'text', value: 'correlated result' }] }),
			handleToolStream: async () => ({ invocationMessage: 'Processing...' }),
		});

		const sessionId = 'correlated-session';
		const requestId = 'correlated-request';
		const capture: { invocation?: any } = {};
		stubGetSession(chatService, sessionId, { requestId, capture });

		const streamingInvocation = service.beginToolCall({
			toolCallId: 'stream-call-id',
			toolId: tool.id,
			chatRequestId: requestId,
			sessionResource: LocalChatSessionUri.forSession(sessionId),
		});

		assert.ok(streamingInvocation, 'should create streaming invocation');

		const dto: IToolInvocation = {
			callId: 'different-call-id',
			toolId: tool.id,
			tokenBudget: 100,
			parameters: { test: 1 },
			context: {
				sessionResource: LocalChatSessionUri.forSession(sessionId),
			},
			chatStreamToolCallId: 'stream-call-id',
		};

		const result = await service.invokeTool(dto, async () => 0, CancellationToken.None);
		assert.strictEqual(result.content[0].value, 'correlated result');
	});

	test('getAllToolsIncludingDisabled returns tools regardless of when clause', () => {
		contextKeyService.createKey('featureFlag', false);

		const enabledTool: IToolData = {
			id: 'enabledTool',
			modelDescription: 'Enabled Tool',
			displayName: 'Enabled Tool',
			source: ToolDataSource.Internal,
		};

		const disabledTool: IToolData = {
			id: 'disabledTool',
			modelDescription: 'Disabled Tool',
			displayName: 'Disabled Tool',
			source: ToolDataSource.Internal,
			when: ContextKeyEqualsExpr.create('featureFlag', true),
		};

		store.add(service.registerToolData(enabledTool));
		store.add(service.registerToolData(disabledTool));

		const allTools = Array.from(service.getAllToolsIncludingDisabled());
		assert.strictEqual(allTools.length, 2, 'getAllToolsIncludingDisabled should return all tools');
		assert.ok(allTools.some(t => t.id === 'enabledTool'), 'should include enabled tool');
		assert.ok(allTools.some(t => t.id === 'disabledTool'), 'should include disabled tool');

		const enabledTools = Array.from(service.getTools(undefined));
		assert.strictEqual(enabledTools.length, 1, 'getTools should only return matching tools');
		assert.strictEqual(enabledTools[0].id, 'enabledTool');
	});

	test('getTools filters by model id using models property', () => {
		const gpt4Tool: IToolData = {
			id: 'gpt4Tool',
			modelDescription: 'GPT-4 Tool',
			displayName: 'GPT-4 Tool',
			source: ToolDataSource.Internal,
			models: [{ id: 'gpt-4-turbo' }],
		};

		const claudeTool: IToolData = {
			id: 'claudeTool',
			modelDescription: 'Claude Tool',
			displayName: 'Claude Tool',
			source: ToolDataSource.Internal,
			models: [{ id: 'claude-3-opus' }],
		};

		const universalTool: IToolData = {
			id: 'universalTool',
			modelDescription: 'Universal Tool',
			displayName: 'Universal Tool',
			source: ToolDataSource.Internal,
		};

		store.add(service.registerToolData(gpt4Tool));
		store.add(service.registerToolData(claudeTool));
		store.add(service.registerToolData(universalTool));

		const modelMetadata = { id: 'gpt-4-turbo', vendor: 'openai', family: 'gpt-4', version: '1.0' } as ILanguageModelChatMetadata;
		const tools = Array.from(service.getTools(modelMetadata));

		assert.strictEqual(tools.length, 2, 'should return 2 tools');
		assert.ok(tools.some(t => t.id === 'gpt4Tool'), 'should include GPT-4 tool');
		assert.ok(tools.some(t => t.id === 'universalTool'), 'should include universal tool');
		assert.ok(!tools.some(t => t.id === 'claudeTool'), 'should NOT include Claude tool');
	});

	test('getTools filters by model vendor using models property', () => {
		const anthropicTool: IToolData = {
			id: 'anthropicTool',
			modelDescription: 'Anthropic Tool',
			displayName: 'Anthropic Tool',
			source: ToolDataSource.Internal,
			models: [{ vendor: 'anthropic' }],
		};

		const openaiTool: IToolData = {
			id: 'openaiTool',
			modelDescription: 'OpenAI Tool',
			displayName: 'OpenAI Tool',
			source: ToolDataSource.Internal,
			models: [{ vendor: 'openai' }],
		};

		store.add(service.registerToolData(anthropicTool));
		store.add(service.registerToolData(openaiTool));

		const modelMetadata = { id: 'claude-3', vendor: 'anthropic', family: 'claude-3', version: '1.0' } as ILanguageModelChatMetadata;
		const tools = Array.from(service.getTools(modelMetadata));

		assert.strictEqual(tools.length, 1, 'should return 1 tool');
		assert.strictEqual(tools[0].id, 'anthropicTool', 'should include Anthropic tool');
	});

	test('getTools filters by model family using models property', () => {
		const gpt4FamilyTool: IToolData = {
			id: 'gpt4FamilyTool',
			modelDescription: 'GPT-4 Family Tool',
			displayName: 'GPT-4 Family Tool',
			source: ToolDataSource.Internal,
			models: [{ family: 'gpt-4' }],
		};

		const gpt35FamilyTool: IToolData = {
			id: 'gpt35FamilyTool',
			modelDescription: 'GPT-3.5 Family Tool',
			displayName: 'GPT-3.5 Family Tool',
			source: ToolDataSource.Internal,
			models: [{ family: 'gpt-3.5' }],
		};

		store.add(service.registerToolData(gpt4FamilyTool));
		store.add(service.registerToolData(gpt35FamilyTool));

		const modelMetadata = { id: 'gpt-4-turbo', vendor: 'openai', family: 'gpt-4', version: '1.0' } as ILanguageModelChatMetadata;
		const tools = Array.from(service.getTools(modelMetadata));

		assert.strictEqual(tools.length, 1, 'should return 1 tool');
		assert.strictEqual(tools[0].id, 'gpt4FamilyTool', 'should include GPT-4 family tool');
	});

	test('getTools with undefined model skips model filtering', () => {
		const gpt4Tool: IToolData = {
			id: 'gpt4Tool',
			modelDescription: 'GPT-4 Tool',
			displayName: 'GPT-4 Tool',
			source: ToolDataSource.Internal,
			models: [{ id: 'gpt-4-turbo' }],
		};

		const claudeTool: IToolData = {
			id: 'claudeTool',
			modelDescription: 'Claude Tool',
			displayName: 'Claude Tool',
			source: ToolDataSource.Internal,
			models: [{ id: 'claude-3-opus' }],
		};

		store.add(service.registerToolData(gpt4Tool));
		store.add(service.registerToolData(claudeTool));

		const tools = Array.from(service.getTools(undefined));

		assert.strictEqual(tools.length, 2, 'should return all tools when model is undefined');
		assert.ok(tools.some(t => t.id === 'gpt4Tool'), 'should include GPT-4 tool');
		assert.ok(tools.some(t => t.id === 'claudeTool'), 'should include Claude tool');
	});

	test('getTool returns tool regardless of when clause', () => {
		contextKeyService.createKey('someFlag', false);

		const disabledTool: IToolData = {
			id: 'disabledLookupTool',
			modelDescription: 'Disabled Lookup Tool',
			displayName: 'Disabled Lookup Tool',
			source: ToolDataSource.Internal,
			when: ContextKeyEqualsExpr.create('someFlag', true),
		};

		store.add(service.registerToolData(disabledTool));

		const tool = service.getTool('disabledLookupTool');
		assert.ok(tool, 'getTool should return tool even when disabled');
		assert.strictEqual(tool.id, 'disabledLookupTool');
	});

	test('getToolByName returns tool regardless of when clause', () => {
		contextKeyService.createKey('anotherFlag', false);

		const disabledTool: IToolData = {
			id: 'disabledNamedTool',
			toolReferenceName: 'disabledNamedToolRef',
			modelDescription: 'Disabled Named Tool',
			displayName: 'Disabled Named Tool',
			source: ToolDataSource.Internal,
			when: ContextKeyEqualsExpr.create('anotherFlag', true),
		};

		store.add(service.registerToolData(disabledTool));

		const tool = service.getToolByName('disabledNamedToolRef');
		assert.ok(tool, 'getToolByName should return tool even when disabled');
		assert.strictEqual(tool.id, 'disabledNamedTool');
	});

	test('IToolData models property stores selector information', () => {
		const toolWithModels: IToolData = {
			id: 'modelSpecificTool',
			modelDescription: 'Model Specific Tool',
			displayName: 'Model Specific Tool',
			source: ToolDataSource.Internal,
			models: [
				{ vendor: 'openai', family: 'gpt-4' },
				{ vendor: 'anthropic', family: 'claude-3' },
			],
		};

		store.add(service.registerToolData(toolWithModels));

		const tool = service.getTool('modelSpecificTool');
		assert.ok(tool, 'tool should be registered');
		assert.ok(tool.models, 'tool should have models property');
		assert.strictEqual(tool.models.length, 2, 'tool should have 2 model selectors');
		assert.deepStrictEqual(tool.models[0], { vendor: 'openai', family: 'gpt-4' });
		assert.deepStrictEqual(tool.models[1], { vendor: 'anthropic', family: 'claude-3' });
	});

	test('tools with extension tools disabled setting are filtered', () => {
		const extensionTool: IToolData = {
			id: 'extensionTool',
			modelDescription: 'Extension Tool',
			displayName: 'Extension Tool',
			source: { type: 'extension', label: 'Test Extension', extensionId: new ExtensionIdentifier('test.extension') },
		};

		store.add(service.registerToolData(extensionTool));

		let tools = Array.from(service.getTools(undefined));
		assert.ok(tools.some(t => t.id === 'extensionTool'), 'extension tool should be included when enabled');

		configurationService.setUserConfiguration(ChatConfiguration.ExtensionToolsEnabled, false);

		tools = Array.from(service.getTools(undefined));
		assert.ok(!tools.some(t => t.id === 'extensionTool'), 'extension tool should be excluded when disabled');

		configurationService.setUserConfiguration(ChatConfiguration.ExtensionToolsEnabled, true);
	});

	test('observeTools changes when context key changes', () => {
		const testCtxKey = contextKeyService.createKey<string>('dynamicTestKey', 'value1');

		const tool1: IToolData = {
			id: 'dynamicTool1',
			modelDescription: 'Dynamic Tool 1',
			displayName: 'Dynamic Tool 1',
			source: ToolDataSource.Internal,
			when: ContextKeyEqualsExpr.create('dynamicTestKey', 'value1'),
		};

		const tool2: IToolData = {
			id: 'dynamicTool2',
			modelDescription: 'Dynamic Tool 2',
			displayName: 'Dynamic Tool 2',
			source: ToolDataSource.Internal,
			when: ContextKeyEqualsExpr.create('dynamicTestKey', 'value2'),
		};

		store.add(service.registerToolData(tool1));
		store.add(service.registerToolData(tool2));

		const toolsObs = service.observeTools(undefined);

		let tools = toolsObs.get();
		assert.strictEqual(tools.length, 1, 'should have 1 tool initially');
		assert.strictEqual(tools[0].id, 'dynamicTool1', 'should be dynamicTool1');

		testCtxKey.set('value2');

		service.flushToolUpdates();

		tools = toolsObs.get();
		assert.strictEqual(tools.length, 1, 'should have 1 tool after change');
		assert.strictEqual(tools[0].id, 'dynamicTool2', 'should be dynamicTool2 after context change');
	});

	test('isPermitted allows tools in permitted toolsets when agent mode is disabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const readTool: IToolData = {
			id: 'readToolInSet',
			toolReferenceName: 'readToolRef',
			modelDescription: 'Read Tool in Set',
			displayName: 'Read Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(readTool));
		store.add(service.readToolSet.addTool(readTool));

		const standaloneTool: IToolData = {
			id: 'standaloneTool',
			toolReferenceName: 'standaloneRef',
			modelDescription: 'Standalone Tool',
			displayName: 'Standalone Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(standaloneTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(toolIds.includes('readToolInSet'), 'Tool in read toolset should be permitted when agent mode is disabled');
		assert.ok(!toolIds.includes('standaloneTool'), 'Standalone tool not in permitted toolset should NOT be permitted when agent mode is disabled');
	});

	test('isPermitted allows all tools when agent mode is enabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, true);

		const readTool: IToolData = {
			id: 'readToolEnabled',
			toolReferenceName: 'readToolEnabledRef',
			modelDescription: 'Read Tool',
			displayName: 'Read Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(readTool));
		store.add(service.readToolSet.addTool(readTool));

		const standaloneTool: IToolData = {
			id: 'standaloneToolEnabled',
			toolReferenceName: 'standaloneEnabledRef',
			modelDescription: 'Standalone Tool',
			displayName: 'Standalone Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(standaloneTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(toolIds.includes('readToolEnabled'), 'Tool in read toolset should be permitted when agent mode is enabled');
		assert.ok(toolIds.includes('standaloneToolEnabled'), 'Standalone tool should be permitted when agent mode is enabled');
	});

	test('isPermitted filters toolsets when agent mode is disabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const customToolSet = store.add(service.createToolSet(
			ToolDataSource.Internal,
			'customToolSet',
			'customToolSetRef',
			{ description: 'Custom Tool Set' }
		));

		const customTool: IToolData = {
			id: 'customToolInSet',
			toolReferenceName: 'customToolRef',
			modelDescription: 'Custom Tool',
			displayName: 'Custom Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(customTool));
		store.add(customToolSet.addTool(customTool));

		const toolSets = Array.from(service.toolSets.get());
		const toolSetIds = Array.from(toolSets).map(ts => ts.id);

		assert.ok(toolSetIds.includes('read'), 'read toolset should be permitted when agent mode is disabled');
		assert.ok(!toolSetIds.includes('customToolSet'), 'custom toolset should NOT be permitted when agent mode is disabled');
	});

	test('isPermitted allows execute toolset tools when agent mode is enabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, true);

		const executeTool: IToolData = {
			id: 'executeToolInSet',
			toolReferenceName: 'executeToolRef',
			modelDescription: 'Execute Tool',
			displayName: 'Execute Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(executeTool));
		store.add(service.executeToolSet.addTool(executeTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(toolIds.includes('executeToolInSet'), 'Tool in execute toolset should be permitted when agent mode is enabled');
	});

	test('isPermitted blocks execute toolset tools when agent mode is disabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const executeTool: IToolData = {
			id: 'executeToolBlocked',
			toolReferenceName: 'executeToolBlockedRef',
			modelDescription: 'Execute Tool',
			displayName: 'Execute Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(executeTool));
		store.add(service.executeToolSet.addTool(executeTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(!toolIds.includes('executeToolBlocked'), 'Tool in execute toolset should NOT be permitted when agent mode is disabled');
	});

	test('isPermitted allows search toolset tools when agent mode is disabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const searchToolSet = store.add(service.createToolSet(
			ToolDataSource.Internal,
			'search',
			SpecedToolAliases.search,
			{ description: 'Search Tool Set' }
		));

		const searchTool: IToolData = {
			id: 'searchToolInSet',
			toolReferenceName: 'searchToolRef',
			modelDescription: 'Search Tool',
			displayName: 'Search Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(searchTool));
		store.add(searchToolSet.addTool(searchTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(toolIds.includes('searchToolInSet'), 'Tool in search toolset should be permitted when agent mode is disabled');
	});

	test('isPermitted allows web toolset tools when agent mode is disabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const webToolSet = store.add(service.createToolSet(
			ToolDataSource.Internal,
			'web',
			SpecedToolAliases.web,
			{ description: 'Web Tool Set' }
		));

		const webTool: IToolData = {
			id: 'webToolInSet',
			toolReferenceName: 'webToolRef',
			modelDescription: 'Web Tool',
			displayName: 'Web Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(webTool));
		store.add(webToolSet.addTool(webTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(toolIds.includes('webToolInSet'), 'Tool in web toolset should be permitted when agent mode is disabled');
	});

	test('isPermitted allows vscode_fetchWebPage_internal special case when agent mode is disabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const fetchTool: IToolData = {
			id: 'vscode_fetchWebPage_internal',
			toolReferenceName: 'fetchWebPage',
			modelDescription: 'Fetch Web Page',
			displayName: 'Fetch Web Page',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(fetchTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(toolIds.includes('vscode_fetchWebPage_internal'), 'vscode_fetchWebPage_internal should be permitted as special case when agent mode is disabled');
	});

	test('isPermitted blocks extension tools not in permitted toolsets when agent mode is disabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const extensionTool: IToolData = {
			id: 'extensionToolBlocked',
			toolReferenceName: 'extensionToolRef',
			modelDescription: 'Extension Tool',
			displayName: 'Extension Tool',
			source: { type: 'extension', label: 'Test Extension', extensionId: new ExtensionIdentifier('test.extension') },
			canBeReferencedInPrompt: true,
		};
		store.add(service.registerToolData(extensionTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(!toolIds.includes('extensionToolBlocked'), 'Extension tool not in permitted toolset should NOT be permitted when agent mode is disabled');
	});

	test('isPermitted blocks MCP tools not in permitted toolsets when agent mode is disabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const mcpToolSet = store.add(service.createToolSet(
			{ type: 'mcp', label: 'Test MCP', serverLabel: 'Test MCP Server', instructions: undefined, collectionId: 'testMcp', definitionId: 'testMcpDef' },
			'mcpToolSetBlocked',
			'mcpToolSetBlockedRef',
			{ description: 'MCP Tool Set' }
		));

		const mcpTool: IToolData = {
			id: 'mcpToolBlocked',
			toolReferenceName: 'mcpToolRef',
			modelDescription: 'MCP Tool',
			displayName: 'MCP Tool',
			source: { type: 'mcp', label: 'Test MCP', serverLabel: 'Test MCP Server', instructions: undefined, collectionId: 'testMcp', definitionId: 'testMcpDef' },
			canBeReferencedInPrompt: true,
		};
		store.add(service.registerToolData(mcpTool));
		store.add(mcpToolSet.addTool(mcpTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(!toolIds.includes('mcpToolBlocked'), 'MCP tool should NOT be permitted when agent mode is disabled');

		const toolSets = Array.from(service.toolSets.get());
		const toolSetIds = Array.from(toolSets).map(ts => ts.id);

		assert.ok(!toolSetIds.includes('mcpToolSetBlocked'), 'MCP toolset should NOT be permitted when agent mode is disabled');
	});

	test('isPermitted blocks agent toolset tools when agent mode is disabled', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const agentTool: IToolData = {
			id: 'agentToolBlocked',
			toolReferenceName: 'agentToolBlockedRef',
			modelDescription: 'Agent Tool',
			displayName: 'Agent Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(agentTool));
		store.add(service.agentToolSet.addTool(agentTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(!toolIds.includes('agentToolBlocked'), 'Tool in agent toolset should NOT be permitted when agent mode is disabled');

		const toolSets = Array.from(service.toolSets.get());
		const toolSetIds = Array.from(toolSets).map(ts => ts.id);

		assert.ok(!toolSetIds.includes('agent'), 'agent toolset should NOT be permitted when agent mode is disabled');
	});

	test('isPermitted includes tool in multiple toolsets if one is permitted', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const multiSetTool: IToolData = {
			id: 'multiSetTool',
			toolReferenceName: 'multiSetToolRef',
			modelDescription: 'Multi Set Tool',
			displayName: 'Multi Set Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(multiSetTool));

		store.add(service.readToolSet.addTool(multiSetTool));

		const customToolSet = store.add(service.createToolSet(
			ToolDataSource.Internal,
			'customMultiSet',
			'customMultiSetRef',
			{ description: 'Custom Multi Set' }
		));
		store.add(customToolSet.addTool(multiSetTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(toolIds.includes('multiSetTool'), 'Tool should be permitted if it belongs to at least one permitted toolset');
	});

	test('isPermitted allows internal tools with canBeReferencedInPrompt=false when agent mode is disabled (issue #292935)', () => {
		configurationService.setUserConfiguration(ChatConfiguration.AgentEnabled, false);

		const infrastructureTool: IToolData = {
			id: 'infrastructureToolInternal',
			toolReferenceName: 'infrastructureToolRef',
			modelDescription: 'Infrastructure Tool',
			displayName: 'Infrastructure Tool',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: false,
		};
		store.add(service.registerToolData(infrastructureTool));

		const referencableTool: IToolData = {
			id: 'referencableTool',
			toolReferenceName: 'referencableToolRef',
			modelDescription: 'Referencable Tool',
			displayName: 'Referencable Tool',
			source: ToolDataSource.Internal,
			canBeReferencedInPrompt: true,
		};
		store.add(service.registerToolData(referencableTool));

		const undefinedTool: IToolData = {
			id: 'undefinedTool',
			toolReferenceName: 'undefinedToolRef',
			modelDescription: 'Undefined Tool',
			displayName: 'Undefined Tool',
			source: ToolDataSource.Internal,
		};
		store.add(service.registerToolData(undefinedTool));

		const tools = Array.from(service.getTools(undefined));
		const toolIds = tools.map(t => t.id);

		assert.ok(toolIds.includes('infrastructureToolInternal'), 'Internal infrastructure tool with canBeReferencedInPrompt=false should be permitted when agent mode is disabled');
		assert.ok(!toolIds.includes('referencableTool'), 'Internal tool with canBeReferencedInPrompt=true should NOT be permitted when agent mode is disabled');
		assert.ok(!toolIds.includes('undefinedTool'), 'Internal tool with canBeReferencedInPrompt=undefined should NOT be permitted when agent mode is disabled');
	});

	suite('ToolSet when clause filtering (issue #291154)', () => {
		test('ToolSet.getTools filters tools by when clause', () => {
			contextKeyService.createKey('testFeatureEnabled', false);

			const toolWithWhenTrue: IToolData = {
				id: 'toolWithWhenTrue',
				modelDescription: 'Tool with when true',
				displayName: 'Tool with when true',
				source: ToolDataSource.Internal,
				when: ContextKeyEqualsExpr.create('testFeatureEnabled', true),
			};

			const toolWithWhenFalse: IToolData = {
				id: 'toolWithWhenFalse',
				modelDescription: 'Tool with when false',
				displayName: 'Tool with when false',
				source: ToolDataSource.Internal,
				when: ContextKeyEqualsExpr.create('testFeatureEnabled', false),
			};

			const toolWithoutWhen: IToolData = {
				id: 'toolWithoutWhen',
				modelDescription: 'Tool without when',
				displayName: 'Tool without when',
				source: ToolDataSource.Internal,
			};

			const testToolSet = store.add(service.createToolSet(
				ToolDataSource.Internal,
				'testToolSet',
				'testToolSetRef',
				{ description: 'Test Tool Set' }
			));

			store.add(service.registerToolData(toolWithWhenTrue));
			store.add(service.registerToolData(toolWithWhenFalse));
			store.add(service.registerToolData(toolWithoutWhen));

			store.add(testToolSet.addTool(toolWithWhenTrue));
			store.add(testToolSet.addTool(toolWithWhenFalse));
			store.add(testToolSet.addTool(toolWithoutWhen));

			const tools = Array.from(testToolSet.getTools());
			const toolIds = tools.map(t => t.id);

			assert.ok(toolIds.includes('toolWithWhenFalse'), 'Tool with when=false should be in tool set when context key is false');
			assert.ok(toolIds.includes('toolWithoutWhen'), 'Tool without when clause should be in tool set');
			assert.ok(!toolIds.includes('toolWithWhenTrue'), 'Tool with when=true should NOT be in tool set when context key is false');
		});

		test('ToolSet.getTools updates when context key changes', () => {
			const testKey = contextKeyService.createKey<string>('dynamicTestKey', 'value1');

			const toolWithValue1: IToolData = {
				id: 'toolWithValue1',
				modelDescription: 'Tool with value1',
				displayName: 'Tool with value1',
				source: ToolDataSource.Internal,
				when: ContextKeyEqualsExpr.create('dynamicTestKey', 'value1'),
			};

			const toolWithValue2: IToolData = {
				id: 'toolWithValue2',
				modelDescription: 'Tool with value2',
				displayName: 'Tool with value2',
				source: ToolDataSource.Internal,
				when: ContextKeyEqualsExpr.create('dynamicTestKey', 'value2'),
			};

			const dynamicToolSet = store.add(service.createToolSet(
				ToolDataSource.Internal,
				'dynamicToolSet',
				'dynamicToolSetRef',
				{ description: 'Dynamic Tool Set' }
			));

			store.add(service.registerToolData(toolWithValue1));
			store.add(service.registerToolData(toolWithValue2));

			store.add(dynamicToolSet.addTool(toolWithValue1));
			store.add(dynamicToolSet.addTool(toolWithValue2));

			let tools = Array.from(dynamicToolSet.getTools());
			let toolIds = tools.map(t => t.id);

			assert.strictEqual(tools.length, 1, 'Should have 1 tool initially');
			assert.strictEqual(toolIds[0], 'toolWithValue1', 'Should be toolWithValue1');

			testKey.set('value2');

			service.flushToolUpdates();

			tools = Array.from(dynamicToolSet.getTools());
			toolIds = tools.map(t => t.id);

			assert.strictEqual(tools.length, 1, 'Should have 1 tool after change');
			assert.strictEqual(toolIds[0], 'toolWithValue2', 'Should be toolWithValue2 after context change');
		});

		test('ToolSet.getTools with complex when expressions', () => {
			contextKeyService.createKey('featureA', true);
			contextKeyService.createKey('featureB', false);
			contextKeyService.createKey('featureC', true);

			const toolWithAnd: IToolData = {
				id: 'toolWithAnd',
				modelDescription: 'Tool with AND expression',
				displayName: 'Tool with AND',
				source: ToolDataSource.Internal,
				when: ContextKeyExpr.and(
					ContextKeyExpr.has('featureA'),
					ContextKeyExpr.has('featureC')
				),
			};

			const toolWithOr: IToolData = {
				id: 'toolWithOr',
				modelDescription: 'Tool with OR expression',
				displayName: 'Tool with OR',
				source: ToolDataSource.Internal,
				when: ContextKeyExpr.or(
					ContextKeyExpr.has('featureA'),
					ContextKeyExpr.has('featureC')
				),
			};

			const toolWithNot: IToolData = {
				id: 'toolWithNot',
				modelDescription: 'Tool with NOT expression',
				displayName: 'Tool with NOT',
				source: ToolDataSource.Internal,
				when: ContextKeyExpr.not('featureB'),
			};

			const complexToolSet = store.add(service.createToolSet(
				ToolDataSource.Internal,
				'complexToolSet',
				'complexToolSetRef',
				{ description: 'Complex Tool Set' }
			));

			store.add(service.registerToolData(toolWithAnd));
			store.add(service.registerToolData(toolWithOr));
			store.add(service.registerToolData(toolWithNot));

			store.add(complexToolSet.addTool(toolWithAnd));
			store.add(complexToolSet.addTool(toolWithOr));
			store.add(complexToolSet.addTool(toolWithNot));

			const tools = Array.from(complexToolSet.getTools());
			const toolIds = tools.map(t => t.id);

			assert.ok(toolIds.includes('toolWithAnd'), 'Tool with AND should be in tool set (has(featureA) AND has(featureC) = true)');
			assert.ok(toolIds.includes('toolWithOr'), 'Tool with OR should be in tool set (has(featureA) OR has(featureC) = true)');
			assert.ok(toolIds.includes('toolWithNot'), 'Tool with NOT should be in tool set (NOT has(featureB) = true)');
		});

		test('ToolSet.getTools filters nested tool sets by when clause', () => {
			contextKeyService.createKey('nestedFeature', false);

			const parentTool: IToolData = {
				id: 'parentTool',
				modelDescription: 'Parent Tool',
				displayName: 'Parent Tool',
				source: ToolDataSource.Internal,
			};

			const childToolWithWhen: IToolData = {
				id: 'childToolWithWhen',
				modelDescription: 'Child Tool with When',
				displayName: 'Child Tool with When',
				source: ToolDataSource.Internal,
				when: ContextKeyEqualsExpr.create('nestedFeature', true),
			};

			const childToolWithoutWhen: IToolData = {
				id: 'childToolWithoutWhen',
				modelDescription: 'Child Tool without When',
				displayName: 'Child Tool without When',
				source: ToolDataSource.Internal,
			};

			const parentToolSet = store.add(service.createToolSet(
				ToolDataSource.Internal,
				'parentToolSet',
				'parentToolSetRef',
				{ description: 'Parent Tool Set' }
			));

			const childToolSet = store.add(service.createToolSet(
				ToolDataSource.Internal,
				'childToolSet',
				'childToolSetRef',
				{ description: 'Child Tool Set' }
			));

			store.add(service.registerToolData(parentTool));
			store.add(service.registerToolData(childToolWithWhen));
			store.add(service.registerToolData(childToolWithoutWhen));

			store.add(parentToolSet.addTool(parentTool));
			store.add(parentToolSet.addToolSet(childToolSet));
			store.add(childToolSet.addTool(childToolWithWhen));
			store.add(childToolSet.addTool(childToolWithoutWhen));

			const tools = Array.from(parentToolSet.getTools());
			const toolIds = tools.map(t => t.id);

			assert.ok(toolIds.includes('parentTool'), 'Parent tool should be in tool set');
			assert.ok(toolIds.includes('childToolWithoutWhen'), 'Child tool without when should be in tool set');
			assert.ok(!toolIds.includes('childToolWithWhen'), 'Child tool with when=true should NOT be in tool set when context key is false');
		});
	});

	suite('preToolUse hooks', () => {
		let hookService: LanguageModelToolsService;
		let hookChatService: MockChatService;

		setup(() => {
			const setup = createTestToolsService(store);
			hookService = setup.service;
			hookChatService = setup.chatService;
		});

		test('when hook denies, tool returns error and creates cancelled invocation', async () => {
			const tool = registerToolForTest(hookService, store, 'hookDenyTool', {
				invoke: async () => ({ content: [{ kind: 'text', value: 'should not run' }] })
			});

			const capture: { invocation?: ChatToolInvocation } = {};
			stubGetSession(hookChatService, 'hook-test', { requestId: 'req1', capture });

			const dto = tool.makeDto({ test: 1 }, { sessionId: 'hook-test' });
			dto.preToolUseResult = {
				permissionDecision: 'deny',
				permissionDecisionReason: 'Destructive operations require approval',
			};

			const result = await hookService.invokeTool(
				dto,
				async () => 0,
				CancellationToken.None
			);

			assert.ok(result.toolResultError);
			assert.ok((result.toolResultError as string).includes('Destructive operations require approval'));
			assert.strictEqual(result.content[0].kind, 'text');
			assert.ok((result.content[0] as IToolResultTextPart).value.includes('Tool execution denied'));

			const invocation = await waitForPublishedInvocation(capture);
			assert.ok(invocation);
			const state = invocation.state.get();
			assert.strictEqual(state.type, IChatToolInvocation.StateKind.Cancelled);
			if (state.type === IChatToolInvocation.StateKind.Cancelled) {
				assert.strictEqual(state.reason, ToolConfirmKind.Denied);
				assert.strictEqual(state.reasonMessage, 'Denied by PreToolUse hook: Destructive operations require approval');
			}
		});

		test('when hook allows, tool executes normally', async () => {
			const tool = registerToolForTest(hookService, store, 'hookAllowTool', {
				invoke: async () => ({ content: [{ kind: 'text', value: 'success' }] })
			});

			const capture: { invocation?: ChatToolInvocation } = {};
			stubGetSession(hookChatService, 'hook-test-allow', { requestId: 'req1', capture });

			const dto = tool.makeDto({ test: 1 }, { sessionId: 'hook-test-allow' });
			dto.preToolUseResult = {
				permissionDecision: 'allow',
			};

			const result = await hookService.invokeTool(
				dto,
				async () => 0,
				CancellationToken.None
			);

			assert.strictEqual(result.content[0].kind, 'text');
			assert.strictEqual((result.content[0] as IToolResultTextPart).value, 'success');
			assert.ok(!result.toolResultError);
		});

		test('when hook returns undefined, tool executes normally', async () => {
			const tool = registerToolForTest(hookService, store, 'hookUndefinedTool', {
				invoke: async () => ({ content: [{ kind: 'text', value: 'success' }] })
			});

			stubGetSession(hookChatService, 'hook-test-undefined', { requestId: 'req1' });

			const result = await hookService.invokeTool(
				tool.makeDto({ test: 1 }, { sessionId: 'hook-test-undefined' }),
				async () => 0,
				CancellationToken.None
			);

			assert.strictEqual(result.content[0].kind, 'text');
			assert.strictEqual((result.content[0] as IToolResultTextPart).value, 'success');
		});

		test('when hook denies, tool invoke is never called', async () => {
			let invokeCalled = false;
			const tool = registerToolForTest(hookService, store, 'hookNeverInvokeTool', {
				invoke: async () => {
					invokeCalled = true;
					return { content: [{ kind: 'text', value: 'should not run' }] };
				}
			});

			const capture: { invocation?: unknown } = {};
			stubGetSession(hookChatService, 'hook-test-no-invoke', { requestId: 'req1', capture });

			const dto = tool.makeDto({ test: 1 }, { sessionId: 'hook-test-no-invoke' });
			dto.preToolUseResult = {
				permissionDecision: 'deny',
				permissionDecisionReason: 'Operation not allowed',
			};

			await hookService.invokeTool(
				dto,
				async () => 0,
				CancellationToken.None
			);

			assert.strictEqual(invokeCalled, false, 'Tool invoke should not be called when hook denies');
		});

		test('when hook returns ask, tool is not auto-approved', async () => {
			let invokeCompleted = false;
			const tool = registerToolForTest(hookService, store, 'hookAskTool', {
				invoke: async () => {
					invokeCompleted = true;
					return { content: [{ kind: 'text', value: 'success' }] };
				},
				prepareToolInvocation: async () => ({
					confirmationMessages: {
						title: 'Confirm this action?',
						message: 'This tool requires confirmation',
						allowAutoConfirm: true
					}
				})
			});

			const capture: { invocation?: ChatToolInvocation } = {};
			stubGetSession(hookChatService, 'hook-test-ask', { requestId: 'req1', capture });

			const dto = tool.makeDto({ test: 1 }, { sessionId: 'hook-test-ask' });
			dto.preToolUseResult = {
				permissionDecision: 'ask',
				permissionDecisionReason: 'Requires user confirmation',
			};

			const invokePromise = hookService.invokeTool(
				dto,
				async () => 0,
				CancellationToken.None
			);

			const invocation = await waitForPublishedInvocation(capture);
			assert.ok(invocation, 'Tool invocation should be created');

			const state = invocation.state.get();
			assert.strictEqual(state.type, IChatToolInvocation.StateKind.WaitingForConfirmation,
				'Tool should be waiting for confirmation when hook returns ask');

			IChatToolInvocation.confirmWith(invocation, { type: ToolConfirmKind.UserAction });
			await invokePromise;

			assert.strictEqual(invokeCompleted, true, 'Tool should complete after confirmation');
		});

		test('when hook returns allow, tool is auto-approved', async () => {
			let invokeCompleted = false;
			const tool = registerToolForTest(hookService, store, 'hookAutoApproveTool', {
				invoke: async () => {
					invokeCompleted = true;
					return { content: [{ kind: 'text', value: 'success' }] };
				},
				prepareToolInvocation: async () => ({
					confirmationMessages: {
						title: 'Confirm this action?',
						message: 'This tool would normally require confirmation',
						allowAutoConfirm: true
					}
				})
			});

			const capture: { invocation?: ChatToolInvocation } = {};
			stubGetSession(hookChatService, 'hook-test-auto-approve', { requestId: 'req1', capture });

			const dto = tool.makeDto({ test: 1 }, { sessionId: 'hook-test-auto-approve' });
			dto.preToolUseResult = {
				permissionDecision: 'allow',
			};

			const result = await hookService.invokeTool(
				dto,
				async () => 0,
				CancellationToken.None
			);

			assert.strictEqual(invokeCompleted, true, 'Tool should complete immediately when hook allows');
			assert.strictEqual(result.content[0].kind, 'text');
			assert.strictEqual((result.content[0] as IToolResultTextPart).value, 'success');
		});

		test('when hook returns updatedInput, tool is invoked with replaced parameters', async () => {
			let receivedParameters: Record<string, any> | undefined;

			const tool = registerToolForTest(hookService, store, 'hookUpdatedInputTool', {
				invoke: async (dto) => {
					receivedParameters = dto.parameters;
					return { content: [{ kind: 'text', value: 'done' }] };
				},
				prepareToolInvocation: async () => ({
					confirmationMessages: {
						title: 'Confirm?',
						message: 'Confirm action',
						allowAutoConfirm: true
					}
				})
			});

			stubGetSession(hookChatService, 'hook-test-updated-input', { requestId: 'req1' });

			const dto = tool.makeDto({ originalCommand: 'rm -rf /' }, { sessionId: 'hook-test-updated-input' });
			dto.preToolUseResult = {
				permissionDecision: 'allow',
				updatedInput: { safeCommand: 'echo hello' },
			};

			await hookService.invokeTool(
				dto,
				async () => 0,
				CancellationToken.None
			);

			assert.deepStrictEqual(receivedParameters, { safeCommand: 'echo hello' });
		});

		test('when hook returns updatedInput that fails schema validation, original parameters are kept', async () => {
			const mockCommandService = {
				executeCommand: async (commandId: string) => {
					if (commandId === 'json.validate') {
						return [{ message: 'Missing required property "command"', range: [{ line: 0, character: 0 }, { line: 0, character: 1 }], severity: 'Error' }];
					}
					return undefined;
				}
			};

			const setup = createTestToolsService(store, {
				commandService: mockCommandService as ICommandService,
			});

			let receivedParameters: Record<string, any> | undefined;

			const tool = registerToolForTest(setup.service, store, 'hookValidationFailTool', {
				invoke: async (dto) => {
					receivedParameters = dto.parameters;
					return { content: [{ kind: 'text', value: 'done' }] };
				},
				prepareToolInvocation: async () => ({
					confirmationMessages: {
						title: 'Confirm?',
						message: 'Confirm action',
						allowAutoConfirm: true
					}
				})
			}, {
				inputSchema: {
					type: 'object',
					properties: { command: { type: 'string' } },
					required: ['command'],
				}
			});

			stubGetSession(setup.chatService, 'hook-test-validation-fail', { requestId: 'req1' });

			const dto = tool.makeDto({ command: 'original' }, { sessionId: 'hook-test-validation-fail' });
			dto.preToolUseResult = {
				permissionDecision: 'allow',
				updatedInput: { invalidField: 'wrong' },
			};

			await setup.service.invokeTool(
				dto,
				async () => 0,
				CancellationToken.None
			);

			assert.deepStrictEqual(receivedParameters, { command: 'original' });
		});

		test('when hook returns updatedInput that passes schema validation, parameters are replaced', async () => {
			const mockCommandService = {
				executeCommand: async (commandId: string) => {
					if (commandId === 'json.validate') {
						return [];
					}
					return undefined;
				}
			};

			const setup = createTestToolsService(store, {
				commandService: mockCommandService as ICommandService,
			});

			let receivedParameters: Record<string, any> | undefined;

			const tool = registerToolForTest(setup.service, store, 'hookValidationPassTool', {
				invoke: async (dto) => {
					receivedParameters = dto.parameters;
					return { content: [{ kind: 'text', value: 'done' }] };
				},
				prepareToolInvocation: async () => ({
					confirmationMessages: {
						title: 'Confirm?',
						message: 'Confirm action',
						allowAutoConfirm: true
					}
				})
			}, {
				inputSchema: {
					type: 'object',
					properties: { command: { type: 'string' } },
					required: ['command'],
				}
			});

			stubGetSession(setup.chatService, 'hook-test-validation-pass', { requestId: 'req1' });

			const dto = tool.makeDto({ command: 'original' }, { sessionId: 'hook-test-validation-pass' });
			dto.preToolUseResult = {
				permissionDecision: 'allow',
				updatedInput: { command: 'safe-command' },
			};

			await setup.service.invokeTool(
				dto,
				async () => 0,
				CancellationToken.None
			);

			assert.deepStrictEqual(receivedParameters, { command: 'safe-command' });
		});
	});

	suite('preApproved (out-of-band auto-approval)', () => {
		let preApprovedService: LanguageModelToolsService;
		let preApprovedChatService: MockChatService;

		setup(() => {
			const setup = createTestToolsService(store);
			preApprovedService = setup.service;
			preApprovedChatService = setup.chatService;
		});

		test('a confirmable tool with dto.preApproved never enters WaitingForConfirmation', async () => {
			let invokeCompleted = false;
			const tool = registerToolForTest(preApprovedService, store, 'preApprovedTool', {
				invoke: async () => {
					invokeCompleted = true;
					return { content: [{ kind: 'text', value: 'success' }] };
				},
				prepareToolInvocation: async () => ({
					confirmationMessages: {
						title: 'Confirm this action?',
						message: 'This tool would normally require confirmation',
						allowAutoConfirm: true,
					},
				}),
			});

			const capture: { invocation?: ChatToolInvocation } = {};
			stubGetSession(preApprovedChatService, 'pre-approved', { requestId: 'req1', capture });

			const dto = tool.makeDto({ test: 1 }, { sessionId: 'pre-approved' });
			dto.preApproved = { type: ToolConfirmKind.Setting, id: 'autoApprove' };

			const invokePromise = preApprovedService.invokeTool(dto, async () => 0, CancellationToken.None);
			const invocation = await waitForPublishedInvocation(capture);
			const publishedState = invocation.state.get().type;

			if (publishedState === IChatToolInvocation.StateKind.WaitingForConfirmation) {
				IChatToolInvocation.confirmWith(invocation, { type: ToolConfirmKind.UserAction });
			}
			const result = await invokePromise;

			assert.deepStrictEqual(
				{
					invokeCompleted,
					value: (result.content[0] as IToolResultTextPart).value,
					publishedWaitingForConfirmation: publishedState === IChatToolInvocation.StateKind.WaitingForConfirmation,
				},
				{
					invokeCompleted: true,
					value: 'success',
					publishedWaitingForConfirmation: false,
				},
			);
		});

		test('dto.preApproved does not override a preToolUse hook that returned ask', async () => {
			const tool = registerToolForTest(preApprovedService, store, 'preApprovedAskTool', {
				invoke: async () => ({ content: [{ kind: 'text', value: 'success' }] }),
				prepareToolInvocation: async () => ({
					confirmationMessages: {
						title: 'Confirm this action?',
						message: 'This tool requires confirmation',
						allowAutoConfirm: true,
					},
				}),
			});

			const capture: { invocation?: ChatToolInvocation } = {};
			stubGetSession(preApprovedChatService, 'pre-approved-ask', { requestId: 'req1', capture });

			const dto = tool.makeDto({ test: 1 }, { sessionId: 'pre-approved-ask' });
			dto.preApproved = { type: ToolConfirmKind.Setting, id: 'autoApprove' };
			dto.preToolUseResult = { permissionDecision: 'ask', permissionDecisionReason: 'Requires user confirmation' };

			const invokePromise = preApprovedService.invokeTool(dto, async () => 0, CancellationToken.None);
			const invocation = await waitForPublishedInvocation(capture);

			assert.strictEqual(invocation.state.get().type, IChatToolInvocation.StateKind.WaitingForConfirmation,
				'preApproved must not override an explicit hook ask');

			IChatToolInvocation.confirmWith(invocation, { type: ToolConfirmKind.UserAction });
			await invokePromise;
		});

		test('a headless confirmable tool with dto.preApproved does not show a dialog', async () => {
			const dialogService = new CountingDialogService({ confirmed: true });
			const setup = createTestToolsService(store, { dialogService });
			let invokeCompleted = false;
			const tool = registerToolForTest(setup.service, store, 'headlessPreApprovedTool', {
				invoke: async () => {
					invokeCompleted = true;
					return { content: [{ kind: 'text', value: 'success' }] };
				},
				prepareToolInvocation: async () => ({
					confirmationMessages: {
						title: 'Confirm this action?',
						message: 'This tool would normally require confirmation',
						allowAutoConfirm: true,
					},
				}),
			});
			const dto = tool.makeDto({ test: 1 });
			dto.preApproved = { type: ToolConfirmKind.Setting, id: 'autoApprove' };

			const result = await setup.service.invokeTool(dto, async () => 0, CancellationToken.None);

			assert.deepStrictEqual({
				invokeCompleted,
				value: (result.content[0] as IToolResultTextPart).value,
				confirmCalls: dialogService.confirmCalls,
			}, {
				invokeCompleted: true,
				value: 'success',
				confirmCalls: 0,
			});
		});

		test('a headless preToolUse hook ask overrides dto.preApproved', async () => {
			const dialogService = new CountingDialogService({ confirmed: true });
			const setup = createTestToolsService(store, { dialogService });
			const tool = registerToolForTest(setup.service, store, 'headlessPreApprovedAskTool', {
				invoke: async () => ({ content: [{ kind: 'text', value: 'success' }] }),
				prepareToolInvocation: async () => ({
					confirmationMessages: {
						title: 'Confirm this action?',
						message: 'This tool requires confirmation',
						allowAutoConfirm: true,
					},
				}),
			});
			const dto = tool.makeDto({ test: 1 });
			dto.preApproved = { type: ToolConfirmKind.Setting, id: 'autoApprove' };
			dto.preToolUseResult = { permissionDecision: 'ask', permissionDecisionReason: 'Requires user confirmation' };

			await setup.service.invokeTool(dto, async () => 0, CancellationToken.None);

			assert.strictEqual(dialogService.confirmCalls, 1);
		});
	});
});
