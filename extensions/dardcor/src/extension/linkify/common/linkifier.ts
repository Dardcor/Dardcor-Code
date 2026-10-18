/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { CancellationError, isCancellationError } from '../../../util/dardcor/base/common/errors';
import { escapeRegExpCharacters } from '../../../util/dardcor/base/common/strings';
import { LinkifiedPart, LinkifiedText, coalesceParts } from './linkifiedText';
import type { IContributedLinkifier, ILinkifier, LinkifierContext } from './linkifyService';

namespace LinkifierState {
	export enum Type {
		Default,
		CodeOrMathBlock,
		Accumulating,
	}

	export enum AccumulationType {
		Word,
		InlineCodeOrMath,
		PotentialLink,
	}

	export const Default = { type: Type.Default } as const;

	export class CodeOrMathBlock {
		readonly type = Type.CodeOrMathBlock;

		constructor(
			public readonly fence: string,
			public readonly indent: string,
			public readonly contents = '',
		) { }

		appendContents(text: string): CodeOrMathBlock {
			return new CodeOrMathBlock(this.fence, this.indent, this.contents + text);
		}
	}

	export class Accumulating {
		readonly type = LinkifierState.Type.Accumulating;

		constructor(
			public readonly pendingText: string,
			public readonly accumulationType = LinkifierState.AccumulationType.Word,
			public readonly terminator?: string,
		) { }

		append(text: string): Accumulating {
			return new Accumulating(this.pendingText + text, this.accumulationType, this.terminator);
		}
	}

	export type State = typeof Default | CodeOrMathBlock | Accumulating;
}

export class Linkifier implements ILinkifier {

	private _state: LinkifierState.State = LinkifierState.Default;
	private _appliedText = '';

	private _totalAddedLinkCount = 0;

	constructor(
		private readonly context: LinkifierContext,
		private readonly productUriScheme: string,
		private readonly linkifiers: readonly IContributedLinkifier[] = [],
	) { }

	get totalAddedLinkCount(): number {
		return this._totalAddedLinkCount;
	}

	async append(newText: string, token: CancellationToken): Promise<LinkifiedText> {

		const out: LinkifiedPart[] = [];

		for (const part of newText.split(/(\s+)/)) {
			if (!part.length) {
				continue;
			}

			switch (this._state.type) {
				case LinkifierState.Type.Default: {
					if (/^\s+$/.test(part)) {
						out.push(this.doAppend(part));
					} else {

						if (/^[^\[`]*`[^`]*$/.test(part)) {
							this._state = new LinkifierState.Accumulating(part, LinkifierState.AccumulationType.InlineCodeOrMath, '`');
						}
						else if (/^`[^`]+`$/.test(part)) {
							out.push(...(await this.doLinkifyAndAppend(part, { skipUnlikify: true }, token)).parts);
						}
						else if (/^[^\[`]*\$[^\$]*$/.test(part)) {
							this._state = new LinkifierState.Accumulating(part, LinkifierState.AccumulationType.InlineCodeOrMath, '$');
						}
						else if (/^[^\[`]*\$[^\$]*\$$/.test(part)) {
							out.push(this.doAppend(part));
						}
						else if (/^\s*\[[^\]]*$/.test(part)) {
							this._state = new LinkifierState.Accumulating(part, LinkifierState.AccumulationType.PotentialLink);
						}
						else {
							this._state = new LinkifierState.Accumulating(part);
						}
					}
					break;
				}
				case LinkifierState.Type.CodeOrMathBlock: {
					if (
						new RegExp('(^|\\n)' + escapeRegExpCharacters(this._state.fence) + '($|\\n)').test(part)
						|| (this._state.contents.length > 2 && new RegExp('(^|\\n)\\s*' + escapeRegExpCharacters(this._state.fence) + '($|\\n\\s*$)').test(this._appliedText + part))
					) {
						const indent = this._appliedText.match(/(\n|^)([ \t]*)[`~]*$/);
						if (indent && indent[2].length <= this._state.indent.length) {
							this._state = LinkifierState.Default;
							out.push(this.doAppend(part));
							break;
						}
					}

					this._state = this._state.appendContents(part);

					out.push(this.doAppend(part));
					break;
				}
				case LinkifierState.Type.Accumulating: {
					const completeWord = async (state: LinkifierState.Accumulating, inPart: string, skipUnlikify: boolean) => {
						const toAppend = state.pendingText + inPart;
						this._state = LinkifierState.Default;
						const r = await this.doLinkifyAndAppend(toAppend, { skipUnlikify }, token);
						out.push(...r.parts);
					};

					if (this._state.accumulationType === LinkifierState.AccumulationType.PotentialLink) {
						if (/]/.test(part)) {
							this._state = this._state.append(part);
							break;
						} else if (/\n/.test(part)) {
							await completeWord(this._state, part, false);
							break;
						}
					} else if (this._state.accumulationType === LinkifierState.AccumulationType.InlineCodeOrMath && new RegExp(escapeRegExpCharacters(this._state.terminator ?? '`')).test(part)) {
						const terminator = this._state.terminator ?? '`';
						const terminalIndex = part.indexOf(terminator);
						if (terminalIndex === -1) {
							await completeWord(this._state, part, true);
						} else {
							if (terminator === '`') {
								await completeWord(this._state, part, true);
							} else {

								const pre = part.slice(0, terminalIndex + terminator.length);
								out.push(this.doAppend(this._state.pendingText + pre));

								const rest = part.slice(terminalIndex + terminator.length);
								this._state = LinkifierState.Default;
								if (rest.length) {
									out.push(...(await this.doLinkifyAndAppend(rest, { skipUnlikify: true }, token)).parts);
								}
							}
						}
						break;
					} else if (this._state.accumulationType === LinkifierState.AccumulationType.Word && /\s/.test(part)) {
						const toAppend = this._state.pendingText + part;
						this._state = LinkifierState.Default;

						const fence = toAppend.match(/(^|\n)\s*(`{3,}|~{3,}|\$\$)/);
						if (fence) {
							const indent = this._appliedText.match(/(\n|^)([ \t]*)$/);
							this._state = new LinkifierState.CodeOrMathBlock(fence[2], indent?.[2] ?? '');
							out.push(this.doAppend(toAppend));
						}
						else {
							const r = await this.doLinkifyAndAppend(toAppend, {}, token);
							out.push(...r.parts);
						}

						break;
					}

					this._state = this._state.append(part);
					break;
				}
			}
		}
		return { parts: coalesceParts(out) };
	}

	async flush(token: CancellationToken): Promise<LinkifiedText | undefined> {
		let out: LinkifiedText | undefined;

		switch (this._state.type) {
			case LinkifierState.Type.CodeOrMathBlock: {
				out = { parts: [this.doAppend(this._state.contents)] };
				break;
			}
			case LinkifierState.Type.Accumulating: {
				const toAppend = this._state.pendingText;
				out = await this.doLinkifyAndAppend(toAppend, {}, token);
				break;
			}
		}

		this._state = LinkifierState.Default;
		return out;
	}

	private doAppend(newText: string): string {
		this._appliedText = this._appliedText + newText;
		return newText;
	}

	private async doLinkifyAndAppend(newText: string, options: { skipUnlikify?: boolean }, token: CancellationToken): Promise<LinkifiedText> {
		if (newText.length === 0) {
			return { parts: [] };
		}

		this.doAppend(newText);

		let parts: LinkifiedPart[] = [newText];
		for (const linkifier of this.linkifiers) {
			parts = coalesceParts(await this.runLinkifier(parts, linkifier, token));
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
		}

		if (!options.skipUnlikify) {
			parts = parts.map(part => {
				if (typeof part === 'string') {
					return part.replaceAll(/\[([^\[\]]+)\]\(([^\s\)]+)\)/g, (matched, text, path) => {
						if (path.startsWith(this.productUriScheme + ':')) {
							return matched;
						}

						return /^\w{2,}:/.test(path) ? matched : text;
					});
				}
				return part;
			});
		}

		this._totalAddedLinkCount += parts.filter(part => typeof part !== 'string').length;
		return { parts };
	}

	private async runLinkifier(parts: readonly LinkifiedPart[], linkifier: IContributedLinkifier, token: CancellationToken): Promise<LinkifiedPart[]> {
		const out: LinkifiedPart[] = [];
		for (const part of parts) {
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}

			if (typeof part === 'string') {
				let linkified: LinkifiedText | undefined;
				try {
					linkified = await linkifier.linkify(part, this.context, token);
				} catch (e) {
					if (!isCancellationError(e)) {
						console.error(e);
					}
					out.push(part);
					continue;
				}

				if (linkified) {
					out.push(...linkified.parts);
				} else {
					out.push(part);
				}
			} else {
				out.push(part);
			}
		}
		return out;
	}
}
