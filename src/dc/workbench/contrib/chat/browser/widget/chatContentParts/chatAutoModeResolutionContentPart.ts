/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';
import { autoModeRoutingTitle } from '../../../common/chatAutoModeExplainability.js';
import { IChatAutoModeResolutionPart } from '../../../common/chatService/chatService.js';
import { IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { ChatTreeItem } from '../../chat.js';
import { IChatContentPartRenderContext } from './chatContentParts.js';
import { ChatThinkingStyleContentPart } from './chatThinkingStyleContentPart.js';

export class ChatAutoModeResolutionContentPart extends ChatThinkingStyleContentPart {

	private readonly isRouting: boolean;

	protected override get collapsibleKind(): string {
		return 'autoModeResolution';
	}

	constructor(
		private readonly content: IChatAutoModeResolutionPart,
		context: IChatContentPartRenderContext,
		@IHoverService hoverService: IHoverService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(autoModeRoutingTitle(content), context, undefined, hoverService, configurationService, telemetryService);

		this.isRouting = !content.resolved;
		this.setThinkingActive(this.isRouting);
		this.setExpandable(false);
		if (this.isRouting) {
			this.setShimmerTitle(autoModeRoutingTitle(content));
		}
	}

	protected override shouldPrepareContentAnimation(): boolean {
		return false;
	}

	protected override initContent(): HTMLElement {
		return this.createThinkingBody();
	}

	hasSameContent(other: IChatRendererContent, _followingContent: IChatRendererContent[], element: ChatTreeItem): boolean {
		if (other.kind !== 'autoModeResolution') {
			return false;
		}
		if (this.isRouting && element.isComplete) {
			return false;
		}
		return other.resolved?.id === this.content.resolved?.id;
	}
}
