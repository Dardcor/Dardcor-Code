/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ActiveEditorContext } from '../../../../common/contextkeys.js';
import { ViewContainerLocation } from '../../../../common/views.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { ACTIVE_GROUP, IEditorService } from '../../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { isChatViewTitleActionContext } from '../../common/actions/chatActions.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { ChatAgentLocation } from '../../common/constants.js';
import { ChatViewId, IChatWidgetService } from '../chat.js';
import { ChatEditor, IChatEditorOptions } from '../widgetHosts/editor/chatEditor.js';
import { ChatEditorInput } from '../widgetHosts/editor/chatEditorInput.js';
import { ChatViewPane } from '../widgetHosts/viewPane/chatViewPane.js';
import { CHAT_CATEGORY } from './chatActions.js';

export function registerMoveActions() {
	registerAction2(class GlobalMoveToEditorAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.chat.openInEditor',
				title: localize2('chat.openInEditor.label', "Move Chat into Editor Area"),
				category: CHAT_CATEGORY,
				precondition: ChatContextKeys.enabled,
				f1: true,
				menu: {
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.equals('view', ChatViewId),
					order: 0,
					group: '1_open'
				},
			});
		}

		async run(accessor: ServicesAccessor, ...args: unknown[]) {
			const context = args[0];
			executeMoveToAction(accessor, isChatViewTitleActionContext(context) ? context.sessionResource : undefined);
		}
	});

	registerAction2(class GlobalMoveToSidebarAction extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.chat.openInSidebar',
				title: localize2('interactiveSession.openInSidebar.label', "Move Chat into Side Bar"),
				category: CHAT_CATEGORY,
				precondition: ChatContextKeys.enabled,
				f1: true
			});
		}

		async run(accessor: ServicesAccessor, ...args: unknown[]) {
			return moveToSidebar(accessor);
		}
	});

	function appendOpenChatInViewMenuItem(menuId: MenuId, title: string, icon: ThemeIcon, locationContextKey: ContextKeyExpression) {
		MenuRegistry.appendMenuItem(menuId, {
			command: { id: 'workbench.action.chat.openInSidebar', title, icon },
			when: ContextKeyExpr.and(
				ActiveEditorContext.isEqualTo(ChatEditorInput.EditorID),
				locationContextKey
			),
			group: menuId === MenuId.CompactWindowEditorTitle ? 'navigation' : undefined,
			order: 0
		});
	}

	[MenuId.EditorTitle, MenuId.CompactWindowEditorTitle].forEach(id => {
		appendOpenChatInViewMenuItem(id, localize('interactiveSession.openInSecondarySidebar.label', "Move Chat into Secondary Side Bar"), Codicon.layoutSidebarRightDock, ChatContextKeys.panelLocation.isEqualTo(ViewContainerLocation.AuxiliaryBar));
		appendOpenChatInViewMenuItem(id, localize('interactiveSession.openInPrimarySidebar.label', "Move Chat into Primary Side Bar"), Codicon.layoutSidebarLeftDock, ChatContextKeys.panelLocation.isEqualTo(ViewContainerLocation.Sidebar));
		appendOpenChatInViewMenuItem(id, localize('interactiveSession.openInPanel.label', "Move Chat into Panel"), Codicon.layoutPanelDock, ChatContextKeys.panelLocation.isEqualTo(ViewContainerLocation.Panel));
	});
}

async function executeMoveToAction(accessor: ServicesAccessor, sessionResource?: URI) {
	const widgetService = accessor.get(IChatWidgetService);

	const widget = (sessionResource ? widgetService.getWidgetBySessionResource(sessionResource) : undefined)
		?? widgetService.lastFocusedWidget;
	if (!widget || !widget.viewModel || widget.location !== ChatAgentLocation.Chat) {
		await widgetService.openSession(ChatEditorInput.getNewEditorUri(), ACTIVE_GROUP, { pinned: true });
		return;
	}

	const existingWidget = widgetService.getWidgetBySessionResource(widget.viewModel.sessionResource);
	if (!existingWidget) {
		await widgetService.openSession(ChatEditorInput.getNewEditorUri(), ACTIVE_GROUP, { pinned: true });
		return;
	}

	const resourceToOpen = widget.viewModel.sessionResource;

	const modelInputState = existingWidget.getInputState();

	await widget.clear();

	const options: IChatEditorOptions = { pinned: true, modelInputState };
	await widgetService.openSession(resourceToOpen, ACTIVE_GROUP, options);
}

async function moveToSidebar(accessor: ServicesAccessor): Promise<void> {
	const viewsService = accessor.get(IViewsService);
	const editorService = accessor.get(IEditorService);
	const editorGroupService = accessor.get(IEditorGroupsService);

	const chatEditor = editorService.activeEditorPane;
	const chatEditorInput = chatEditor?.input;
	let view: ChatViewPane;
	if (chatEditor instanceof ChatEditor && chatEditorInput instanceof ChatEditorInput && chatEditorInput.sessionResource) {
		const previousInputState = chatEditor.widget.getInputState();
		await editorService.closeEditor({ editor: chatEditor.input, groupId: editorGroupService.activeGroup.id });
		view = await viewsService.openView(ChatViewId) as ChatViewPane;

		const newModel = await view.loadSession(chatEditorInput.sessionResource);
		if (previousInputState && newModel && !newModel.inputModel.state.get()) {
			newModel.inputModel.setState(previousInputState);
		}
	} else {
		view = await viewsService.openView(ChatViewId) as ChatViewPane;
	}

	view.focus();
}
