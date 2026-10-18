/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { isEqual } from '../../../../../../base/common/resources.js';
import { localize } from '../../../../../../nls.js';
import { ILanguageService } from '../../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../../editor/common/services/resolverService.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { ILabelService } from '../../../../../../platform/label/common/label.js';
import { IOpenEditorOptions } from '../../../../../../platform/editor/browser/editor.js';
import { IEditorService, SIDE_GROUP } from '../../../../../services/editor/common/editorService.js';
import { IChatExternalEdit } from '../../../common/chatService/chatService.js';
import { IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { ChatTreeItem } from '../../chat.js';
import { ChatEditPillElement, isResourceContentEmpty } from './chatEditPillElement.js';
import { IChatContentPart, IChatContentPartDiffData, IChatContentPartRenderContext } from './chatContentParts.js';

export class ChatExternalEditContentPart extends ChatEditPillElement implements IChatContentPart {

	private readonly _onDidChangeDiff = this._register(new Emitter<IChatContentPartDiffData>());
	readonly onDidChangeDiff: Event<IChatContentPartDiffData> = this._onDidChangeDiff.event;

	get domNode(): HTMLElement { return this.element; }

	constructor(
		private readonly edit: IChatExternalEdit,
		_context: IChatContentPartRenderContext,
		@ILabelService labelService: ILabelService,
		@IModelService modelService: IModelService,
		@ILanguageService languageService: ILanguageService,
		@IHoverService hoverService: IHoverService,
		@IEditorService private readonly editorService: IEditorService,
		@ITextModelService private readonly textModelService: ITextModelService,
	) {
		super(labelService, modelService, languageService, hoverService);

		this.render(edit);
		this._register(this.onDidClick(opts => this.openEdit(opts)));
	}

	private render(edit: IChatExternalEdit): void {
		this.setUri(edit.uri);

		const { icon, label } = describeEdit(edit);
		this.setStatus(icon, label);
		this.setProgressFill(undefined);
		this.setLabelDetail('');

		if (edit.diff && (edit.diff.added > 0 || edit.diff.removed > 0)) {
			this.setDiff(edit.diff);
			const fileName = this.labelService.getUriBasenameLabel(edit.uri);
			const insertionsFragment = edit.diff.added === 1
				? localize('chat.codeblock.insertions.one', "1 insertion")
				: localize('chat.codeblock.insertions', "{0} insertions", edit.diff.added);
			const deletionsFragment = edit.diff.removed === 1
				? localize('chat.codeblock.deletions.one', "1 deletion")
				: localize('chat.codeblock.deletions', "{0} deletions", edit.diff.removed);
			this.setAriaLabel(localize('summary', 'Edited {0}, {1}, {2}', fileName, insertionsFragment, deletionsFragment));
			const diff = edit.diff;
			queueMicrotask(() => {
				if (this._store.isDisposed) {
					return;
				}
				this._onDidChangeDiff.fire({
					added: diff.added,
					removed: diff.removed,
					resources: [{
						resource: edit.uri,
						originalURI: edit.beforeContentUri,
						modifiedURI: edit.editKind === 'delete' ? undefined : edit.afterContentUri ?? edit.uri,
					}],
				});
			});
		} else {
			this.setDiff(undefined);
			this.setAriaLabel(`${label} ${this.labelService.getUriBasenameLabel(edit.uri)}`);
		}
	}

	private async openEdit({ editorOptions: options, openToSide }: IOpenEditorOptions): Promise<void> {
		const group = openToSide ? SIDE_GROUP : undefined;
		if (this.edit.beforeContentUri && this.edit.afterContentUri) {
			if (this.edit.editKind === 'edit' && (this.edit.diff?.removed ?? 0) === 0 && await isResourceContentEmpty(this.textModelService, this.edit.beforeContentUri)) {
				this.editorService.openEditor({ resource: this.edit.uri, options }, group);
				return;
			}
			this.editorService.openEditor({
				original: { resource: this.edit.beforeContentUri },
				modified: { resource: this.edit.afterContentUri },
				options,
			}, group);
		} else if (this.edit.editKind === 'delete' && this.edit.beforeContentUri) {
			this.editorService.openEditor({ resource: this.edit.beforeContentUri, options }, group);
		} else if (this.edit.editKind !== 'delete') {
			this.editorService.openEditor({ resource: this.edit.uri, options }, group);
		}
	}

	hasSameContent(other: IChatRendererContent, _followingContent: IChatRendererContent[], _element: ChatTreeItem): boolean {
		if (other.kind !== 'externalEdit') {
			return false;
		}
		return (
			isEqual(other.uri, this.edit.uri) &&
			other.editKind === this.edit.editKind &&
			(other.diff?.added ?? 0) === (this.edit.diff?.added ?? 0) &&
			(other.diff?.removed ?? 0) === (this.edit.diff?.removed ?? 0)
		);
	}
}

function describeEdit(edit: IChatExternalEdit): { icon: ThemeIcon; label: string } {
	switch (edit.editKind) {
		case 'create':
			return { icon: Codicon.check, label: localize('chat.externalEdit.created', 'Created') };
		case 'delete':
			return { icon: Codicon.check, label: localize('chat.externalEdit.deleted', 'Deleted') };
		case 'rename':
			return { icon: Codicon.check, label: localize('chat.externalEdit.renamed', 'Renamed') };
		case 'edit':
			return { icon: Codicon.check, label: localize('chat.codeblock.edited', 'Edited') };
	}
}
