/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { EditorActivation } from '../../../../platform/editor/common/editor.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorInputWithOptions, isEditorInputWithOptions, IUntypedEditorInput, isEditorInput, EditorInputCapabilities } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, GroupsOrder, preferredSideBySideGroupDirection, IEditorGroupsService, IModalEditorPart } from './editorGroupsService.js';
import { AUX_WINDOW_GROUP, AUX_WINDOW_GROUP_TYPE, MODAL_GROUP, MODAL_GROUP_TYPE, PreferredGroup, SIDE_GROUP, USE_MODAL_EDITOR_SETTING, UseModalEditorMode } from './editorService.js';

type FindGroupResult = Promise<[IEditorGroup, EditorActivation | undefined]> | [IEditorGroup, EditorActivation | undefined];

export function findGroup(accessor: ServicesAccessor, editor: IUntypedEditorInput, preferredGroup: Exclude<PreferredGroup, AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE> | undefined): FindGroupResult;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions, preferredGroup: Exclude<PreferredGroup, AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE> | undefined): FindGroupResult;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: Exclude<PreferredGroup, AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE> | undefined): FindGroupResult;
export function findGroup(accessor: ServicesAccessor, editor: IUntypedEditorInput, preferredGroup: AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE): Promise<[IEditorGroup, EditorActivation | undefined]>;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions, preferredGroup: AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE): Promise<[IEditorGroup, EditorActivation | undefined]>;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: AUX_WINDOW_GROUP_TYPE | MODAL_GROUP_TYPE): Promise<[IEditorGroup, EditorActivation | undefined]>;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined): FindGroupResult;
export function findGroup(accessor: ServicesAccessor, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined): FindGroupResult {
	const editorGroupService = accessor.get(IEditorGroupsService);
	const configurationService = accessor.get(IConfigurationService);

	const group = doFindGroup(editor, preferredGroup, editorGroupService, configurationService);
	if (group instanceof Promise) {
		return group.then(group => handleGroupResult(group, editor, preferredGroup, editorGroupService, configurationService));
	}

	return handleGroupResult(group, editor, preferredGroup, editorGroupService, configurationService);
}

function handleGroupResult(group: IEditorGroup, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined, editorGroupService: IEditorGroupsService, configurationService: IConfigurationService): FindGroupResult {
	const modalEditorPart = editorGroupService.activeModalEditorPart;
	const modalEditorMode = configurationService.getValue<UseModalEditorMode>(USE_MODAL_EDITOR_SETTING);
	const editorInput = isEditorInputWithOptions(editor) ? editor.editor : isEditorInput(editor) ? editor : undefined;
	const requiresModal = editorInput instanceof EditorInput && editorInput.hasCapability(EditorInputCapabilities.RequiresModal) && modalEditorMode !== 'off';
	if (modalEditorPart && preferredGroup !== MODAL_GROUP && modalEditorMode !== 'all' && !requiresModal) {
		return handleModalEditorPart(group, editor, modalEditorPart, editorGroupService, preferredGroup);
	}

	return handleGroupActivation(group, editor, preferredGroup, editorGroupService);
}

async function handleModalEditorPart(group: IEditorGroup, editor: EditorInputWithOptions | IUntypedEditorInput, modalEditorPart: IModalEditorPart, editorGroupService: IEditorGroupsService, preferredGroup: PreferredGroup | undefined): Promise<[IEditorGroup, EditorActivation | undefined]> {
	const options = editor.options;

	if (modalEditorPart.groups.some(modalGroup => modalGroup.id === group.id)) {
		group = editorGroupService.mainPart.activeGroup;
	}

	if (!options?.preserveFocus) {
		await modalEditorPart.close();
	}

	return handleGroupActivation(group, editor, preferredGroup, editorGroupService);
}

function handleGroupActivation(group: IEditorGroup, editor: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined, editorGroupService: IEditorGroupsService): [IEditorGroup, EditorActivation | undefined] {

	let activation: EditorActivation | undefined = undefined;
	if (
		editorGroupService.activeGroup !== group &&
		editor.options && !editor.options.inactive &&
		editor.options.preserveFocus &&
		typeof editor.options.activation !== 'number' &&
		preferredGroup !== SIDE_GROUP
	) {
		activation = EditorActivation.ACTIVATE;
	}

	return [group, activation];
}

function doFindGroup(input: EditorInputWithOptions | IUntypedEditorInput, preferredGroup: PreferredGroup | undefined, editorGroupService: IEditorGroupsService, configurationService: IConfigurationService): Promise<IEditorGroup> | IEditorGroup {
	let group: Promise<IEditorGroup> | IEditorGroup | undefined;
	const editor = isEditorInputWithOptions(input) ? input.editor : input;
	const options = input.options;

	if (isEditorInput(editor) && editor.hasCapability(EditorInputCapabilities.RequiresModal) && configurationService.getValue<UseModalEditorMode>(USE_MODAL_EDITOR_SETTING) !== 'off') {
		group = editorGroupService.createModalEditorPart(options?.modal)
			.then(part => part.activeGroup);
	}

	else if (preferredGroup && typeof preferredGroup !== 'number') {
		group = preferredGroup;
	}

	else if (typeof preferredGroup === 'number' && preferredGroup >= 0) {
		group = editorGroupService.getGroup(preferredGroup);
	}

	else if (preferredGroup === SIDE_GROUP) {
		const direction = preferredSideBySideGroupDirection(configurationService);

		let candidateGroup = editorGroupService.findGroup({ direction });
		if (!candidateGroup || isGroupLockedForEditor(candidateGroup, editor)) {
			candidateGroup = editorGroupService.addGroup(editorGroupService.activeGroup, direction);
		}

		group = candidateGroup;
	}

	else if (preferredGroup === AUX_WINDOW_GROUP) {
		group = editorGroupService.createAuxiliaryEditorPart(options?.auxiliary)
			.then(group => group.activeGroup);
	}

	else if (preferredGroup === MODAL_GROUP && configurationService.getValue<UseModalEditorMode>(USE_MODAL_EDITOR_SETTING) !== 'off') {
		group = editorGroupService.createModalEditorPart(options?.modal)
			.then(part => part.activeGroup);
	}

	else if (!options || typeof options.index !== 'number') {
		const groupsByLastActive = editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);

		if (options?.revealIfVisible) {
			for (const lastActiveGroup of groupsByLastActive) {
				if (isActive(lastActiveGroup, editor)) {
					group = lastActiveGroup;
					break;
				}
			}
		}

		if (!group) {
			if (options?.revealIfOpened || configurationService.getValue<boolean>('workbench.editor.revealIfOpen') || (isEditorInput(editor) && (editor.hasCapability(EditorInputCapabilities.ForceReveal) || editor.hasCapability(EditorInputCapabilities.Singleton)))) {
				let groupWithInputActive: IEditorGroup | undefined = undefined;
				let groupWithInputOpened: IEditorGroup | undefined = undefined;

				for (const group of groupsByLastActive) {
					if (isOpened(group, editor)) {
						if (!groupWithInputOpened) {
							groupWithInputOpened = group;
						}

						if (!groupWithInputActive && group.isActive(editor)) {
							groupWithInputActive = group;
						}
					}

					if (groupWithInputOpened && groupWithInputActive) {
						break;
					}
				}

				group = groupWithInputActive || groupWithInputOpened;
			}
		}
	}

	if (!group && configurationService.getValue<UseModalEditorMode>(USE_MODAL_EDITOR_SETTING) === 'all') {
		group = editorGroupService.createModalEditorPart(options?.modal)
			.then(part => part.activeGroup);
	}

	if (!group) {
		let candidateGroup = editorGroupService.activeGroup;

		if (isGroupLockedForEditor(candidateGroup, editor)) {
			for (const group of editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
				if (isGroupLockedForEditor(group, editor)) {
					continue;
				}

				candidateGroup = group;
				break;
			}

			if (isGroupLockedForEditor(candidateGroup, editor)) {
				group = editorGroupService.addGroup(candidateGroup, preferredSideBySideGroupDirection(configurationService));
			} else {
				group = candidateGroup;
			}
		}

		else {
			group = candidateGroup;
		}
	}

	return group;
}

function isGroupLockedForEditor(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput): boolean {
	if (!group.isLocked) {
		return false;
	}

	if (isOpened(group, editor)) {
		return false;
	}

	return true;
}

function isActive(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput): boolean {
	if (!group.activeEditor) {
		return false;
	}

	return group.activeEditor.matches(editor);
}

function isOpened(group: IEditorGroup, editor: EditorInput | IUntypedEditorInput): boolean {
	for (const typedEditor of group.editors) {
		if (typedEditor.matches(editor)) {
			return true;
		}
	}

	return false;
}
