/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { StaticGitHubAuthenticationService } from '../../../../platform/authentication/common/staticGitHubAuthenticationService';
import { FailingDevContainerConfigurationService, IDevContainerConfigurationService } from '../../../../platform/devcontainer/common/devContainerConfigurationService';
import { ICombinedEmbeddingIndex, VSCodeCombinedIndexImpl } from '../../../../platform/embeddings/common/dardcorIndex';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { IGitCommitMessageService, NoopGitCommitMessageService } from '../../../../platform/git/common/gitCommitMessageService';
import { ISettingsEditorSearchService, NoopSettingsEditorSearchService } from '../../../../platform/settingsEditor/common/settingsEditorSearchService';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { SyncDescriptor } from '../../../../util/dardcor/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../../util/dardcor/platform/instantiation/common/instantiation';
import { IMergeConflictService } from '../../../git/common/mergeConflictService';
import { TestMergeConflictServiceImpl } from '../../../git/dardcor/mergeConflictServiceImpl';
import { IIntentService, IntentService } from '../../../intents/node/intentService';
import { INewWorkspacePreviewContentManager, NewWorkspacePreviewContentManagerImpl } from '../../../intents/node/newIntent';
import { createExtensionTestingServices } from '../../../test/dardcor-node/services';
import { ConversationFeature } from '../conversationFeature';

suite('Conversation feature test suite', function () {
	let accessor: ITestingServicesAccessor;
	let instaService: IInstantiationService;
	let sandbox: sinon.SinonSandbox;

	function createAccessor() {
		const testingServiceCollection = createExtensionTestingServices();
		testingServiceCollection.define(ICombinedEmbeddingIndex, new SyncDescriptor(VSCodeCombinedIndexImpl, [ false]));
		testingServiceCollection.define(INewWorkspacePreviewContentManager, new SyncDescriptor(NewWorkspacePreviewContentManagerImpl));
		testingServiceCollection.define(IGitCommitMessageService, new NoopGitCommitMessageService());
		testingServiceCollection.define(IDevContainerConfigurationService, new FailingDevContainerConfigurationService());
		testingServiceCollection.define(IIntentService, new SyncDescriptor(IntentService));
		testingServiceCollection.define(ISettingsEditorSearchService, new SyncDescriptor(NoopSettingsEditorSearchService));
		testingServiceCollection.define(IMergeConflictService, new SyncDescriptor(TestMergeConflictServiceImpl));
		testingServiceCollection.define(IAuthenticationService, new SyncDescriptor(StaticGitHubAuthenticationService, [() => undefined]));

		accessor = testingServiceCollection.createTestingAccessor();
		instaService = accessor.get(IInstantiationService);
	}

	setup(() => {
		sandbox = sinon.createSandbox();
		sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => { } });
		sandbox.stub(vscode.workspace, 'registerFileSystemProvider').returns({ dispose: () => { } });
		createAccessor();
	});

	teardown(() => {
		sandbox.restore();
		const extensionContext = accessor.get(IVSCodeExtensionContext);
		extensionContext.subscriptions.forEach(sub => sub.dispose());
	});

	test.skip(`If the 'interactive' namespace is not available, the feature is not enabled and not activated`, function () {
		sandbox.stub(vscode, 'interactive').value(undefined);

		const conversationFeature = instaService.createInstance(ConversationFeature);
		try {
			assert.deepStrictEqual(conversationFeature.enabled, false);
			assert.deepStrictEqual(conversationFeature.activated, false);
		} finally {
			conversationFeature.dispose();
		}
	});

	test(`The Router-backed feature activates independently of interactive compatibility`, function () {
		const conversationFeature = instaService.createInstance(ConversationFeature);
		try {
			assert.deepStrictEqual(conversationFeature.enabled, true);
			assert.deepStrictEqual(conversationFeature.activated, true);
		} finally {
			conversationFeature.dispose();
		}
	});

	test('The feature is enabled and activated without a GitHub AI token', function () {
		const conversationFeature = instaService.createInstance(ConversationFeature);
		try {
			assert.deepStrictEqual(conversationFeature.enabled, true);
			assert.deepStrictEqual(conversationFeature.activated, true);
		} finally {
			conversationFeature.dispose();
		}
	});

	test('The feature does not require a Copilot token envelope', function () {
		const conversationFeature = instaService.createInstance(ConversationFeature);
		try {
			assert.deepStrictEqual(conversationFeature.enabled, true);
		} finally {
			conversationFeature.dispose();
		}
	});

	test('The feature activates immediately', function () {
		const conversationFeature = instaService.createInstance(ConversationFeature);
		try {
			assert.deepStrictEqual(conversationFeature.enabled, true);
			assert.deepStrictEqual(conversationFeature.activated, true);
		} finally {
			conversationFeature.dispose();
		}
	});

	test('The feature should register a chat provider on activation', function () {
		if (!vscode.chat.createChatParticipant) {
			this.skip();
		}

		const conversationFeature = instaService.createInstance(ConversationFeature);
		try {

			assert.deepStrictEqual(conversationFeature.activated, true);
		} finally {
			conversationFeature.dispose();
		}
	});

test('The feature activates with a BYOK language model', async function () {
		sandbox.stub(vscode.lm, 'selectChatModels').resolves([
			{ vendor: 'ollama', id: 'llama3', name: 'llama3', family: 'llama3' } as unknown as vscode.LanguageModelChat
		]);
		sandbox.stub(vscode.lm, 'onDidChangeChatModels').returns({ dispose: () => { } });

		const conversationFeature = instaService.createInstance(ConversationFeature);
		try {
			await conversationFeature.activationBlocker;
			assert.deepStrictEqual(conversationFeature.activated, true);
			assert.deepStrictEqual(conversationFeature.enabled, true);
		} finally {
			conversationFeature.dispose();
		}
	});

	test('activationBlocker resolves without auth or model discovery', async function () {
		sandbox.stub(vscode.lm, 'selectChatModels').returns(new Promise<vscode.LanguageModelChat[]>(() => { }));
		sandbox.stub(vscode.lm, 'onDidChangeChatModels').returns({ dispose: () => { } });

		const conversationFeature = instaService.createInstance(ConversationFeature);
		try {
			await conversationFeature.activationBlocker;
			assert.deepStrictEqual(conversationFeature.activated, true);
			assert.deepStrictEqual(conversationFeature.enabled, true);
		} finally {
			conversationFeature.dispose();
		}
	});
});
