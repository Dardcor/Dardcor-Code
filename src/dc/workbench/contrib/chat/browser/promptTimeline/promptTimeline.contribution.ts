/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { ChatWidget } from '../widget/chatWidget.js';
import { PROMPT_TIMELINE_STICKY_SCROLL_SETTING } from '../../common/promptTimeline.js';
import { PromptTimelineWidgetContrib } from './promptTimelineWidgetContrib.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'chat',
	properties: {
		[PROMPT_TIMELINE_STICKY_SCROLL_SETTING]: {
			type: 'boolean',
			default: true,
			description: localize('chat.stickyScroll.enabled', "Controls whether the current prompt is pinned to the top of the chat transcript while scrolling."),
			experiment: { mode: 'startup' },
		},
	},
});

ChatWidget.CONTRIBS.push(PromptTimelineWidgetContrib);
