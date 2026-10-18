/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HARD_TOOL_LIMIT } from '../../../../platform/configuration/common/configurationService';

export const START_GROUPING_AFTER_TOOL_COUNT = HARD_TOOL_LIMIT / 2;

export const START_BUILTIN_GROUPING_AFTER_TOOL_COUNT = 20;

export const EXPAND_UNTIL_COUNT = START_GROUPING_AFTER_TOOL_COUNT;
export const TRIM_THRESHOLD = HARD_TOOL_LIMIT * 3 / 4;

export const GROUP_WITHIN_TOOLSET = HARD_TOOL_LIMIT / 8;

export const MIN_TOOLSET_SIZE_TO_GROUP = 2;

export const NUM_EMBED_MATCHED_TOOLS = 10;

export const TOOLS_AND_GROUPS_LIMIT = HARD_TOOL_LIMIT - NUM_EMBED_MATCHED_TOOLS - 30;

export const MAX_CATEGORIZATION_RETRIES = 3;

export const MAX_GROUPS_PER_CHUNK = 16;

export const UNCATEGORIZED_TOOLS_GROUP_NAME = 'uncategorized_tools';

export const UNCATEGORIZED_TOOLS_GROUP_SUMMARY = 'Tools that could not be automatically categorized into existing groups.';
