/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction, Separator, SubmenuAction, toAction } from '../../../../base/common/actions.js';
import { extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorResourceAccessor, SideBySideEditor, isDiffEditorInput, isEditorInputWithDiffResources } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorResolverService, RegisteredEditorInfo, RegisteredEditorPriority, priorityToRank } from '../../../services/editor/common/editorResolverService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { REOPEN_ACTIVE_EDITOR_WITH_COMMAND_ID } from './editorCommands.js';

export interface IAvailableEditorTypes {
	readonly resource: URI;
	readonly isDiffEditor: boolean;
	readonly originalResource?: URI;
	readonly modifiedResource?: URI;
	readonly currentId: string;
	readonly editors: RegisteredEditorInfo[];
}

export function getAvailableEditorTypes(activeEditor: EditorInput | null | undefined, editorResolverService: IEditorResolverService): IAvailableEditorTypes | undefined {
	const standardDiffResources = isDiffEditorInput(activeEditor) ? {
		original: activeEditor.original.resource,
		modified: activeEditor.modified.resource,
	} : undefined;
	const diffResources = standardDiffResources ?? (isEditorInputWithDiffResources(activeEditor) ? activeEditor.diffResources : undefined);
	const resource = diffResources?.modified ?? EditorResourceAccessor.getOriginalUri(activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
	if (!resource) {
		return undefined;
	}
	const editors = editorResolverService.getEditors(resource);
	if (editors.length <= 1) {
		return undefined;
	}
	return {
		resource,
		isDiffEditor: !!diffResources,
		originalResource: diffResources?.original,
		modifiedResource: diffResources?.modified,
		currentId: activeEditor?.editorId ?? DEFAULT_EDITOR_ASSOCIATION.id,
		editors
	};
}

export function hasDefaultEditorAssociation(available: IAvailableEditorTypes, configuredDefaultEditor: string | undefined): boolean {
	if (configuredDefaultEditor !== undefined && configuredDefaultEditor !== DEFAULT_EDITOR_ASSOCIATION.id) {
		return true;
	}

	return available.editors.some(editor => {
		if (editor.id === DEFAULT_EDITOR_ASSOCIATION.id) {
			return false;
		}

		const priority = available.isDiffEditor ? editor.priority.diff : editor.priority.editor;
		return priorityToRank(priority) >= priorityToRank(RegisteredEditorPriority.builtin);
	});
}

export function editorTypeDisplayLabel(editor: RegisteredEditorInfo, isDiffEditor: boolean): string {
	if (isDiffEditor && editor.id === DEFAULT_EDITOR_ASSOCIATION.id) {
		return localize('textDiffEditor', "Text Diff Editor");
	}
	return editor.label;
}

export function createEditorTypeActions(
	available: IAvailableEditorTypes,
	editorResolverService: IEditorResolverService,
	commandService: ICommandService,
	editorService: IEditorService
): IAction[] {
	const glob = `*${extUri.extname(available.resource)}`;

	const builtinProviderLabel = localize('builtinProviderDisplayName', "Built-in");
	const labelWithSource = (editor: RegisteredEditorInfo) => {
		const label = editorTypeDisplayLabel(editor, available.isDiffEditor);
		return editor.detail && editor.detail !== builtinProviderLabel
			? localize('editorType.labelWithSource', "{0} - {1}", label, editor.detail)
			: label;
	};

	const reopenActions: IAction[] = available.editors.map(editor => toAction({
		id: editor.id,
		label: labelWithSource(editor),
		checked: editor.id === available.currentId,
		run: () => commandService.executeCommand(REOPEN_ACTIVE_EDITOR_WITH_COMMAND_ID, editor.id)
	}));

	const configuredDefault = editorResolverService.getConfiguredDefaultEditor(available.resource, available.isDiffEditor);
	const setDefaultActions: IAction[] = available.editors.map(editor => toAction({
		id: `setDefault.${editor.id}`,
		label: labelWithSource(editor),
		checked: editor.id === configuredDefault,
		run: () => {
			editorResolverService.updateUserAssociations(glob, editor.id, available.isDiffEditor);
			return commandService.executeCommand(REOPEN_ACTIVE_EDITOR_WITH_COMMAND_ID, editor.id);
		}
	}));
	const setDefaultSubmenu = new SubmenuAction(
		'editorType.setDefault',
		available.isDiffEditor
			? localize('editorType.setDefaultDiff', "Set Default (Diff Only) for '{0}'", glob)
			: localize('editorType.setDefault', "Set Default for '{0}'", glob),
		setDefaultActions
	);

	const actions: IAction[] = [...reopenActions, new Separator(), setDefaultSubmenu];

	if (available.isDiffEditor) {
		actions.push(new Separator());
		if (available.originalResource) {
			actions.push(toAction({
				id: 'editorType.openOriginal',
				label: localize('editorType.openOriginal', "Open Original"),
				run: () => editorService.openEditor({ resource: available.originalResource! })
			}));
		}
		if (available.modifiedResource) {
			actions.push(toAction({
				id: 'editorType.openModified',
				label: localize('editorType.openModified', "Open Modified"),
				run: () => editorService.openEditor({ resource: available.modifiedResource! })
			}));
		}
	}

	return actions;
}
