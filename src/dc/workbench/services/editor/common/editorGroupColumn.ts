/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { GroupIdentifier } from '../../../common/editor.js';
import { IEditorGroupsService, GroupsOrder, IEditorGroup, preferredSideBySideGroupDirection } from './editorGroupsService.js';
import { ACTIVE_GROUP, ACTIVE_GROUP_TYPE, AUX_WINDOW_GROUP, MODAL_GROUP, SIDE_GROUP, SIDE_GROUP_TYPE } from './editorService.js';

export type EditorGroupColumn = number;

export function columnToEditorGroup(editorGroupService: IEditorGroupsService, configurationService: IConfigurationService, column = ACTIVE_GROUP): GroupIdentifier | ACTIVE_GROUP_TYPE | SIDE_GROUP_TYPE {
	if (column === ACTIVE_GROUP || column === SIDE_GROUP || column === AUX_WINDOW_GROUP || column === MODAL_GROUP) {
		return column;
	}

	let groupInColumn = editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE)[column];


	if (!groupInColumn && column < 9) {
		for (let i = 0; i <= column; i++) {
			const editorGroups = editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE);
			if (!editorGroups[i]) {
				editorGroupService.addGroup(editorGroups[i - 1], preferredSideBySideGroupDirection(configurationService));
			}
		}

		groupInColumn = editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE)[column];
	}

	return groupInColumn?.id ?? SIDE_GROUP;
}

export function editorGroupToColumn(editorGroupService: IEditorGroupsService, editorGroup: IEditorGroup | GroupIdentifier): EditorGroupColumn {
	const group = (typeof editorGroup === 'number') ? editorGroupService.getGroup(editorGroup) : editorGroup;

	return editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE).indexOf(group ?? editorGroupService.activeGroup);
}
