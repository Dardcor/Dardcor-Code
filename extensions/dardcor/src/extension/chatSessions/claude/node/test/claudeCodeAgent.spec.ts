/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { CancellationToken, CancellationTokenSource } from '../../../../../util/dardcor/base/common/cancellation';
import { DisposableStore } from '../../../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../../../util/dardcor/base/common/uri';
import { IInstantiationService } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { ChatReferenceBinaryData } from '../../../../../dardcorTypes';
import { LanguageModelToolMCPSource } from '../../../../../util/common/test/shims/chatTypes';
import { IFileSystemService } from '../../../../../platform/filesystem/common/fileSystemService';
import type { MockFileSystemService } from '../../../../../platform/filesystem/node/test/mockFileSystemService';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { MockChatResponseStream, TestChatRequest } from '../../../../test/node/testHelpers';
import type { ClaudeFolderInfo } from '../../common/claudeFolderInfo';
import { ClaudeAgentManager, ClaudeCodeSession } from '../claudeCodeAgent';
import { IClaudeCodeSdkService } from '../claudeCodeSdkService';
import { ClaudeLanguageModelServer } from '../claudeLanguageModelServer';
import { parseClaudeModelId } from '../claudeModelId';
import type { ParsedClaudeModelId } from '../../common/claudeModelId';
import { IClaudeSessionStateService } from '../../common/claudeSessionStateService';
import { MockClaudeCodeSdkService } from './mockClaudeCodeSdkService';

function createMockLangModelServer(): ClaudeLanguageModelServer {
	return {
		incrementUserInitiatedMessageCount: vi.fn(),
		getConfig: () => ({ port: 8080, nonce: 'test-nonce' }),
	} as unknown as ClaudeLanguageModelServer;
}

function createMockChatRequest(prompt = ''): vscode.ChatRequest {
	return { prompt, references: [], tools: new Map(), id: 'test-request-id', toolInvocationToken: {} } as unknown as vscode.ChatRequest;
}

const TEST_MODEL_ID = parseClaudeModelId('claude-3-sonnet');
const TEST_MODEL_ID_ALT = parseClaudeModelId('claude-3-opus');
const TEST_PERMISSION_MODE = 'acceptEdits' as const;
const TEST_FOLDER_INFO: ClaudeFolderInfo = { cwd: '/test/project', additionalDirectories: [] };
const TEST_SESSION_ID = 'test-session-id';

function commitTestState(
	sessionStateService: IClaudeSessionStateService,
	sessionId: string,
	modelId: ParsedClaudeModelId | undefined = TEST_MODEL_ID,
	permissionMode: PermissionMode = TEST_PERMISSION_MODE,
	folderInfo: ClaudeFolderInfo = TEST_FOLDER_INFO,
): void {
	sessionStateService.setModelIdForSession(sessionId, modelId);
	sessionStateService.setPermissionModeForSession(sessionId, permissionMode);
	sessionStateService.setFolderInfoForSession(sessionId, folderInfo);
}

describe('ClaudeAgentManager', () => {
	const store = new DisposableStore();
	let instantiationService: IInstantiationService;
	let mockService: MockClaudeCodeSdkService;
	let sessionStateService: IClaudeSessionStateService;

	beforeEach(() => {
		const services = store.add(createExtensionUnitTestingServices());
		const accessor = services.createTestingAccessor();
		instantiationService = accessor.get(IInstantiationService);

		mockService = accessor.get(IClaudeCodeSdkService) as MockClaudeCodeSdkService;
		mockService.queryCallCount = 0;

		sessionStateService = accessor.get(IClaudeSessionStateService);
	});

	afterEach(() => {
		store.clear();
		vi.resetAllMocks();
	});

	it('reuses a live session across requests and streams assistant text', async () => {
		const manager = instantiationService.createInstance(ClaudeAgentManager);

		const stream1 = new MockChatResponseStream();

		commitTestState(sessionStateService, TEST_SESSION_ID);
		const req1 = new TestChatRequest('Hi');
		await manager.handleRequest(TEST_SESSION_ID, req1, stream1, CancellationToken.None, true);

		expect(stream1.output.join('\n')).toContain('Hello from mock!');

		const stream2 = new MockChatResponseStream();

		const req2 = new TestChatRequest('Again');
		await manager.handleRequest(TEST_SESSION_ID, req2, stream2, CancellationToken.None, false);

		expect(stream2.output.join('\n')).toContain('Hello from mock!');

		expect(mockService.queryCallCount).toBe(1);
	});

	it('resolves image references as ImageBlockParam content blocks', async () => {
		const manager = instantiationService.createInstance(ClaudeAgentManager);
		const stream = new MockChatResponseStream();

		const imageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
		const imageRef: vscode.ChatPromptReference = {
			id: 'image-1',
			name: 'image-1',
			value: new ChatReferenceBinaryData('image/png', () => Promise.resolve(imageData)),
		};
		commitTestState(sessionStateService, TEST_SESSION_ID);
		const req = new TestChatRequest('What is in this image?', [imageRef]);
		await manager.handleRequest(TEST_SESSION_ID, req, stream, CancellationToken.None, true);

		expect(mockService.receivedMessages).toHaveLength(1);
		const content = mockService.receivedMessages[0].message.content;
		expect(Array.isArray(content)).toBe(true);

		const blocks = content as Anthropic.ContentBlockParam[];
		const imageBlocks = blocks.filter(b => b.type === 'image');
		expect(imageBlocks).toHaveLength(1);

		const imageBlock = imageBlocks[0] as Anthropic.ImageBlockParam;
		expect(imageBlock.source.type).toBe('base64');
		const source = imageBlock.source as Anthropic.Base64ImageSource;
		expect(source.media_type).toBe('image/png');
		expect(source.data).toBe(Buffer.from(imageData).toString('base64'));

		const textBlocks = blocks.filter(b => b.type === 'text') as Anthropic.TextBlockParam[];
		expect(textBlocks.some(b => b.text === 'What is in this image?')).toBe(true);
	});

	it('normalizes image/jpg to image/jpeg', async () => {
		const manager = instantiationService.createInstance(ClaudeAgentManager);
		const stream = new MockChatResponseStream();

		const imageRef: vscode.ChatPromptReference = {
			id: 'image-1',
			name: 'image-1',
			value: new ChatReferenceBinaryData('image/jpg', () => Promise.resolve(new Uint8Array([0xFF, 0xD8]))),
		};
		commitTestState(sessionStateService, TEST_SESSION_ID);
		const req = new TestChatRequest('Describe this', [imageRef]);
		await manager.handleRequest(TEST_SESSION_ID, req, stream, CancellationToken.None, true);

		const blocks = mockService.receivedMessages[0].message.content as Anthropic.ContentBlockParam[];
		const imageBlock = blocks.find(b => b.type === 'image') as Anthropic.ImageBlockParam;
		expect(imageBlock).toBeDefined();
		expect((imageBlock.source as Anthropic.Base64ImageSource).media_type).toBe('image/jpeg');
	});

	it('skips unsupported image MIME types', async () => {
		const manager = instantiationService.createInstance(ClaudeAgentManager);
		const stream = new MockChatResponseStream();

		const imageRef: vscode.ChatPromptReference = {
			id: 'image-1',
			name: 'image-1',
			value: new ChatReferenceBinaryData('image/bmp', () => Promise.resolve(new Uint8Array([0x42, 0x4D]))),
		};
		commitTestState(sessionStateService, TEST_SESSION_ID);
		const req = new TestChatRequest('Describe this', [imageRef]);
		await manager.handleRequest(TEST_SESSION_ID, req, stream, CancellationToken.None, true);

		const blocks = mockService.receivedMessages[0].message.content as Anthropic.ContentBlockParam[];
		const imageBlocks = blocks.filter(b => b.type === 'image');
		expect(imageBlocks).toHaveLength(0);
	});

	it('handles mixed image and file references', async () => {
		const manager = instantiationService.createInstance(ClaudeAgentManager);
		const stream = new MockChatResponseStream();

		const imageRef: vscode.ChatPromptReference = {
			id: 'image-1',
			name: 'image-1',
			value: new ChatReferenceBinaryData('image/png', () => Promise.resolve(new Uint8Array([0x89]))),
		};
		const fileUri = URI.file('/test/file.ts');
		const fileRef: vscode.ChatPromptReference = {
			id: 'file-1',
			name: 'file-1',
			value: fileUri,
		};
		commitTestState(sessionStateService, TEST_SESSION_ID);
		const req = new TestChatRequest('Explain both', [imageRef, fileRef]);
		await manager.handleRequest(TEST_SESSION_ID, req, stream, CancellationToken.None, true);

		const blocks = mockService.receivedMessages[0].message.content as Anthropic.ContentBlockParam[];
		const imageBlocks = blocks.filter(b => b.type === 'image');
		const textBlocks = blocks.filter(b => b.type === 'text') as Anthropic.TextBlockParam[];
		expect(imageBlocks).toHaveLength(1);
		expect(textBlocks.some(b => b.text.includes(fileUri.fsPath))).toBe(true);
		expect(textBlocks.some(b => b.text === 'Explain both')).toBe(true);
	});
});

describe('ClaudeCodeSession', () => {
	const store = new DisposableStore();
	let instantiationService: IInstantiationService;
	let sessionStateService: IClaudeSessionStateService;

	beforeEach(() => {
		const services = store.add(createExtensionUnitTestingServices());
		const accessor = services.createTestingAccessor();
		instantiationService = accessor.get(IInstantiationService);
		sessionStateService = accessor.get(IClaudeSessionStateService);
	});

	afterEach(() => {
		store.clear();
		vi.resetAllMocks();
	});

	it('processes a single request correctly', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));
		const stream = new MockChatResponseStream();

		await session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None);

		expect(stream.output.join('\n')).toContain('Hello from mock!');
	});

	it('queues multiple requests and processes them sequentially', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		const stream2 = new MockChatResponseStream();

		const promise1 = session.invoke(createMockChatRequest('First'), stream1, undefined, CancellationToken.None);
		const promise2 = session.invoke(createMockChatRequest('Second'), stream2, undefined, CancellationToken.None);

		await Promise.all([promise1, promise2]);

		expect(stream1.output.join('\n')).toContain('Hello from mock!');
		expect(stream2.output.join('\n')).toContain('Hello from mock!');
	});

	it('cancels pending requests when cancelled', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));
		const stream = new MockChatResponseStream();
		const source = new CancellationTokenSource();
		source.cancel();

		await expect(session.invoke(createMockChatRequest('Hello'), stream, undefined, source.token)).rejects.toThrow();
	});

	it('cleans up resources when disposed', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true);

		session.dispose();

		const stream = new MockChatResponseStream();
		await expect(session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None))
			.rejects.toThrow('Session disposed');
	});

	it('handles multiple sessions with different session IDs', async () => {
		const mockServer1 = createMockLangModelServer();
		const mockServer2 = createMockLangModelServer();
		commitTestState(sessionStateService, 'session-1');
		commitTestState(sessionStateService, 'session-2');
		const session1 = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer1, 'session-1', true));
		const session2 = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer2, 'session-2', true));

		expect(session1.sessionId).toBe('session-1');
		expect(session2.sessionId).toBe('session-2');

		const stream1 = new MockChatResponseStream();
		const stream2 = new MockChatResponseStream();

		await Promise.all([
			session1.invoke(createMockChatRequest('Hello from session 1'), stream1, undefined, CancellationToken.None),
			session2.invoke(createMockChatRequest('Hello from session 2'), stream2, undefined, CancellationToken.None)
		]);

		expect(stream1.output.join('\n')).toContain('Hello from mock!');
		expect(stream2.output.join('\n')).toContain('Hello from mock!');
	});

	it('initializes with model ID from constructor', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID_ALT);
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));
		const stream = new MockChatResponseStream();

		await session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None);

		expect(stream.output.join('\n')).toContain('Hello from mock!');
	});

	it('calls setModel when model changes instead of restarting session', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;
		mockService.queryCallCount = 0;
		mockService.setModelCallCount = 0;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID);
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);

		sessionStateService.setModelIdForSession('test-session', TEST_MODEL_ID_ALT);

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);
		expect(mockService.setModelCallCount).toBe(1);
		expect(mockService.lastSetModel).toBe(TEST_MODEL_ID_ALT.toSdkModelId());
	});

	it('does not restart session when same model is used', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;
		mockService.queryCallCount = 0;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID);
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);
	});

	it('uses session state model for initial Options when starting a new session', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID_ALT);
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));
		const stream = new MockChatResponseStream();

		await session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None);

		expect(mockService.lastQueryOptions?.model).toBe(TEST_MODEL_ID_ALT.toSdkModelId());
	});

	it('uses session state permission mode for initial Options when starting a new session', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID, 'bypassPermissions');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));
		const stream = new MockChatResponseStream();

		await session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None);

		expect(mockService.lastQueryOptions?.permissionMode).toBe('bypassPermissions');
	});

	it('does not call setModel when model has not changed', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;
		mockService.setModelCallCount = 0;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID);
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);

		expect(mockService.setModelCallCount).toBe(0);
	});

	it('does not call setPermissionMode when permission mode has not changed', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;
		mockService.setPermissionModeCallCount = 0;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID, 'acceptEdits');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);

		expect(mockService.setPermissionModeCallCount).toBe(0);
	});

	it('calls setPermissionMode when permission mode changes', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;
		mockService.setPermissionModeCallCount = 0;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID, 'acceptEdits');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);

		sessionStateService.setPermissionModeForSession('test-session', 'bypassPermissions');

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);

		expect(mockService.setPermissionModeCallCount).toBe(1);
		expect(mockService.lastSetPermissionMode).toBe('bypassPermissions');
	});

	it('passes sessionId in SDK options for new sessions', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;

		commitTestState(sessionStateService, 'new-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'new-session', true));
		const stream = new MockChatResponseStream();

		await session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None);

		expect(mockService.lastQueryOptions?.sessionId).toBe('new-session');
		expect(mockService.lastQueryOptions?.resume).toBeUndefined();
	});

	it('passes resume in SDK options for resumed sessions', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;

		commitTestState(sessionStateService, 'existing-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'existing-session', false));
		const stream = new MockChatResponseStream();

		await session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None);

		expect(mockService.lastQueryOptions?.resume).toBe('existing-session');
		expect(mockService.lastQueryOptions?.sessionId).toBeUndefined();
	});

	it('passes effort in SDK options when reasoning effort is set in session state', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID);
		sessionStateService.setReasoningEffortForSession('test-session', 'low');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));
		const stream = new MockChatResponseStream();

		await session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None);

		expect(mockService.lastQueryOptions?.effort).toBe('low');
	});

	it('does not include effort in SDK options when reasoning effort is not set', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID);
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));
		const stream = new MockChatResponseStream();

		await session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None);

		expect(mockService.lastQueryOptions?.effort).toBeUndefined();
	});

	it('calls applyFlagSettings when effort level changes instead of restarting session', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;
		mockService.queryCallCount = 0;
		mockService.applyFlagSettingsCallCount = 0;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID);
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);

		sessionStateService.setReasoningEffortForSession('test-session', 'high');

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);
		expect(mockService.applyFlagSettingsCallCount).toBe(1);
		expect(mockService.lastAppliedFlagSettings).toEqual({ effortLevel: 'high' });
	});

	it('does not call applyFlagSettings when effort level is unchanged', async () => {
		const mockServer = createMockLangModelServer();
		const mockService = instantiationService.invokeFunction(accessor => accessor.get(IClaudeCodeSdkService)) as MockClaudeCodeSdkService;
		mockService.queryCallCount = 0;
		mockService.applyFlagSettingsCallCount = 0;

		commitTestState(sessionStateService, 'test-session', TEST_MODEL_ID);
		sessionStateService.setReasoningEffortForSession('test-session', 'medium');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);
		expect(mockService.applyFlagSettingsCallCount).toBe(0);
	});
});

describe('ClaudeAgentManager - error handling', () => {
	const store = new DisposableStore();
	let instantiationService: IInstantiationService;

	beforeEach(() => {
		const services = store.add(createExtensionUnitTestingServices());
		const accessor = services.createTestingAccessor();
		instantiationService = accessor.get(IInstantiationService);
	});

	afterEach(() => {
		store.clear();
		vi.resetAllMocks();
	});

	it('throws when session state has not been committed', async () => {
		const manager = instantiationService.createInstance(ClaudeAgentManager);
		const stream = new MockChatResponseStream();

		const req = new TestChatRequest('Hello');
		const result = await manager.handleRequest('no-state-session', req, stream, CancellationToken.None, true);

		expect(result.errorDetails).toBeDefined();
	});
});

describe('ClaudeCodeSession - yield flow', () => {
	const store = new DisposableStore();
	let instantiationService: IInstantiationService;
	let sessionStateService: IClaudeSessionStateService;
	let mockService: MockClaudeCodeSdkService;

	beforeEach(() => {
		const services = store.add(createExtensionUnitTestingServices());
		const accessor = services.createTestingAccessor();
		instantiationService = accessor.get(IInstantiationService);
		sessionStateService = accessor.get(IClaudeSessionStateService);
		mockService = accessor.get(IClaudeCodeSdkService) as MockClaudeCodeSdkService;
		mockService.queryCallCount = 0;
	});

	afterEach(() => {
		store.clear();
		vi.resetAllMocks();
	});

	it('yield completes the current request while session continues', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		const promise1 = session.invoke(createMockChatRequest('First'), stream1, () => true, CancellationToken.None);
		await promise1;

		const stream2 = new MockChatResponseStream();
		const promise2 = session.invoke(createMockChatRequest('Second'), stream2, undefined, CancellationToken.None);
		await promise2;

		expect(stream2.output.join('\n')).toContain('Hello from mock!');
		expect(mockService.queryCallCount).toBe(1);
	});

	it('second request after yield uses priority now', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('First'), stream1, () => true, CancellationToken.None);

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Second'), stream2, undefined, CancellationToken.None);

		expect(mockService.receivedMessages.length).toBeGreaterThanOrEqual(2);
		expect(mockService.receivedMessages[1].priority).toBe('now');
	});

	it('multiple yield cycles work correctly', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const streamA = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('A'), streamA, () => true, CancellationToken.None);

		const streamB = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('B'), streamB, () => true, CancellationToken.None);

		const streamC = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('C'), streamC, undefined, CancellationToken.None);

		expect(streamC.output.join('\n')).toContain('Hello from mock!');
		expect(mockService.queryCallCount).toBe(1);
		expect(mockService.receivedMessages).toHaveLength(3);
	});
});

describe('ClaudeCodeSession - settings change restart', () => {
	const store = new DisposableStore();
	let instantiationService: IInstantiationService;
	let sessionStateService: IClaudeSessionStateService;
	let mockService: MockClaudeCodeSdkService;
	let mockFs: MockFileSystemService;

	beforeEach(() => {
		const services = store.add(createExtensionUnitTestingServices());
		const accessor = services.createTestingAccessor();
		instantiationService = accessor.get(IInstantiationService);
		sessionStateService = accessor.get(IClaudeSessionStateService);
		mockService = accessor.get(IClaudeCodeSdkService) as MockClaudeCodeSdkService;
		mockService.queryCallCount = 0;
		mockFs = accessor.get(IFileSystemService) as MockFileSystemService;
	});

	afterEach(() => {
		store.clear();
		vi.resetAllMocks();
	});

	it('restarts session when settings files change between requests', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);

		const claudeMdUri = URI.joinPath(URI.file('/home/testuser'), '.claude', 'CLAUDE.md');
		mockFs.mockFile(claudeMdUri, '# Instructions', 2000);

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(2);
	});

	it('uses resume after settings change restart', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);
		expect(mockService.lastQueryOptions?.sessionId).toBe('test-session');

		const claudeMdUri = URI.joinPath(URI.file('/home/testuser'), '.claude', 'CLAUDE.md');
		mockFs.mockFile(claudeMdUri, '# Instructions', 2000);

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);
		expect(mockService.lastQueryOptions?.resume).toBe('test-session');
		expect(mockService.lastQueryOptions?.sessionId).toBeUndefined();
	});

	it('does not restart when settings files have not changed', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);
	});
});

describe('ClaudeCodeSession - tools restart', () => {
	const store = new DisposableStore();
	let instantiationService: IInstantiationService;
	let sessionStateService: IClaudeSessionStateService;
	let mockService: MockClaudeCodeSdkService;

	beforeEach(() => {
		const services = store.add(createExtensionUnitTestingServices());
		const accessor = services.createTestingAccessor();
		instantiationService = accessor.get(IInstantiationService);
		sessionStateService = accessor.get(IClaudeSessionStateService);
		mockService = accessor.get(IClaudeCodeSdkService) as MockClaudeCodeSdkService;
		mockService.queryCallCount = 0;
	});

	afterEach(() => {
		store.clear();
		vi.resetAllMocks();
	});

	it('hot-swaps effort instead of restarting the session', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);
		expect(mockService.lastQueryOptions?.sessionId).toBe('test-session');
		expect(mockService.queryCallCount).toBe(1);

		sessionStateService.setReasoningEffortForSession('test-session', 'high');

		const stream2 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello again'), stream2, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);
		expect(mockService.applyFlagSettingsCallCount).toBe(1);
		expect(mockService.lastAppliedFlagSettings).toEqual({ effortLevel: 'high' });
	});

	it('restarts session when MCP tools change', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const stream1 = new MockChatResponseStream();
		await session.invoke(createMockChatRequest('Hello'), stream1, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);

		const stream2 = new MockChatResponseStream();
		const mcpTool = { name: 'mcp-tool', source: new LanguageModelToolMCPSource('test-server', 'test-server', undefined) } as unknown as vscode.LanguageModelChatTool;
		const reqWithTool: vscode.ChatRequest = {
			prompt: 'Hello again',
			references: [],
			tools: new Map([[mcpTool, true]]),
			id: 'test-request-2',
			toolInvocationToken: {}
		} as unknown as vscode.ChatRequest;
		await session.invoke(reqWithTool, stream2, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(2);
	});

	it('does not restart when MCP tools are unchanged', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = store.add(instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true));

		const mcpTool = { name: 'mcp-tool', source: new LanguageModelToolMCPSource('test-server', 'test-server', undefined) } as unknown as vscode.LanguageModelChatTool;
		const makeReq = () => ({
			prompt: 'Hello',
			references: [],
			tools: new Map([[mcpTool, true]]),
			id: 'test-request',
			toolInvocationToken: {}
		} as unknown as vscode.ChatRequest);

		const stream1 = new MockChatResponseStream();
		await session.invoke(makeReq(), stream1, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);

		const stream2 = new MockChatResponseStream();
		await session.invoke(makeReq(), stream2, undefined, CancellationToken.None);
		expect(mockService.queryCallCount).toBe(1);
	});
});

describe('ClaudeCodeSession - edge cases', () => {
	const store = new DisposableStore();
	let instantiationService: IInstantiationService;
	let sessionStateService: IClaudeSessionStateService;

	beforeEach(() => {
		const services = store.add(createExtensionUnitTestingServices());
		const accessor = services.createTestingAccessor();
		instantiationService = accessor.get(IInstantiationService);
		sessionStateService = accessor.get(IClaudeSessionStateService);
	});

	afterEach(() => {
		store.clear();
		vi.resetAllMocks();
	});

	it('rejects in-flight requests when disposed', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true);

		const stream = new MockChatResponseStream();
		const promise = session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None);

		session.dispose();

		await expect(promise).rejects.toThrow();
	});

	it('rejects new requests after dispose', async () => {
		const mockServer = createMockLangModelServer();
		commitTestState(sessionStateService, 'test-session');
		const session = instantiationService.createInstance(ClaudeCodeSession, mockServer, 'test-session', true);
		session.dispose();

		const stream = new MockChatResponseStream();
		await expect(
			session.invoke(createMockChatRequest('Hello'), stream, undefined, CancellationToken.None)
		).rejects.toThrow('Session disposed');
	});
});
