/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AstNode, AstNodeKind, BracketAstNode, InvalidBracketAstNode, ListAstNode, PairAstNode, TextAstNode } from './ast.js';
import { BeforeEditPositionMapper, TextEditInfo } from './beforeEditPositionMapper.js';
import { SmallImmutableSet } from './smallImmutableSet.js';
import { lengthIsZero, lengthLessThan } from './length.js';
import { concat23Trees, concat23TreesOfSameHeight } from './concat23Trees.js';
import { NodeReader } from './nodeReader.js';
import { OpeningBracketId, Tokenizer, TokenKind } from './tokenizer.js';

export function parseDocument(tokenizer: Tokenizer, edits: TextEditInfo[], oldNode: AstNode | undefined, createImmutableLists: boolean): AstNode {
	const parser = new Parser(tokenizer, edits, oldNode, createImmutableLists);
	return parser.parseDocument();
}

class Parser {
	private readonly oldNodeReader?: NodeReader;
	private readonly positionMapper: BeforeEditPositionMapper;
	private _itemsConstructed: number = 0;
	private _itemsFromCache: number = 0;

	get nodesConstructed() {
		return this._itemsConstructed;
	}

	get nodesReused() {
		return this._itemsFromCache;
	}

	constructor(
		private readonly tokenizer: Tokenizer,
		edits: TextEditInfo[],
		oldNode: AstNode | undefined,
		private readonly createImmutableLists: boolean,
	) {
		if (oldNode && createImmutableLists) {
			throw new Error('Not supported');
		}

		this.oldNodeReader = oldNode ? new NodeReader(oldNode) : undefined;
		this.positionMapper = new BeforeEditPositionMapper(edits);
	}

	parseDocument(): AstNode {
		this._itemsConstructed = 0;
		this._itemsFromCache = 0;

		let result = this.parseList(SmallImmutableSet.getEmpty(), 0);
		if (!result) {
			result = ListAstNode.getEmpty();
		}

		return result;
	}

	private parseList(
		openedBracketIds: SmallImmutableSet<OpeningBracketId>,
		level: number,
	): AstNode | null {
		const items: AstNode[] = [];

		while (true) {
			let child = this.tryReadChildFromCache(openedBracketIds);

			if (!child) {
				const token = this.tokenizer.peek();
				if (
					!token ||
					(token.kind === TokenKind.ClosingBracket &&
						token.bracketIds.intersects(openedBracketIds))
				) {
					break;
				}

				child = this.parseChild(openedBracketIds, level + 1);
			}

			if (child.kind === AstNodeKind.List && child.childrenLength === 0) {
				continue;
			}

			items.push(child);
		}

		const result = this.oldNodeReader ? concat23Trees(items) : concat23TreesOfSameHeight(items, this.createImmutableLists);
		return result;
	}

	private tryReadChildFromCache(openedBracketIds: SmallImmutableSet<number>): AstNode | undefined {
		if (this.oldNodeReader) {
			const maxCacheableLength = this.positionMapper.getDistanceToNextChange(this.tokenizer.offset);
			if (maxCacheableLength === null || !lengthIsZero(maxCacheableLength)) {
				const cachedNode = this.oldNodeReader.readLongestNodeAt(this.positionMapper.getOffsetBeforeChange(this.tokenizer.offset), curNode => {
					if (maxCacheableLength !== null && !lengthLessThan(curNode.length, maxCacheableLength)) {
						return false;
					}
					const canBeReused = curNode.canBeReused(openedBracketIds);
					return canBeReused;
				});

				if (cachedNode) {
					this._itemsFromCache++;
					this.tokenizer.skip(cachedNode.length);
					return cachedNode;
				}
			}
		}
		return undefined;
	}

	private parseChild(
		openedBracketIds: SmallImmutableSet<number>,
		level: number,
	): AstNode {
		this._itemsConstructed++;

		const token = this.tokenizer.read()!;

		switch (token.kind) {
			case TokenKind.ClosingBracket:
				return new InvalidBracketAstNode(token.bracketIds, token.length);

			case TokenKind.Text:
				return token.astNode as TextAstNode;

			case TokenKind.OpeningBracket: {
				if (level > 300) {
					return new TextAstNode(token.length);
				}

				const set = openedBracketIds.merge(token.bracketIds);
				const child = this.parseList(set, level + 1);

				const nextToken = this.tokenizer.peek();
				if (
					nextToken &&
					nextToken.kind === TokenKind.ClosingBracket &&
					(nextToken.bracketId === token.bracketId || nextToken.bracketIds.intersects(token.bracketIds))
				) {
					this.tokenizer.read();
					return PairAstNode.create(
						token.astNode as BracketAstNode,
						child,
						nextToken.astNode as BracketAstNode
					);
				} else {
					return PairAstNode.create(
						token.astNode as BracketAstNode,
						child,
						null
					);
				}
			}
			default:
				throw new Error('unexpected');
		}
	}
}
