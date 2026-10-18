/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor, isCodeEditor, isDiffEditor, isCompositeEditor, getCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { AbstractCodeEditorService } from '../../../../editor/browser/services/abstractCodeEditorService.js';
import { ScrollType } from '../../../../editor/common/editorCommon.js';
import { IResourceEditorInput } from '../../../../platform/editor/common/editor.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkbenchEditorConfiguration } from '../../../common/editor.js';
import { ACTIVE_GROUP, IEditorService, SIDE_GROUP } from '../common/editorService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { isEqual } from '../../../../base/common/resources.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { applyTextEditorOptions } from '../../../common/editor/editorOptions.js';

export class CodeEditorService extends AbstractCodeEditorService {

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super(themeService);

		this._register(this.registerCodeEditorOpenHandler(this.doOpenCodeEditor.bind(this)));
		this._register(this.registerCodeEditorOpenHandler(this.doOpenCodeEditorFromDiff.bind(this)));
	}

	getActiveCodeEditor(): ICodeEditor | null {
		const activeTextEditorControl = this.editorService.activeTextEditorControl;
		if (isCodeEditor(activeTextEditorControl)) {
			return activeTextEditorControl;
		}

		if (isDiffEditor(activeTextEditorControl)) {
			return activeTextEditorControl.getModifiedEditor();
		}

		const activeControl = this.editorService.activeEditorPane?.getControl();
		if (isCompositeEditor(activeControl) && isCodeEditor(activeControl.activeCodeEditor)) {
			return activeControl.activeCodeEditor;
		}

		return null;
	}

	private async doOpenCodeEditorFromDiff(input: IResourceEditorInput, source: ICodeEditor | null, sideBySide?: boolean): Promise<ICodeEditor | null> {

		const activeTextEditorControl = this.editorService.activeTextEditorControl;
		if (
			!sideBySide &&
			isDiffEditor(activeTextEditorControl) &&
			input.options &&
			input.resource &&
			source === activeTextEditorControl.getModifiedEditor() &&
			activeTextEditorControl.getModel() &&
			isEqual(input.resource, activeTextEditorControl.getModel()?.modified.uri)
		) {
			const targetEditor = activeTextEditorControl.getModifiedEditor();

			applyTextEditorOptions(input.options, targetEditor, ScrollType.Smooth);

			return targetEditor;
		}

		return null;
	}

	private async doOpenCodeEditor(input: IResourceEditorInput, source: ICodeEditor | null, sideBySide?: boolean): Promise<ICodeEditor | null> {

		const enablePreviewFromCodeNavigation = this.configurationService.getValue<IWorkbenchEditorConfiguration>().workbench?.editor?.enablePreviewFromCodeNavigation;
		if (
			!enablePreviewFromCodeNavigation &&
			source &&
			!input.options?.pinned &&
			!sideBySide &&
			!isEqual(source.getModel()?.uri, input.resource)
		) {
			for (const visiblePane of this.editorService.visibleEditorPanes) {
				if (getCodeEditor(visiblePane.getControl()) === source) {
					visiblePane.group.pinEditor();
					break;
				}
			}
		}

		const control = await this.editorService.openEditor(input, sideBySide ? SIDE_GROUP : ACTIVE_GROUP);
		if (control) {
			const widget = control.getControl();
			if (isCodeEditor(widget)) {
				return widget;
			}

			if (isCompositeEditor(widget) && isCodeEditor(widget.activeCodeEditor)) {
				return widget.activeCodeEditor;
			}
		}

		return null;
	}
}

registerSingleton(ICodeEditorService, CodeEditorService, InstantiationType.Delayed);
