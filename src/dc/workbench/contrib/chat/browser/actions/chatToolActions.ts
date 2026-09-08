/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Iterable } from '../../../../../base/common/iterator.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { ConfirmedReason, IChatToolInvocation, ToolConfirmKind } from '../../common/chatService/chatService.js';
import { isResponseVM } from '../../common/model/chatViewModel.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind } from '../../common/constants.js';
import { IChatWidget, IChatWidgetService } from '../chat.js';
import { ToolsScope } from '../widget/input/chatSelectedTools.js';
import { CHAT_CATEGORY } from './chatActions.js';
import { showToolsPicker } from './chatToolPicker.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../../platform/quickinput/common/quickInput.js';
import { IChatMode } from '../../common/chatModes.js';
import { IToggleChatModeArgs, ToggleAgentModeActionId } from './chatExecuteActions.js';


type SelectedToolData = {
	enabled: number;
	total: number;
};
type SelectedToolClassification = {
	owner: 'connor4312';
	comment: 'Details the capabilities of the MCP server';
	enabled: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Number of enabled chat tools' };
	total: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Number of total chat tools' };
};

export const AcceptToolConfirmationActionId = 'workbench.action.chat.acceptTool';
export const SkipToolConfirmationActionId = 'workbench.action.chat.skipTool';
export const AcceptToolPostConfirmationActionId = 'workbench.action.chat.acceptToolPostExecution';
export const SkipToolPostConfirmationActionId = 'workbench.action.chat.skipToolPostExecution';

export interface IToolConfirmationActionContext {
	readonly sessionResource?: URI;
}

abstract class ToolConfirmationAction extends Action2 {
	protected abstract getReason(): ConfirmedReason;

	run(accessor: ServicesAccessor, context?: IToolConfirmationActionContext) {
		const chatWidgetService = accessor.get(IChatWidgetService);
		const widget = context?.sessionResource
			? chatWidgetService.getWidgetBySessionResource(context.sessionResource)
			: chatWidgetService.lastFocusedWidget;
		const lastItem = widget?.viewModel?.getItems().at(-1);
		if (!isResponseVM(lastItem)) {
			return;
		}

		for (const item of lastItem.model.response.value) {
			const state = item.kind === 'toolInvocation' ? item.state.get() : undefined;
			if (state?.type === IChatToolInvocation.StateKind.WaitingForConfirmation || state?.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
				state.confirm(this.getReason());
				break;
			}
		}

		// Return focus to the chat input, in case it was in the tool confirmation editor
		widget?.focusInput();
	}
}

class AcceptToolConfirmation extends ToolConfirmationAction {
	constructor() {
		super({
			id: AcceptToolConfirmationActionId,
			title: localize2('chat.accept', "Accept"),
			f1: false,
			category: CHAT_CATEGORY,
			keybinding: {
				when: ContextKeyExpr.and(ChatContextKeys.inChatSession, ChatContextKeys.Editing.hasToolConfirmation),
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
				// Override chatEditor.action.accept
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	protected override getReason(): ConfirmedReason {
		return { type: ToolConfirmKind.UserAction };
	}
}

class SkipToolConfirmation extends ToolConfirmationAction {
	constructor() {
		super({
			id: SkipToolConfirmationActionId,
			title: localize2('chat.skip', "Skip"),
			f1: false,
			category: CHAT_CATEGORY,
			keybinding: {
				when: ContextKeyExpr.and(ChatContextKeys.inChatSession, ChatContextKeys.Editing.hasToolConfirmation),
				primary: KeyMod.CtrlCmd | KeyCode.Enter | KeyMod.Alt,
				// Override chatEditor.action.accept
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	protected override getReason(): ConfirmedReason {
		return { type: ToolConfirmKind.Skipped };
	}
}

export class ConfigureToolsAction extends Action2 {
	public static ID = 'workbench.action.chat.configureTools';

	constructor() {
		super({
			id: ConfigureToolsAction.ID,
			title: localize('label', "Configure Tools..."),
			icon: Codicon.settingsCompact,
			f1: false,
			category: CHAT_CATEGORY,
			precondition: ChatContextKeys.enabled,
			menu: [{
				when: ContextKeyExpr.and(
					ChatContextKeys.enabled,
					ChatContextKeys.location.isEqualTo(ChatAgentLocation.Chat),
					ChatContextKeys.inQuickChat.negate(),
					ChatContextKeys.lockedToCodingAgent.negate(),
					ChatContextKeys.inChatInputWindow.negate(),
				),
				id: MenuId.ChatInput,
				group: 'navigation',
				order: -0.5,
			}]
		});
	}

	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {

		const instaService = accessor.get(IInstantiationService);
		const chatWidgetService = accessor.get(IChatWidgetService);
		const telemetryService = accessor.get(ITelemetryService);
		const quickInputService = accessor.get(IQuickInputService);
		const commandService = accessor.get(ICommandService);
		const configurationService = accessor.get(IConfigurationService);

		let widget = chatWidgetService.lastFocusedWidget;
		if (!widget) {
			widget = this.extractWidget(args);
		}

		if (!widget) {
			return;
		}

		const source = this.extractSource(args) ?? 'chatInput';

		const options = args[0] as { openToolsDirectly?: boolean } | undefined;
		if (options?.openToolsDirectly) {
			await this.openToolsPicker(instaService, widget, source, telemetryService);
			return;
		}

		const currentMode = widget.input.currentModeObs.get();
		const currentModes = widget.input.currentChatModesObs.get();
		const agentModeDisabledViaPolicy = configurationService.inspect<boolean>(ChatConfiguration.AgentEnabled).policyValue === false;

		interface IConfigureOptionItem extends IQuickPickItem {
			actionType: 'mode' | 'customAgent' | 'configureCustomAgents' | 'configureTools';
			mode?: IChatMode;
		}

		const items: (IConfigureOptionItem | IQuickPickSeparator)[] = [];

		items.push({
			type: 'separator',
			label: localize('chat.configure.agentHeader', "Agent (Active: {0})", currentMode.label.get()),
		});

		for (const mode of currentModes.builtin) {
			const isCurrent = mode.id === currentMode.id;
			let icon = mode.icon.get();
			if (!icon) {
				if (mode.kind === ChatModeKind.Ask) {
					icon = Codicon.question;
				} else if (mode.kind === ChatModeKind.Edit) {
					icon = Codicon.edit;
				} else {
					icon = Codicon.agent;
				}
			}
			const isDisabled = mode.kind === ChatModeKind.Agent && agentModeDisabledViaPolicy;
			items.push({
				label: isCurrent ? `$(${icon.id}) ${mode.label.get()} $(check)` : `$(${icon.id}) ${mode.label.get()}`,
				description: isCurrent ? localize('currentActiveAgent', "Active") : undefined,
				detail: mode.description.get(),
				actionType: 'mode',
				mode,
				disabled: isDisabled,
			});
		}

		if (currentModes.custom.length > 0) {
			for (const mode of currentModes.custom) {
				const isCurrent = mode.id === currentMode.id;
				const icon = mode.icon.get() ?? Codicon.agent;
				items.push({
					label: isCurrent ? `$(${icon.id}) ${mode.label.get()} $(check)` : `$(${icon.id}) ${mode.label.get()}`,
					description: isCurrent ? localize('currentActiveAgent', "Active") : undefined,
					detail: mode.description.get(),
					actionType: 'customAgent',
					mode,
				});
			}
		}

		items.push({
			label: `$(${Codicon.gear.id}) ${localize('chat.configureCustomAgents', "Configure Custom Agents...")}`,
			description: localize('chat.configureCustomAgents.desc', "Manage custom agent definitions"),
			actionType: 'configureCustomAgents',
		});

		items.push({
			type: 'separator',
			label: localize('chat.configure.toolsHeader', "Tools"),
		});

		items.push({
			label: `$(${Codicon.tools.id}) ${localize('chat.configureTools', "Configure Tools...")}`,
			description: localize('chat.configureTools.desc', "Select tools and MCP servers available to chat"),
			detail: localize('chat.configureTools.detail', "Enable or disable tools for this agent/session"),
			actionType: 'configureTools',
		});

		const quickPick = quickInputService.createQuickPick<IConfigureOptionItem>({ useSeparators: true });
		quickPick.title = localize('chat.configureToolsAndAgent.title', "Configure Tools & Agent");
		quickPick.placeholder = localize('chat.configureToolsAndAgent.placeholder', "Select an agent or configure tools...");
		quickPick.items = items;
		quickPick.matchOnDescription = true;
		quickPick.matchOnDetail = true;

		quickPick.onDidAccept(async () => {
			const selected = quickPick.selectedItems[0];
			quickPick.hide();
			if (!selected) {
				return;
			}

			if (selected.actionType === 'mode' || selected.actionType === 'customAgent') {
				if (selected.mode) {
					const sessionResource = widget.viewModel?.sessionResource;
					if (sessionResource) {
						await commandService.executeCommand(
							ToggleAgentModeActionId,
							{ modeId: selected.mode.id, sessionResource } satisfies IToggleChatModeArgs
						);
					} else {
						widget.input.setChatMode(selected.mode.id, true, true);
					}
				}
			} else if (selected.actionType === 'configureCustomAgents') {
				await commandService.executeCommand('workbench.action.chat.configure.customagents');
			} else if (selected.actionType === 'configureTools') {
				await this.openToolsPicker(instaService, widget, source, telemetryService);
			}
		});

		quickPick.show();
	}

	private async openToolsPicker(instaService: IInstantiationService, widget: IChatWidget, source: string, telemetryService: ITelemetryService): Promise<void> {
		let placeholder;
		let description;
		const { entriesScope, entriesMap } = widget.input.selectedToolsModel;
		switch (entriesScope) {
			case ToolsScope.Session:
				placeholder = localize('chat.tools.placeholder.session', "Select tools for this chat session");
				description = localize('chat.tools.description.session', "The selected tools were configured only for this chat session.");
				break;
			case ToolsScope.Agent:
				placeholder = localize('chat.tools.placeholder.agent', "Select tools for this custom agent");
				description = localize('chat.tools.description.agent', "The selected tools are configured by the '{0}' custom agent. Changes to the tools will be applied to the custom agent file as well.", widget.input.currentModeObs.get().label.get());
				break;
			case ToolsScope.Agent_ReadOnly:
				placeholder = localize('chat.tools.placeholder.readOnlyAgent', "Select tools for this custom agent");
				description = localize('chat.tools.description.readOnlyAgent', "The selected tools are configured by the '{0}' custom agent. Changes to the tools will only be used for this session and will not change the '{0}' custom agent.", widget.input.currentModeObs.get().label.get());
				break;
			case ToolsScope.Global:
				placeholder = localize('chat.tools.placeholder.global', "Select tools that are available to chat.");
				description = localize('chat.tools.description.global', "The selected tools will be applied globally for all chat sessions that use the default agent.");
				break;

		}

		// Create a cancellation token that cancels when the mode changes
		const cts = new CancellationTokenSource();
		const initialMode = widget.input.currentModeObs.get();
		const modeListener = autorun(reader => {
			if (initialMode.id !== widget.input.currentModeObs.read(reader).id) {
				cts.cancel();
			}
		});

		try {
			const result = await instaService.invokeFunction(showToolsPicker, placeholder, source, description, () => entriesMap.get(), widget.input.selectedLanguageModel.get()?.metadata, cts.token);
			if (result) {
				widget.input.selectedToolsModel.set(result, false);
			}
		} finally {
			modeListener.dispose();
			cts.dispose();
		}

		const tools = widget.input.selectedToolsModel.entriesMap.get();
		telemetryService.publicLog2<SelectedToolData, SelectedToolClassification>('chat/selectedTools', {
			total: tools.size,
			enabled: Iterable.reduce(tools, (prev, [_, enabled]) => enabled ? prev + 1 : prev, 0),
		});
	}

	private extractWidget(args: unknown[]): IChatWidget | undefined {
		type ChatActionContext = { widget: IChatWidget };
		function isChatActionContext(obj: unknown): obj is ChatActionContext {
			return !!obj && typeof obj === 'object' && !!(obj as ChatActionContext).widget;
		}

		for (const arg of args) {
			if (isChatActionContext(arg)) {
				return arg.widget;
			}
		}

		return undefined;
	}

	private extractSource(args: unknown[]): string | undefined {
		type ChatActionSource = { source: string };
		function isChatActionSource(obj: unknown): obj is ChatActionSource {
			return !!obj && typeof obj === 'object' && !!(obj as ChatActionSource).source;
		}

		for (const arg of args) {
			if (isChatActionSource(arg)) {
				return arg.source;
			}
		}

		return undefined;
	}
}

export function registerChatToolActions(): DisposableStore {
	const store = new DisposableStore();
	store.add(registerAction2(AcceptToolConfirmation));
	store.add(registerAction2(SkipToolConfirmation));
	store.add(registerAction2(ConfigureToolsAction));
	return store;
}
