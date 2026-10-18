/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../../base/common/cancellation.js';
import { Disposable, IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { Position } from '../../../../../../../editor/common/core/position.js';
import { Range } from '../../../../../../../editor/common/core/range.js';
import { CompletionItem, CompletionItemKind, CompletionList } from '../../../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../../../editor/common/model.js';
import { LanguageFilter } from '../../../../../../../editor/common/languageSelector.js';
import { ILanguageFeaturesService } from '../../../../../../../editor/common/services/languageFeatures.js';
import { IChatInputCompletionItem, IChatSessionsService } from '../../../../common/chatSessionsService.js';
import { isAtTriggerCharacterToken } from './chatInputCompletionUtils.js';

export abstract class AgentHostInputCompletionsBase<TContext, TRegData = void> extends Disposable {

	constructor(
		protected readonly _languageFeaturesService: ILanguageFeaturesService,
		protected readonly _chatSessionsService: IChatSessionsService,
	) {
		super();
	}

	protected abstract _resolveContext(model: ITextModel, regData: TRegData): { sessionResource: URI; context: TContext } | undefined;

	protected abstract _buildItem(position: Position, item: IChatInputCompletionItem, context: TContext): CompletionItem | undefined;

	protected _registerProvider(filter: LanguageFilter, debugName: string, triggerCharacters: readonly string[], regData: TRegData): IDisposable {
		return this._languageFeaturesService.completionProvider.register(filter, {
			_debugDisplayName: debugName,
			triggerCharacters: [...triggerCharacters],
			provideCompletionItems: (model, position, _context, token) => this._provide(model, position, token, triggerCharacters, regData),
		});
	}

	private async _provide(model: ITextModel, position: Position, token: CancellationToken, triggerCharacters: readonly string[], regData: TRegData): Promise<CompletionList | null> {
		if (!isAtTriggerCharacterToken(model, position, triggerCharacters)) {
			return null;
		}

		const ctx = this._resolveContext(model, regData);
		if (!ctx) {
			return null;
		}

		const text = model.getValue();
		const offset = model.getOffsetAt(position);
		const result = await this._chatSessionsService.provideChatInputCompletions(ctx.sessionResource, { text, offset }, token);
		if (token.isCancellationRequested || !result) {
			return null;
		}

		const suggestions: CompletionItem[] = [];
		for (const item of result.items) {
			const built = this._buildItem(position, item, ctx.context);
			if (built) {
				if (item.start && (built.kind === CompletionItemKind.File || built.kind === CompletionItemKind.Folder)) {
					built.filterText = model.getValueInRange(Range.fromPositions(item.start, position));
				}
				built.sortText ??= suggestions.length.toString().padStart(6, '0');
				suggestions.push(built);
			}
		}
		return { suggestions, incomplete: true };
	}

	protected static computeRange(position: Position, item: IChatInputCompletionItem): { insert: Range; replace: Range } {
		const start = item.start ?? position;
		const end = item.end ?? position;
		const replace = new Range(start.lineNumber, start.column, end.lineNumber, end.column);
		const insert = new Range(start.lineNumber, start.column, position.lineNumber, position.column);
		return { insert, replace };
	}
}
