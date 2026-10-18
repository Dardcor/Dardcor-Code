/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { localize } from '../../../nls.js';
import type { URI } from '../common/state/protocol/common/state.js';
import { CompletionItem, CompletionItemKind, CompletionsParams } from '../common/state/protocol/commands.js';
import { MessageAttachmentKind } from '../common/state/protocol/state.js';
import { toCommandCompletionAttachmentMeta } from '../common/meta/agentCompletionAttachmentMeta.js';
import { CompletionTriggerCharacter, IAgentHostCompletionItemProvider } from './agentHostCompletions.js';
import { extractLeadingSlashToken, matchesSlashCompletion } from './agentHostSlashCompletion.js';

export const RENAME_SLASH_COMMAND = 'rename';

export function parseRenameCommand(prompt: string): string | undefined {
	const match = /^\/rename(?:$|\s+([\s\S]*))/.exec(prompt);
	if (!match) {
		return undefined;
	}
	return (match[1] ?? '').trim();
}

export class AgentHostRenameCompletionProvider implements IAgentHostCompletionItemProvider {
	readonly kinds: ReadonlySet<CompletionItemKind> = new Set([CompletionItemKind.UserMessage]);
	readonly triggerCharacters = [CompletionTriggerCharacter.Slash] as const;

	constructor(private readonly _hasHistory: (session: URI) => boolean) { }

	async provideCompletionItems(params: CompletionsParams, _token: CancellationToken): Promise<readonly CompletionItem[]> {
		const leading = extractLeadingSlashToken(params.text, params.offset);
		if (!leading) {
			return [];
		}
		if (!this._hasHistory(params.channel)) {
			return [];
		}
		const typed = leading.typed;
		if (!matchesSlashCompletion(typed, RENAME_SLASH_COMMAND)) {
			return [];
		}
		return [{
			insertText: '/' + RENAME_SLASH_COMMAND + ' ',
			rangeStart: leading.rangeStart,
			rangeEnd: leading.rangeEnd,
			attachment: {
				type: MessageAttachmentKind.Simple,
				label: '/' + RENAME_SLASH_COMMAND,
				_meta: toCommandCompletionAttachmentMeta({
					command: RENAME_SLASH_COMMAND,
					description: localize('agentHostSlashCommand.rename.description', "Rename this chat"),
				}),
			},
		}];
	}
}
