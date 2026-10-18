/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { isDiffEditor } from '../../../../editor/browser/editorBrowser.js';
import { DiffEditorViewMode } from '../../../../editor/common/config/editorOptions.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ActiveCustomEditorDiffCanToggleLayoutContext } from '../../../common/contextkeys.js';
import { DiffEditorInput } from '../../../common/editor/diffEditorInput.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorResourceAccessor, isDiffEditorInput, IUntypedEditorInput, SideBySideEditor } from '../../../common/editor.js';
import { TextDiffEditor } from './textDiffEditor.js';

export const IDiffEditorCommandsService = createDecorator<IDiffEditorCommandsService>('diffEditorCommandsService');

export const enum FocusTextDiffEditorMode {
	Original,
	Modified,
	Toggle
}

export interface IDiffEditorCommandsService {
	readonly _serviceBrand: undefined;

	toggleRenderSideBySide(args: unknown[]): Promise<void>;

	openActiveDiffSide(): Promise<void>;

	navigateInDiffEditor(args: unknown[], next: boolean): void;

	focusInDiffEditor(args: unknown[], mode: FocusTextDiffEditorMode): void;

	toggleDiffIgnoreTrimWhitespace(args: unknown[]): Promise<void>;

	swapDiffSides(args: unknown[]): Promise<void>;

	setViewMode(args: unknown[], mode: DiffEditorViewMode): Promise<void>;
}

export class DiffEditorCommandsService implements IDiffEditorCommandsService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IEditorService protected readonly editorService: IEditorService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) { }

	async toggleRenderSideBySide(args: unknown[]): Promise<void> {
		const modifiedResource = this.getActiveDiffModifiedResource(args);
		if (!modifiedResource) {
			return;
		}

		const key = 'diffEditor.renderSideBySide';
		const value = this.textResourceConfigurationService.getValue(modifiedResource, key);
		await this.textResourceConfigurationService.updateValue(modifiedResource, key, !value);
	}

	async openActiveDiffSide(): Promise<void> {
		const activeEditor = this.editorService.activeEditor;
		const activeTextEditorControl = this.editorService.activeTextEditorControl;
		if (!isDiffEditor(activeTextEditorControl) || !(activeEditor instanceof DiffEditorInput)) {
			return;
		}

		let editor: EditorInput | undefined;
		const originalEditor = activeTextEditorControl.getOriginalEditor();
		if (originalEditor.hasTextFocus()) {
			editor = activeEditor.original;
		} else {
			editor = activeEditor.modified;
		}

		await this.editorService.openEditor(editor);
	}

	navigateInDiffEditor(args: unknown[], next: boolean): void {
		const activeTextDiffEditor = this.getActiveTextDiffEditor(args);

		if (activeTextDiffEditor) {
			activeTextDiffEditor.getControl()?.goToDiff(next ? 'next' : 'previous');
		}
	}

	focusInDiffEditor(args: unknown[], mode: FocusTextDiffEditorMode): void {
		const activeTextDiffEditor = this.getActiveTextDiffEditor(args);

		if (activeTextDiffEditor) {
			switch (mode) {
				case FocusTextDiffEditorMode.Original:
					activeTextDiffEditor.getControl()?.getOriginalEditor().focus();
					break;
				case FocusTextDiffEditorMode.Modified:
					activeTextDiffEditor.getControl()?.getModifiedEditor().focus();
					break;
				case FocusTextDiffEditorMode.Toggle:
					if (activeTextDiffEditor.getControl()?.getModifiedEditor().hasWidgetFocus()) {
						return this.focusInDiffEditor(args, FocusTextDiffEditorMode.Original);
					} else {
						return this.focusInDiffEditor(args, FocusTextDiffEditorMode.Modified);
					}
			}
		}
	}

	async toggleDiffIgnoreTrimWhitespace(args: unknown[]): Promise<void> {
		const activeTextDiffEditor = this.getActiveTextDiffEditor(args);

		const model = activeTextDiffEditor?.getControl()?.getModifiedEditor()?.getModel();
		if (!model) {
			return;
		}

		const key = 'diffEditor.ignoreTrimWhitespace';
		const value = this.textResourceConfigurationService.getValue(model.uri, key);
		await this.textResourceConfigurationService.updateValue(model.uri, key, !value);
	}

	async swapDiffSides(args: unknown[]): Promise<void> {
		const diffEditor = this.getActiveTextDiffEditor(args);
		const activeGroup = diffEditor?.group;
		const diffInput = diffEditor?.input;
		if (!diffEditor || typeof activeGroup === 'undefined' || !(diffInput instanceof DiffEditorInput) || !diffInput.modified.resource) {
			return;
		}

		const untypedDiffInput = diffInput.toUntyped({ preserveViewState: activeGroup.id, preserveResource: true });
		if (!untypedDiffInput) {
			return;
		}

		if (diffInput.modified.isModified() && this.editorService.findEditors({ resource: diffInput.modified.resource, typeId: diffInput.modified.typeId, editorId: diffInput.modified.editorId }).length === 0) {
			const editorToOpen: IUntypedEditorInput = { ...untypedDiffInput.modified };
			if (!editorToOpen.options) {
				editorToOpen.options = {};
			}
			editorToOpen.options.pinned = true;
			editorToOpen.options.inactive = true;

			await this.editorService.openEditor(editorToOpen, activeGroup);
		}

		await this.editorService.replaceEditors([
			{
				editor: diffInput,
				replacement: {
					...untypedDiffInput,
					original: untypedDiffInput.modified,
					modified: untypedDiffInput.original,
					options: {
						...untypedDiffInput.options,
						pinned: true
					}
				}
			}
		], activeGroup);
	}

	private getActiveTextDiffEditor(args: unknown[]): TextDiffEditor | undefined {
		const resource = args.length > 0 && args[0] instanceof URI ? args[0] : undefined;

		for (const editor of [this.editorService.activeEditorPane, ...this.editorService.visibleEditorPanes]) {
			if (editor instanceof TextDiffEditor && (!resource || editor.input instanceof DiffEditorInput && isEqual(editor.input.primary.resource, resource))) {
				return editor;
			}
		}

		return undefined;
	}

	private getActiveDiffModifiedResource(args: unknown[]): URI | undefined {
		const activeTextDiffEditor = this.getActiveTextDiffEditor(args);
		const model = activeTextDiffEditor?.getControl()?.getModifiedEditor()?.getModel();
		if (model) {
			return model.uri;
		}

		const resource = args.length > 0 && args[0] instanceof URI ? args[0] : undefined;
		if (ActiveCustomEditorDiffCanToggleLayoutContext.getValue(this.contextKeyService)) {
			const activeCustomDiffModifiedResource = EditorResourceAccessor.getOriginalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
			if (activeCustomDiffModifiedResource && (!resource || isEqual(activeCustomDiffModifiedResource, resource))) {
				return activeCustomDiffModifiedResource;
			}
		}

		for (const editor of [this.editorService.activeEditor, ...this.editorService.visibleEditors]) {
			if (isDiffEditorInput(editor) && editor.modified.resource && (!resource || isEqual(editor.modified.resource, resource))) {
				return editor.modified.resource;
			}
		}

		return undefined;
	}

	async setViewMode(args: unknown[], mode: DiffEditorViewMode): Promise<void> {
		const modifiedResource = this.getActiveDiffModifiedResource(args);
		if (!modifiedResource) {
			return;
		}

		if (mode === 'inline') {
			await this.textResourceConfigurationService.updateValue(modifiedResource, 'diffEditor.renderSideBySide', false);
		} else if (mode === 'sideBySide') {
			await this.textResourceConfigurationService.updateValue(modifiedResource, 'diffEditor.renderSideBySide', true);
		}
	}
}
