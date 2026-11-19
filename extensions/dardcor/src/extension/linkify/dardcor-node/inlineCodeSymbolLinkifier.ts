/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { collapseRangeToStart } from '../../../util/common/range';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { CancellationError } from '../../../util/dardcor/base/common/errors';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { SymbolInformation } from '../../../dardcorTypes';
import { LinkifiedPart, LinkifiedText, LinkifySymbolAnchor } from '../common/linkifiedText';
import { IContributedLinkifier, LinkifierContext } from '../common/linkifyService';
import { resolveSymbolFromReferences } from './commands';
import { ReferencesSymbolResolver } from './findWord';

export const inlineCodeRegexp = /(?<!\[)`([^`\n]+)`(?!\])/g;

const maxPotentialWordMatches = 8;

export class InlineCodeSymbolLinkifier implements IContributedLinkifier {
	private readonly resolver: ReferencesSymbolResolver;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		this.resolver = instantiationService.createInstance(ReferencesSymbolResolver, { symbolMatchesOnly: true, maxResultCount: maxPotentialWordMatches });
	}

	async linkify(text: string, context: LinkifierContext, token: CancellationToken): Promise<LinkifiedText | undefined> {
		if (!context.references.length || vscode.version.startsWith('1.94')) {
			return;
		}

		const matches = [...text.matchAll(inlineCodeRegexp)];
		if (!matches.length) {
			return;
		}

		const uniqueSymbols = [...new Set(matches.map(m => m[1]))];
		const resolvedMap = new Map<string, readonly vscode.Location[] | undefined>();
		const results = await Promise.all(
			uniqueSymbols.map(sym => this.tryResolveSymbol(sym, context, token))
		);
		for (let i = 0; i < uniqueSymbols.length; i++) {
			resolvedMap.set(uniqueSymbols[i], results[i]);
		}

		if (token.isCancellationRequested) {
			throw new CancellationError();
		}

		const out: LinkifiedPart[] = [];
		let endLastMatch = 0;
		for (let i = 0; i < matches.length; i++) {
			const match = matches[i];
			const prefix = text.slice(endLastMatch, match.index);
			if (prefix) {
				out.push(prefix);
			}

			const symbolText = match[1];
			const loc = resolvedMap.get(symbolText);

			if (loc?.length) {
				const info: SymbolInformation = {
					name: symbolText,
					containerName: '',
					kind: vscode.SymbolKind.Variable,
					location: loc[0]
				};

				out.push(new LinkifySymbolAnchor(info, async (token) => {
					const dest = await resolveSymbolFromReferences(loc.map(l => ({ uri: l.uri, pos: l.range.start })), symbolText, token);
					if (dest) {
						const selectionRange = dest.loc.targetSelectionRange ?? dest.loc.targetRange;
						info.location = new vscode.Location(dest.loc.targetUri, collapseRangeToStart(selectionRange));

					}

					return info;
				}));
			} else {
				out.push(match[0]);
			}

			endLastMatch = match.index + match[0].length;
		}

		const suffix = text.slice(endLastMatch);
		if (suffix) {
			out.push(suffix);
		}

		return { parts: out };
	}

	private async tryResolveSymbol(symbolText: string, context: LinkifierContext, token: CancellationToken): Promise<vscode.Location[] | undefined> {
		if (/^https?:\/\//i.test(symbolText)) {
			return;
		}

		return this.resolver.resolve(symbolText, context.references, token);
	}
}
