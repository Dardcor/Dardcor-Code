/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IManagedHoverContent } from '../../../../../base/browser/ui/hover/hover.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { MenuItemAction } from '../../../../../platform/actions/common/actions.js';
import { IMenuEntryActionViewItemOptions, MenuEntryActionViewItem } from '../../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IChatSpeechToTextService } from './chatSpeechToTextService.js';
import { DictationDownloadRing, getDictationDownloadHoverContent } from './dictationDownloadRing.js';
import { addMicButtonContextMenuListener, getDictationContextMenuActions } from './micButtonMenuActions.js';

const TOGGLE_DICTATION_COMMAND_ID = 'workbench.action.chat.toggleSpeechToText';

export class DictationDownloadActionViewItem extends MenuEntryActionViewItem {

	private readonly _ring = this._register(new MutableDisposable<DictationDownloadRing>());

	constructor(
		action: MenuItemAction,
		options: IMenuEntryActionViewItemOptions | undefined,
		@IChatSpeechToTextService private readonly _speechToTextService: IChatSpeechToTextService,
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

		container.classList.add('dictation-download-item');
		this._applyState();

		this._register(this._speechToTextService.onDidChangeDownloadingModel(() => this._applyState()));

		this._register(addMicButtonContextMenuListener(
			container,
			() => getDictationContextMenuActions(this._commandService, this._configurationService, this._keybindingService, TOGGLE_DICTATION_COMMAND_ID),
			this._contextMenuService,
		));
	}

	protected override updateClass(): void {
		super.updateClass();
		this._applyState();
	}

	private _applyState(): void {
		if (!this.label) {
			return;
		}
		if (this._speechToTextService.isDownloadingModel) {
			this.label.classList.remove(...ThemeIcon.asClassNameArray(Codicon.loadingCompact));
			this.label.classList.add(...ThemeIcon.asClassNameArray(Codicon.micDownloadCompact));
			if (!this._ring.value && this.element) {
				this._ring.value = new DictationDownloadRing(this.element, this._speechToTextService);
			}
		} else {
			this.label.classList.remove(...ThemeIcon.asClassNameArray(Codicon.micDownloadCompact));
			this.label.classList.add(...ThemeIcon.asClassNameArray(Codicon.loadingCompact));
			this._ring.clear();
		}
	}

	protected override getHoverContents(): IManagedHoverContent {
		return getDictationDownloadHoverContent(this._speechToTextService);
	}
}
