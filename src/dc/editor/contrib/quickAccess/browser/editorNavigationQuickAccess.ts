/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { createSingleCallFunction } from '../../../../base/common/functional.js';
import { DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { getCodeEditor, isDiffEditor } from '../../../browser/editorBrowser.js';
import { IRange } from '../../../common/core/range.js';
import { IDiffEditor, IEditor, ScrollType } from '../../../common/editorCommon.js';
import { IModelDeltaDecoration, ITextModel, OverviewRulerLane } from '../../../common/model.js';
import { overviewRulerRangeHighlight } from '../../../common/core/editorColorRegistry.js';
import { IQuickAccessProvider, IQuickAccessProviderRunOptions } from '../../../../platform/quickinput/common/quickAccess.js';
import { IKeyMods, IQuickPick, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { themeColorFromId } from '../../../../platform/theme/common/themeService.js';
import { status } from '../../../../base/browser/ui/aria/aria.js';
import { TextEditorSelectionSource } from '../../../../platform/editor/common/editor.js';

interface IEditorLineDecoration {
	readonly rangeHighlightId: string;
	readonly overviewRulerDecorationId: string;
}

export interface IEditorNavigationQuickAccessOptions {
	canAcceptInBackground?: boolean;
}

export interface IQuickAccessTextEditorContext {

	readonly editor: IEditor;

	restoreViewState?: () => void;
}

export abstract class AbstractEditorNavigationQuickAccessProvider implements IQuickAccessProvider {

	constructor(protected options?: IEditorNavigationQuickAccessOptions) { }


	provide(picker: IQuickPick<IQuickPickItem, { useSeparators: true }>, token: CancellationToken, runOptions?: IQuickAccessProviderRunOptions): IDisposable {
		const disposables = new DisposableStore();

		picker.canAcceptInBackground = !!this.options?.canAcceptInBackground;

		picker.matchOnLabel = picker.matchOnDescription = picker.matchOnDetail = picker.sortByLabel = false;

		const pickerDisposable = disposables.add(new MutableDisposable());
		pickerDisposable.value = this.doProvide(picker, token, runOptions);

		disposables.add(this.onDidActiveTextEditorControlChange(() => {

			pickerDisposable.value = undefined;

			pickerDisposable.value = this.doProvide(picker, token);
		}));

		return disposables;
	}

	private doProvide(picker: IQuickPick<IQuickPickItem, { useSeparators: true }>, token: CancellationToken, runOptions?: IQuickAccessProviderRunOptions): IDisposable {
		const disposables = new DisposableStore();

		const editor = this.activeTextEditorControl;
		if (editor && this.canProvideWithTextEditor(editor)) {
			const context: IQuickAccessTextEditorContext = { editor };

			const codeEditor = getCodeEditor(editor);
			if (codeEditor) {

				let lastKnownEditorViewState = editor.saveViewState() ?? undefined;
				disposables.add(codeEditor.onDidChangeCursorPosition(() => {
					lastKnownEditorViewState = editor.saveViewState() ?? undefined;
				}));

				context.restoreViewState = () => {
					if (lastKnownEditorViewState && editor === this.activeTextEditorControl) {
						editor.restoreViewState(lastKnownEditorViewState);
					}
				};

				disposables.add(createSingleCallFunction(token.onCancellationRequested)(() => context.restoreViewState?.()));
			}

			disposables.add(toDisposable(() => this.clearDecorations(editor)));

			disposables.add(this.provideWithTextEditor(context, picker, token, runOptions));
		}

		else {
			disposables.add(this.provideWithoutTextEditor(picker, token));
		}

		return disposables;
	}

	protected canProvideWithTextEditor(editor: IEditor): boolean {
		return true;
	}

	protected abstract provideWithTextEditor(context: IQuickAccessTextEditorContext, picker: IQuickPick<IQuickPickItem, { useSeparators: true }>, token: CancellationToken, runOptions?: IQuickAccessProviderRunOptions): IDisposable;

	protected abstract provideWithoutTextEditor(picker: IQuickPick<IQuickPickItem, { useSeparators: true }>, token: CancellationToken): IDisposable;

	protected gotoLocation({ editor }: IQuickAccessTextEditorContext, options: { range: IRange; keyMods: IKeyMods; forceSideBySide?: boolean; preserveFocus?: boolean }): void {
		editor.setSelection(options.range, TextEditorSelectionSource.JUMP);
		editor.revealRangeInCenter(options.range, ScrollType.Smooth);
		if (!options.preserveFocus) {
			editor.focus();
		}

		const model = this.getModel(editor);
		if (model) {
			const lineContent = model.getLineContent(options.range.startLineNumber);
			status(localize('gotoLocation.status', "Line {0}, column {1}: {2}", options.range.startLineNumber, options.range.startColumn, lineContent));
		}
	}

	protected getModel(editor: IEditor | IDiffEditor): ITextModel | undefined {
		return isDiffEditor(editor) ?
			editor.getModel()?.modified :
			editor.getModel() as ITextModel;
	}




	protected abstract readonly onDidActiveTextEditorControlChange: Event<void>;

	protected abstract activeTextEditorControl: IEditor | undefined;




	private rangeHighlightDecorationId: IEditorLineDecoration | undefined = undefined;

	addDecorations(editor: IEditor, range: IRange): void {
		editor.changeDecorations(changeAccessor => {

			const deleteDecorations: string[] = [];
			if (this.rangeHighlightDecorationId) {
				deleteDecorations.push(this.rangeHighlightDecorationId.overviewRulerDecorationId);
				deleteDecorations.push(this.rangeHighlightDecorationId.rangeHighlightId);

				this.rangeHighlightDecorationId = undefined;
			}

			const newDecorations: IModelDeltaDecoration[] = [

				{
					range,
					options: {
						description: 'quick-access-range-highlight',
						className: 'rangeHighlight',
						isWholeLine: true
					}
				},

				{
					range,
					options: {
						description: 'quick-access-range-highlight-overview',
						overviewRuler: {
							color: themeColorFromId(overviewRulerRangeHighlight),
							position: OverviewRulerLane.Full
						}
					}
				}
			];

			const [rangeHighlightId, overviewRulerDecorationId] = changeAccessor.deltaDecorations(deleteDecorations, newDecorations);

			this.rangeHighlightDecorationId = { rangeHighlightId, overviewRulerDecorationId };
		});
	}

	clearDecorations(editor: IEditor): void {
		const rangeHighlightDecorationId = this.rangeHighlightDecorationId;
		if (rangeHighlightDecorationId) {
			editor.changeDecorations(changeAccessor => {
				changeAccessor.deltaDecorations([
					rangeHighlightDecorationId.overviewRulerDecorationId,
					rangeHighlightDecorationId.rangeHighlightId
				], []);
			});

			this.rangeHighlightDecorationId = undefined;
		}
	}

}
