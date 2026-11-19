/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const PROMPT_TIMELINE_CONTRIB_ID = 'chat.promptTimeline';

export const PROMPT_TIMELINE_STICKY_SCROLL_SETTING = 'chat.stickyScroll.enabled';

export type PromptTimelineRailStyle = 'off' | 'ruler' | 'gutter';

export const PROMPT_TIMELINE_RAIL_STYLES: readonly PromptTimelineRailStyle[] = ['off', 'ruler', 'gutter'];

export const MIN_RAIL_PROMPTS = 2;
