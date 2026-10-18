/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { renderLabelWithIcons } from '../../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { IDisposable, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, IObservable } from '../../../../../../base/common/observable.js';
import { isWindows } from '../../../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { localize } from '../../../../../../nls.js';
import { IActionWidgetService } from '../../../../../../platform/actionWidget/browser/actionWidget.js';
import { IActionWidgetDropdownAction, IActionWidgetDropdownActionProvider } from '../../../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';
import { ChatConfiguration, ChatPermissionLevel } from '../../../common/constants.js';
import { IChatSessionProviderOptionItem, SessionType } from '../../../common/chatSessionsService.js';
import { MenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { ChatInputPickerActionViewItem, IChatInputPickerOptions } from './chatInputPickerActionItem.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { maybeConfirmElevatedPermissionLevel } from '../../../common/chatPermissionWarnings.js';
import { AgentSandboxEnabledSettingValue, AgentSandboxEnabledValue, AgentSandboxSettingId, isAgentSandboxEnabledValue } from '../../../../../../platform/sandbox/common/settings.js';
import { getCompactCodicon } from '../../chatIcons.js';

export interface IExtensionPermissionState {
	readonly sessionType: string;
	readonly groupId: string;
	readonly items: readonly IChatSessionProviderOptionItem[];
	readonly selectedId: string | undefined;
}

export interface IPermissionPickerDelegate {
	readonly currentPermissionLevel: IObservable<ChatPermissionLevel>;
	readonly setPermissionLevel: (level: ChatPermissionLevel) => void;
	readonly availableLevels?: readonly ChatPermissionLevel[];
	readonly defaultSettingKey?: string;
	readonly getExtensionPermissions?: () => IExtensionPermissionState | undefined;
	readonly setExtensionPermission?: (groupId: string, item: IChatSessionProviderOptionItem) => void;
	readonly getPermissionLevelHover?: (level: ChatPermissionLevel, meta: IPermissionLevelMeta) => string | undefined;
	readonly isSandboxToggleApplicable?: () => boolean;
	readonly sandboxTogglePresentation?: 'inline' | 'standalone';
	readonly getSandboxToggleSettingId?: () => string | undefined;
	readonly sandboxToggleConfigurationKeys?: readonly string[];
	readonly managedSandboxEnforced?: IObservable<boolean>;
}

const DEFAULT_PERMISSION_LEVELS: readonly ChatPermissionLevel[] = [
	ChatPermissionLevel.Default,
	ChatPermissionLevel.Assisted,
	ChatPermissionLevel.AutoApprove,
];

interface IPermissionLevelMeta {
	readonly id: string;
	readonly label: string;
	readonly shortLabel: string;
	readonly detail: string;
	readonly icon: ThemeIcon;
	readonly description: string;
	readonly elevated: boolean;
}

function getPermissionLevelMeta(level: ChatPermissionLevel): IPermissionLevelMeta {
	switch (level) {
		case ChatPermissionLevel.Assisted:
			return {
				id: 'chat.permissions.assisted',
				label: localize('permissions.assisted', "Approve for me"),
				shortLabel: localize('permissions.assisted.label', "Approve for me"),
				detail: localize('permissions.assisted.subtext', "Automatically approves known safe actions"),
				icon: ThemeIcon.fromId(Codicon.sparkle.id),
				description: localize('permissions.assisted.description', "Known read-only inspection and a small set of safe commands can proceed automatically. File changes, terminal actions with side effects, network access, browser interactions, and uncertain actions ask you first."),
				elevated: false,
			};
		case ChatPermissionLevel.AutoApprove:
			return {
				id: 'chat.permissions.autoApprove',
				label: localize('permissions.autoApprove', "Full access"),
				shortLabel: localize('permissions.autoApprove.label', "Full access"),
				detail: localize('permissions.autoApprove.subtext', "Allows agent actions without per-action approval"),
				icon: ThemeIcon.fromId(Codicon.warning.id),
				description: localize('permissions.autoApprove.description', "Allows file changes, terminal commands, browser actions, and network access without asking each time. Organization policy can still restrict this level."),
				elevated: true,
			};
		case ChatPermissionLevel.Autopilot:
			return {
				id: 'chat.permissions.autopilot',
				label: localize('permissions.autopilot', "Autopilot (Preview)"),
				shortLabel: localize('permissions.autopilot.label', "Autopilot (Preview)"),
				detail: localize('permissions.autopilot.subtext', "Works autonomously within permissions"),
				icon: ThemeIcon.fromId(Codicon.rocket.id),
				description: localize('permissions.autopilot.description', "Auto-approve all tool calls and continue until the task is done. Autopilot may increase costs."),
				elevated: true,
			};
		case ChatPermissionLevel.Default:
		default:
			return {
				id: 'chat.permissions.default',
				label: localize('permissions.default', "Ask for approval"),
				shortLabel: localize('permissions.default.label', "Ask"),
				detail: localize('permissions.default.subtext', "Ask before actions with side effects"),
				icon: ThemeIcon.fromId(Codicon.shield.id),
				description: localize('permissions.default.description', "Read-only inspection can proceed. The agent asks before changing files, running commands, accessing the network, or interacting with websites."),
				elevated: false,
			};
	}
}

function sanitizeIdSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getLocalSandboxEnabledSettingId(): AgentSandboxSettingId.AgentSandboxEnabled | AgentSandboxSettingId.AgentSandboxWindowsEnabled {
	return isWindows ? AgentSandboxSettingId.AgentSandboxWindowsEnabled : AgentSandboxSettingId.AgentSandboxEnabled;
}

export class PermissionPickerActionItem extends ChatInputPickerActionViewItem {

	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose: Event<void> = this._onDidDispose.event;

	private _currentTooltip: string = '';
	private _hoverElement: HTMLElement | undefined;
	private readonly _hover = this._register(new MutableDisposable<IDisposable>());

	constructor(
		action: MenuItemAction,
		private readonly delegate: IPermissionPickerDelegate,
		pickerOptions: IChatInputPickerOptions,
		@IActionWidgetService actionWidgetService: IActionWidgetService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IOpenerService openerService: IOpenerService,
		@IStorageService storageService: IStorageService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		const isAutoApprovePolicyRestricted = () => configurationService.inspect<boolean>(ChatConfiguration.GlobalAutoApprove).policyValue === false;
		const actionProvider: IActionWidgetDropdownActionProvider = {
			getActions: () => {
				const ext = delegate.getExtensionPermissions?.();
				const extensionActions: IActionWidgetDropdownAction[] = ext && ext.items.length > 0
					? ext.items.map(item => ({
						...action,
						id: `chat.permissions.ext.${sanitizeIdSegment(ext.sessionType)}.${sanitizeIdSegment(ext.groupId)}.${sanitizeIdSegment(item.id)}`,
						label: item.name,
						detail: item.description,
						icon: item.icon,
						checked: ext.selectedId === item.id,
						enabled: !item.locked,
						tooltip: item.locked ? localize('permissions.ext.locked', "This option is locked") : '',
						hover: item.description ? { content: item.description } : undefined,
						category: { label: localize('permissions.ext.category', "Session permissions"), order: 1 },
						run: async () => {
							delegate.setExtensionPermission?.(ext.groupId, item);
							if (this.element) {
								this.renderLabel(this.element);
							}
						},
					} satisfies IActionWidgetDropdownAction))
					: [];
				const currentLevel = delegate.currentPermissionLevel.get();
				const policyRestricted = isAutoApprovePolicyRestricted();
				const sandboxToggleEnabled = this.isSandboxToggleAvailable();
				const sandboxTogglePresentation = delegate.sandboxTogglePresentation ?? 'inline';
				const setSandboxEnabled = async (enableSandbox: boolean) => {
					if (this.isSandboxManaged()) {
						return;
					}
					const target: AgentSandboxEnabledValue = enableSandbox ? AgentSandboxEnabledValue.On : AgentSandboxEnabledValue.Off;
					const settingId = this.getSandboxToggleSettingId();
					if (settingId && this.isSandboxingEnabled() !== enableSandbox) {
						await configurationService.updateValue(settingId, target);
					}
				};
				const sandboxManaged = this.isSandboxManaged();
				const sandboxToggle = sandboxToggleEnabled ? {
					label: localize('permissions.default.sandbox.toggle', "Sandboxing for terminal"),
					title: sandboxManaged
						? localize('permissions.default.sandbox.toggle.managedTitle', "Sandboxing is managed by your organization")
						: localize('permissions.default.sandbox.toggle.title', "Run terminal commands inside a sandbox that restricts file system and network access"),
					checked: this.isSandboxingEnabled(),
					disabled: sandboxManaged,
					onChange: (checked: boolean) => { void setSandboxEnabled(checked); },
				} : undefined;
				const levels = delegate.availableLevels ?? DEFAULT_PERMISSION_LEVELS;
				const actions: IActionWidgetDropdownAction[] = levels.map(level => {
					const meta = getPermissionLevelMeta(level);
					const disabledByPolicy = meta.elevated && policyRestricted;
					const hover = disabledByPolicy
						? localize('permissions.policyDescription', "Disabled by enterprise policy")
						: delegate.getPermissionLevelHover?.(level, meta) ?? meta.description;

					const inlineToggle = sandboxTogglePresentation === 'inline' && level === ChatPermissionLevel.Default
						? sandboxToggle
						: undefined;

					return {
						...action,
						id: meta.id,
						label: meta.label,
						detail: meta.detail,
						icon: meta.icon,
						checked: currentLevel === level,
						enabled: !disabledByPolicy,
						inlineToggle,
						tooltip: disabledByPolicy ? localize('permissions.policyDisabled', "Disabled by enterprise policy") : '',
						hover: {
							content: hover,
						},
						run: async () => {
							if (meta.elevated && !await maybeConfirmElevatedPermissionLevel(level, this.dialogService, storageService, {
								defaultSettingKey: delegate.defaultSettingKey,
								levelLabel: meta.label,
							})) {
								return;
							}
							delegate.setPermissionLevel(level);
							if (this.element) {
								this.renderLabel(this.element);
							}
						},
					} satisfies IActionWidgetDropdownAction;
				});
				if (sandboxTogglePresentation === 'standalone' && sandboxToggle) {
					actions.push({
						...action,
						id: 'chat.permissions.sandbox',
						label: sandboxToggle.label,
						icon: Codicon.blank,
						checked: false,
						enabled: true,
						standaloneToggle: sandboxToggle,
						category: { label: 'sandbox', order: Number.MAX_SAFE_INTEGER },
						tooltip: '',
						run: async () => { },
					} as unknown as IActionWidgetDropdownAction);
				}
				return [...actions, ...extensionActions];
			}
		};

		let itemRef: PermissionPickerActionItem | undefined;
		super(action, {
			actionProvider,
			actionBarActions: [{
				id: 'chat.permissions.learnMore',
				label: localize('permissions.learnMore', "Learn more about permissions"),
				tooltip: localize('permissions.learnMore', "Learn more about permissions"),
				class: undefined,
				enabled: true,
				run: async () => {
					const ext = delegate.getExtensionPermissions?.();
					const url = ext?.sessionType === SessionType.AgentHostClaude
						? 'https://code.claude.com/docs/en/permission-modes#available-modes'
						: 'https://www.dardcor-code.web.id/docs/permissions';
					await openerService.open(URI.parse(url));
				}
			}],
			reporter: { id: 'ChatPermissionPicker', name: 'ChatPermissionPicker', includeOptions: true },
			listOptionsProvider: {
				getListOptions: () => {
					const anchor = itemRef?.getAnchorElement();
					const chatInputWidth = anchor?.offsetWidth;
					const width = chatInputWidth && chatInputWidth > 200 ? chatInputWidth : 255;
					return {
						className: 'chat-permission-picker-dropdown',
						minWidth: width,
						maxWidth: width,
						detailItemHeight: 44,
						...pickerOptions.listOptions,
					};
				}
			},
		}, pickerOptions, actionWidgetService, keybindingService, contextKeyService, telemetryService);
		itemRef = this;

		this._register(configurationService.onDidChangeConfiguration(e => {
			const settingId = this.getSandboxToggleSettingId();
			const affectsSandboxToggle = e.affectsConfiguration(ChatConfiguration.PermissionsSandboxToggleEnabled)
				|| (settingId !== undefined && e.affectsConfiguration(settingId))
				|| this.delegate.sandboxToggleConfigurationKeys?.some(key => e.affectsConfiguration(key)) === true;
			if (affectsSandboxToggle && this.element) {
				this.renderLabel(this.element);
			}
		}));
		if (delegate.managedSandboxEnforced) {
			this._register(autorun(reader => {
				delegate.managedSandboxEnforced?.read(reader);
				if (this.element) {
					this.renderLabel(this.element);
				}
			}));
		}
	}

	private isSandboxingEnabled(): boolean {
		if (this.isSandboxManaged()) {
			return true;
		}
		const settingId = this.getSandboxToggleSettingId();
		if (!settingId) {
			return false;
		}
		const value = this.configurationService.getValue<AgentSandboxEnabledSettingValue>(settingId);
		return isAgentSandboxEnabledValue(value);
	}

	private isSandboxManaged(): boolean {
		return this.delegate.managedSandboxEnforced?.get() === true;
	}

	private getSandboxToggleSettingId(): string | undefined {
		return this.delegate.getSandboxToggleSettingId
			? this.delegate.getSandboxToggleSettingId()
			: getLocalSandboxEnabledSettingId();
	}

	private isSandboxToggleSettingEnabled(): boolean {
		return this.configurationService.getValue<boolean>(ChatConfiguration.PermissionsSandboxToggleEnabled) === true;
	}

	private isSandboxToggleAvailable(): boolean {
		return this.isSandboxToggleSettingEnabled()
			&& this.delegate.isSandboxToggleApplicable?.() === true
			&& this.getSandboxToggleSettingId() !== undefined;
	}

	protected override renderLabel(element: HTMLElement): IDisposable | null {
		this.setAriaLabelAttributes(element);

		const ext = this.delegate.getExtensionPermissions?.();
		let icon: ThemeIcon;
		let label: string;
		let tooltip: string;
		const level = this.delegate.currentPermissionLevel.get();
		if (ext && ext.items.length > 0) {
			const selected = ext.items.find(i => i.id === ext.selectedId)
				?? ext.items.find(i => i.default)
				?? ext.items[0];
			icon = selected.icon ?? Codicon.lock;
			label = selected.name;
			tooltip = selected.description ?? selected.name;
		} else {
			const meta = getPermissionLevelMeta(level);
			icon = meta.icon;
			label = meta.shortLabel;
			tooltip = this.delegate.getPermissionLevelHover?.(level, meta) ?? meta.description;
			if (this.isSandboxToggleAvailable() && this.isSandboxingEnabled()) {
				label = this.delegate.sandboxTogglePresentation === 'standalone'
					? localize('permissions.sandboxed.label', "{0} (sandboxed)", label)
					: level === ChatPermissionLevel.Default
						? localize('permissions.defaultSandboxed.label', "Default permissions (sandboxed)")
						: label;
			}
		}

		const labelElements = [];
		labelElements.push(...renderLabelWithIcons(`$(${getCompactCodicon(icon).id})`));
		const compact = this.pickerOptions.iconOnly === true || this.pickerOptions.compact.get();
		element.classList.toggle('icon-only', compact);
		if (!compact) {
			labelElements.push(dom.$('span.chat-input-picker-label', undefined, label));
		}

		dom.reset(element, ...labelElements);
		element.classList.toggle('warning', !ext && (level === ChatPermissionLevel.Autopilot || level === ChatPermissionLevel.Assisted));
		element.classList.toggle('info', !ext && level === ChatPermissionLevel.AutoApprove);

		this._currentTooltip = tooltip;
		element.setAttribute('aria-label', !ext && this.delegate.getPermissionLevelHover
			? localize('permissions.ariaLabelWithDescription', "Permission picker, {0}, {1}", label, tooltip)
			: localize('permissions.ariaLabel', "Permission picker, {0}", label));
		if (this._hoverElement !== element) {
			this._hoverElement = element;
			this._hover.value = this.hoverService.setupDelayedHover(element, () => ({ content: this._currentTooltip }));
		}
		return null;
	}

	public refresh(): void {
		if (this.element) {
			this.renderLabel(this.element);
		}
	}

	protected override getAnchorElement(): HTMLElement {
		const baseAnchor = super.getAnchorElement();
		const chatInputContainer = (baseAnchor?.closest('.chat-input-container, .new-chat-input-area')
			?? this.element?.closest('.chat-input-container, .new-chat-input-area')
			?? baseAnchor?.closest('.interactive-input-part')?.querySelector<HTMLElement>('.chat-input-container')
			?? this.element?.closest('.interactive-input-part')?.querySelector<HTMLElement>('.chat-input-container')
			?? baseAnchor?.closest('.interactive-session')?.querySelector<HTMLElement>('.chat-input-container')
			?? this.element?.closest('.interactive-session')?.querySelector<HTMLElement>('.chat-input-container')) as HTMLElement | null;
		return chatInputContainer ?? baseAnchor;
	}

	override dispose(): void {
		if (this._store.isDisposed) {
			return;
		}
		this._onDidDispose.fire();
		super.dispose();
	}
}
