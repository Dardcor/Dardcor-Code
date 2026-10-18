/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { URI } from '../../../../../base/common/uri.js';
import { IChatViewTitleActionContext, isChatViewTitleActionContext } from '../../common/actions/chatActions.js';
import { AICustomizationManagementSection } from '../../common/aiCustomizationWorkspaceService.js';
import { PromptsType } from '../../common/promptSyntax/promptTypes.js';
import { localize } from '../../../../../nls.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { hasReadableCustomizationContent } from '../../../../../platform/agentHost/common/agentHostCustomizationUri.js';
import { CustomizationMigrationCategoryId } from './customizationMigrationCategories.js';

export { AICustomizationManagementCommands, AICustomizationManagementSection } from '../../common/aiCustomizationWorkspaceService.js';
export type { AICustomizationSource } from '../../common/aiCustomizationWorkspaceService.js';
export { BUILTIN_STORAGE } from '../../common/aiCustomizationWorkspaceService.js';

export type AICustomizationManagementOpenEditorTarget =
	| AICustomizationManagementSection
	| {
		readonly section?: AICustomizationManagementSection;
		readonly sessionType?: string;
		readonly revealUri?: URI;
		readonly migration?: boolean;
		readonly migrationCategory?: CustomizationMigrationCategoryId;
	}
	| IChatViewTitleActionContext;

export function resolveAICustomizationManagementOpenEditorTarget(
	target: AICustomizationManagementOpenEditorTarget | undefined,
	pendingSessionType: string | undefined,
	chatSessionResource: URI | undefined,
	getSessionResourceForHarness: (sessionType: string) => URI,
): { readonly section?: AICustomizationManagementSection; readonly revealUri?: URI; readonly sessionResource?: URI; readonly migration?: boolean; readonly migrationCategory?: CustomizationMigrationCategoryId } {
	if (isChatViewTitleActionContext(target)) {
		return { sessionResource: target.sessionResource };
	}

	const options = typeof target === 'string' ? { section: target } : target;
	const sessionType = options?.sessionType ?? pendingSessionType;
	return {
		section: options?.section,
		revealUri: options?.revealUri,
		migration: options?.migration,
		migrationCategory: options?.migrationCategory,
		sessionResource: sessionType ? getSessionResourceForHarness(sessionType) : chatSessionResource,
	};
}

export function sectionToPromptType(section: AICustomizationManagementSection): PromptsType {
	switch (section) {
		case AICustomizationManagementSection.Agents:
			return PromptsType.agent;
		case AICustomizationManagementSection.Skills:
			return PromptsType.skill;
		case AICustomizationManagementSection.Instructions:
			return PromptsType.instructions;
		case AICustomizationManagementSection.Hooks:
			return PromptsType.hook;
		case AICustomizationManagementSection.Prompts:
		default:
			return PromptsType.prompt;
	}
}

export const AI_CUSTOMIZATION_MANAGEMENT_EDITOR_ID = 'workbench.editor.aiCustomizationManagement';

export const AI_CUSTOMIZATION_MANAGEMENT_EDITOR_INPUT_ID = 'workbench.input.aiCustomizationManagement';

export const CONTEXT_AI_CUSTOMIZATION_MANAGEMENT_EDITOR = new RawContextKey<boolean>(
	'aiCustomizationManagementEditorFocused',
	false,
	localize('aiCustomizationManagementEditorFocused', "Whether the Agent Customizations editor is focused")
);

export const CONTEXT_AI_CUSTOMIZATION_MANAGEMENT_SECTION = new RawContextKey<string>(
	'chatCustomizationSection',
	AICustomizationManagementSection.Agents,
	localize('chatCustomizationSection', "The currently selected section in the Agent Customizations editor")
);

export const CONTEXT_AI_CUSTOMIZATION_MANAGEMENT_HARNESS = new RawContextKey<string>(
	'chatCustomizationSessionType',
	'',
	localize('chatCustomizationSessionType', "The active harness (session type) in the Agent Customizations editor")
);

export const AICustomizationManagementTitleMenuId = MenuId.for('AICustomizationManagementEditorTitle');

export const AICustomizationManagementItemMenuId = MenuId.for('AICustomizationManagementEditorItem');

export const AICustomizationManagementSyntheticItemMenuId = MenuId.for('AICustomizationManagementEditorSyntheticItem');

export function getAICustomizationManagementItemMenuId(uri: URI): MenuId {
	return hasReadableCustomizationContent(uri)
		? AICustomizationManagementItemMenuId
		: AICustomizationManagementSyntheticItemMenuId;
}

export const AICustomizationManagementCreateMenuId = MenuId.for('AICustomizationManagementCreate');

export const AI_CUSTOMIZATION_ITEM_TYPE_KEY = 'aiCustomizationManagementItemType';

export const AI_CUSTOMIZATION_ITEM_STORAGE_KEY = 'aiCustomizationManagementItemStorage';

export const AI_CUSTOMIZATION_ITEM_URI_KEY = 'aiCustomizationManagementItemUri';

export const AI_CUSTOMIZATION_ITEM_PLUGIN_URI_KEY = 'aiCustomizationManagementItemPluginUri';

export const AI_CUSTOMIZATION_ITEM_DISABLED_KEY = 'aiCustomizationManagementItemDisabled';

export const AI_CUSTOMIZATION_MANAGEMENT_SELECTED_SECTION_KEY = 'aiCustomizationManagement.selectedSection';

export const AI_CUSTOMIZATION_MANAGEMENT_SIDEBAR_WIDTH_KEY = 'aiCustomizationManagement.sidebarWidth';

export const AI_CUSTOMIZATION_MANAGEMENT_SEARCH_KEY = 'aiCustomizationManagement.searchQuery';

export const SIDEBAR_DEFAULT_WIDTH = 200;
export const SIDEBAR_MIN_WIDTH = 150;
export const SIDEBAR_MAX_WIDTH = 350;
export const CONTENT_MIN_WIDTH = 400;
