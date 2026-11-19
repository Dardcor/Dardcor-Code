/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { IManagedHoverContent } from '../../../../../base/browser/ui/hover/hover.js';
import { MenuItemAction } from '../../../../../platform/actions/common/actions.js';
import { IMenuEntryActionViewItemOptions, MenuEntryActionViewItem } from '../../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { getVoiceModeHoverContent } from '../speechToText/micButtonHovers.js';
import { addMicButtonContextMenuListener, getVoiceModeContextMenuActions } from '../speechToText/micButtonMenuActions.js';

const VOICE_START_COMMAND = 'agentsVoice.startVoiceInChat';

export class VoiceModeActionViewItem extends MenuEntryActionViewItem {

	constructor(
		action: MenuItemAction,
		options: IMenuEntryActionViewItemOptions | undefined,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
	) {
		super(action, options, keybindingService, notificationService, contextKeyService, themeService, contextMenuService, accessibilityService);
	}

	override render(container: HTMLElement): void {
		super.render(container);

		this._register(addMicButtonContextMenuListener(
			container,
			() => getVoiceModeContextMenuActions(this._commandService, this._configurationService, this._keybindingService, VOICE_START_COMMAND),
			this._contextMenuService,
		));
	}

	protected override getHoverContents(): IManagedHoverContent {
		return getVoiceModeHoverContent(this.getTooltip() ?? '');
	}
}
