/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyValue, IContext } from '../../../../../platform/contextkey/common/contextkey.js';
import { KeepSessionAction2, UndoAndCloseSessionAction2, CancelSessionAction, ContinueInlineChatInChatViewAction, RephraseInlineChatSessionAction, } from '../../browser/inlineChatActions.js';
import { registerChatExecuteActions } from '../../../chat/browser/actions/chatExecuteActions.js';
import { registerChatContextActions } from '../../../chat/browser/actions/chatContextActions.js';
import { registerChatToolActions } from '../../../chat/browser/actions/chatToolActions.js';

suite('Inline chat zone widget — menu contributions', function () {

	const disposables = new DisposableStore();

	suiteSetup(() => {
		disposables.add(registerChatExecuteActions());
		disposables.add(registerChatContextActions());
		disposables.add(registerChatToolActions());

		disposables.add(registerAction2(KeepSessionAction2));
		disposables.add(registerAction2(UndoAndCloseSessionAction2));
		disposables.add(registerAction2(CancelSessionAction));
		disposables.add(registerAction2(ContinueInlineChatInChatViewAction));
		disposables.add(registerAction2(RephraseInlineChatSessionAction));
	});

	suiteTeardown(() => {
		disposables.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	const inlineChatBaseContext: Record<string, ContextKeyValue> = {
		'chatLocation': 'editor',
		'inlineChatHasEditsAgent': true,
		'quickChatHasFocus': false,
		// NOT in global editing session (this is inline chat, not panel edits)
		'chatEdits.isGlobalEditingSession': false,
		'lockedToCodingAgent': false,
		'chatIsEnabled': true,
		'chatAgentKind': 'ask',
	};

	function createContext(overrides: Record<string, ContextKeyValue> = {}): IContext {
		const values: Record<string, ContextKeyValue> = { ...inlineChatBaseContext, ...overrides };
		return { getValue: <T extends ContextKeyValue>(key: string): T | undefined => values[key] as T | undefined };
	}

	function visibleIds(menuId: MenuId, ctx: IContext): string[] {
		return MenuRegistry.getMenuItems(menuId)
			.filter(isIMenuItem)
			.filter(item => !item.when || item.when.evaluate(ctx))
			.map(item => item.command.id)
			.sort();
	}


	test('ChatEditorInlineExecute — idle, user has typed text', () => {
		const ctx = createContext({
			'chatInputHasText': true,
			'chatSessionHasActiveRequest': false,
			'chatEdits.isRequestInProgress': false,
			'chatEdits.hasEditorModifications': false,
		});
		assert.deepStrictEqual(visibleIds(MenuId.ChatEditorInlineExecute, ctx), [
			'inlineChat2.close',
			'workbench.action.chat.submit',
		].sort());
	});

	test('ChatEditorInlineExecute — request in progress', () => {
		const ctx = createContext({
			'chatEdits.isRequestInProgress': true,
			'chatSessionHasActiveRequest': true,
		});
		assert.deepStrictEqual(visibleIds(MenuId.ChatEditorInlineExecute, ctx), [
			'inlineChat2.close',
			'workbench.action.chat.cancel',
		].sort());
	});

	test('ChatEditorInlineExecute — terminated', () => {
		const ctx = createContext({
			'inlineChatTerminated': true,
			'chatEdits.hasEditorModifications': false,
			'chatEdits.isRequestInProgress': false,
			'chatSessionHasActiveRequest': false,
		});
		assert.deepStrictEqual(visibleIds(MenuId.ChatEditorInlineExecute, ctx), [
			'inlineChat2.close',
			'inlineChat2.continueInChat',
			'inlineChat2.rephrase',
			'workbench.action.chat.submit',
		].sort());
	});


	test('ChatEditorInlineInputSide — always empty', () => {
		const ctx = createContext();
		assert.deepStrictEqual(visibleIds(MenuId.ChatEditorInlineInputSide, ctx), []);
	});


	test('ChatInput — inline chat context must NOT show panel-only items', () => {
		const ctx = createContext({
			'agentSupportsAttachments': true,
		});
		const ids = visibleIds(MenuId.ChatInput, ctx);

		const panelOnlyCommands = [
			'workbench.action.chat.openModePicker',
			'workbench.action.chat.openSessionTargetPicker',
			'workbench.action.chat.openWorkspacePicker',
			'workbench.action.chat.chatSessionPrimaryPicker',
		];
		for (const cmd of panelOnlyCommands) {
			assert.ok(!ids.includes(cmd), `panel-only command "${cmd}" should NOT appear in inline chat`);
		}

		assert.ok(ids.includes('workbench.action.chat.attachContext'), 'attachContext should appear in inline chat');
	});

	test('ChatInput — panel context for comparison', () => {
		const ctx = createContext({
			'chatLocation': 'panel',
			'agentSupportsAttachments': true,
			'chatIsEnabled': true,
			'chatSessionHasCustomAgentTarget': true,
		});
		const ids = visibleIds(MenuId.ChatInput, ctx);

		assert.ok(ids.includes('workbench.action.chat.attachContext'), 'attachContext should appear in panel');
		assert.ok(ids.includes('workbench.action.chat.openModePicker'), 'openModePicker should appear in panel');
	});


	test('ChatExecute — inline chat idle with ask mode', () => {
		const ctx = createContext({
			'chatSessionHasActiveRequest': false,
			'withinEditSessionDiff': false,
		});
		const ids = visibleIds(MenuId.ChatExecute, ctx);
		assert.ok(ids.includes('workbench.action.chat.submit'), 'submit should appear');
		assert.ok(!ids.includes('workbench.action.chat.cancel'), 'cancel should NOT appear when idle');
		assert.ok(!ids.includes('workbench.action.edits.submit'), 'edits.submit should NOT appear in ask mode');
	});

	test('ChatExecute — inline chat request in progress', () => {
		const ctx = createContext({
			'chatSessionHasActiveRequest': true,
			'chatSessionCurrentlyEditing': false,
			'chatRemoteJobCreating': false,
		});
		const ids = visibleIds(MenuId.ChatExecute, ctx);
		assert.ok(ids.includes('workbench.action.chat.cancel'), 'cancel should appear during request');
		assert.ok(!ids.includes('workbench.action.chat.submit'), 'submit should NOT appear during request');
	});

	test('ChatExecute — quick chat items do NOT appear in inline chat', () => {
		const ctx = createContext({
			'quickChatHasFocus': false,
			'chatSessionHasActiveRequest': false,
		});
		const ids = visibleIds(MenuId.ChatExecute, ctx);
		assert.ok(!ids.includes('workbench.action.chat.attachContext'),
			'attachContext (quick chat variant) should NOT appear in inline chat');
	});
});
