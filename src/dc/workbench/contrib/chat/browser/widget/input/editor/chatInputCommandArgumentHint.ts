/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ICodeEditorService } from '../../../../../../../editor/browser/services/codeEditorService.js';
import { IRange, Range } from '../../../../../../../editor/common/core/range.js';
import { IDecorationOptions } from '../../../../../../../editor/common/editorCommon.js';
import { ITextModel } from '../../../../../../../editor/common/model.js';
import { IThemeService } from '../../../../../../../platform/theme/common/themeService.js';
import { getCommandArgumentHint } from '../../../../../../../platform/agentHost/common/meta/agentCompletionAttachmentMeta.js';
import { AgentHostCompletionReferenceKind, getAgentHostCompletionReferenceKindFromValue } from '../../../../common/attachments/chatVariableEntries.js';
import { ChatDynamicVariableModel } from '../../../attachments/chatDynamicVariables.js';
import { IChatWidget } from '../../../chat.js';
import { ChatWidget } from '../../chatWidget.js';
import { getInputPlaceholderColor, getRangeForPlaceholder } from './chatInputPlaceholderDecoration.js';

const decorationDescription = 'chat';
const commandArgumentHintDecorationType = 'chat-command-argument-hint';

class InputEditorCommandArgumentHint extends Disposable {

	public readonly id = 'inputEditorCommandArgumentHint';

	private readonly _referencesListener = this._register(new MutableDisposable());

	constructor(
		private readonly widget: IChatWidget,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IThemeService private readonly themeService: IThemeService,
	) {
		super();

		this._register(this.codeEditorService.registerDecorationType(decorationDescription, commandArgumentHintDecorationType, {}));

		this.update();
		this._register(this.widget.onDidChangeParsedInput(() => this.update()));
		this._register(this.widget.inputEditor.onDidChangeModelContent(() => this.update()));
	}

	private update(): void {
		this._ensureSubscribedToReferences();
		const decoration = this.getArgumentHintDecoration();
		this.widget.inputEditor.setDecorationsByType(decorationDescription, commandArgumentHintDecorationType, decoration ? [decoration] : []);
	}

	private _ensureSubscribedToReferences(): void {
		if (this._referencesListener.value) {
			return;
		}
		const dynamicVariableModel = this.widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID);
		if (dynamicVariableModel) {
			this._referencesListener.value = dynamicVariableModel.onDidChangeReferences(() => this.update());
		}
	}

	private getArgumentHintDecoration(): IDecorationOptions | undefined {
		const model = this.widget.inputEditor.getModel();
		if (!model) {
			return undefined;
		}

		const dynamicVariableModel = this.widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID);
		if (!dynamicVariableModel) {
			return undefined;
		}

		for (const ref of dynamicVariableModel.variables) {
			if (getAgentHostCompletionReferenceKindFromValue(ref.data) !== AgentHostCompletionReferenceKind.Command) {
				continue;
			}
			const argumentHint = getCommandArgumentHint(ref._meta);
			if (!argumentHint) {
				continue;
			}

			if (!this.isCommandOnlyContent(model, ref.range)) {
				return undefined;
			}

			return {
				range: getRangeForPlaceholder(ref.range),
				renderOptions: {
					after: {
						contentText: argumentHint,
						color: getInputPlaceholderColor(this.themeService),
					}
				}
			};
		}

		return undefined;
	}

	private isCommandOnlyContent(model: ITextModel, range: IRange): boolean {
		const beforeRange = new Range(1, 1, range.startLineNumber, range.startColumn);
		if (model.getValueInRange(beforeRange).trim().length > 0) {
			return false;
		}

		const fullRange = model.getFullModelRange();
		const afterRange = new Range(range.endLineNumber, range.endColumn, fullRange.endLineNumber, fullRange.endColumn);
		return model.getValueInRange(afterRange) === ' ';
	}
}

ChatWidget.CONTRIBS.push(InputEditorCommandArgumentHint);
