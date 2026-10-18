/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { CompletionItem, CompletionItemKind, CompletionsParams, CompletionsResult } from '../common/state/protocol/commands.js';

export const IAgentHostCompletions = createDecorator<IAgentHostCompletions>('agentHostCompletions');

export const enum CompletionTriggerCharacter {
	File = '@',
	Hash = '#',
	Slash = '/',
}

export interface IAgentHostCompletionItemProvider {
	readonly kinds: ReadonlySet<CompletionItemKind>;

	readonly triggerCharacters?: readonly string[];

	provideCompletionItems(params: CompletionsParams, token: CancellationToken): Promise<readonly CompletionItem[]>;
}

export interface IAgentHostCompletions {
	readonly _serviceBrand: undefined;

	readonly triggerCharacters: readonly string[];

	registerProvider(provider: IAgentHostCompletionItemProvider): IDisposable;

	completions(params: CompletionsParams, token?: CancellationToken): Promise<CompletionsResult>;
}

export class AgentHostCompletions extends Disposable implements IAgentHostCompletions {
	declare readonly _serviceBrand: undefined;

	private readonly _providers = new Set<IAgentHostCompletionItemProvider>();

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	get triggerCharacters(): readonly string[] {
		const seen = new Set<string>();
		for (const provider of this._providers) {
			if (provider.triggerCharacters) {
				for (const ch of provider.triggerCharacters) {
					seen.add(ch);
				}
			}
		}
		return [...seen];
	}

	registerProvider(provider: IAgentHostCompletionItemProvider): IDisposable {
		this._providers.add(provider);
		return toDisposable(() => this._providers.delete(provider));
	}

	async completions(params: CompletionsParams, token: CancellationToken = CancellationToken.None): Promise<CompletionsResult> {
		const matching = [...this._providers].filter(p => p.kinds.has(params.kind));
		if (matching.length === 0) {
			return { items: [] };
		}
		const settled = await Promise.allSettled(
			matching.map(p => p.provideCompletionItems(params, token)),
		);
		const items: CompletionItem[] = [];
		for (let i = 0; i < settled.length; i++) {
			const result = settled[i];
			if (result.status === 'fulfilled') {
				items.push(...result.value);
			} else {
				this._logService.error(result.reason, `[AgentHostCompletions] Provider failed for kind=${params.kind}`);
			}
		}
		return { items };
	}
}
