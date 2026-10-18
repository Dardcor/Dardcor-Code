/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseTreeSitter } from '../parse';
import { DocumentInfoWithOffset } from '../prompt';
import { CursorContextInfo, getCursorContext } from './cursorContext';
import { WindowedMatcher } from './selectRelevance';
import { getBasicWindowDelineations } from './windowDelineations';
import Parser from 'web-tree-sitter';

export class BlockTokenSubsetMatcher extends WindowedMatcher {
	private windowLength: number;

	private constructor(referenceDoc: DocumentInfoWithOffset, windowLength: number) {
		super(referenceDoc);
		this.windowLength = windowLength;
	}

	static FACTORY = (windowLength: number) => {
		return {
			to: (referenceDoc: DocumentInfoWithOffset) => new BlockTokenSubsetMatcher(referenceDoc, windowLength),
		};
	};

	protected id(): string {
		return 'fixed:' + this.windowLength;
	}

	protected getWindowsDelineations(lines: string[]): [number, number][] {
		return getBasicWindowDelineations(this.windowLength, lines);
	}

	protected _getCursorContextInfo(referenceDoc: DocumentInfoWithOffset): CursorContextInfo {
		return getCursorContext(referenceDoc, {
			maxLineCount: this.windowLength,
		});
	}

	override get referenceTokens(): Promise<Set<string>> {
		return this.createReferenceTokensForLanguage();
	}

	private async createReferenceTokensForLanguage(): Promise<Set<string>> {
		if (this.referenceTokensCache) {
			return this.referenceTokensCache;
		}

		this.referenceTokensCache = BlockTokenSubsetMatcher.syntaxAwareSupportsLanguage(this.referenceDoc.languageId)
			? await this.syntaxAwareReferenceTokens()
			: await super.referenceTokens;

		return this.referenceTokensCache;
	}

	private async syntaxAwareReferenceTokens(): Promise<Set<string>> {
		const start = (await this.getEnclosingMemberStart(this.referenceDoc.source, this.referenceDoc.offset))
			?.startIndex;
		const end = this.referenceDoc.offset;

		const text = start
			? this.referenceDoc.source.slice(start, end)
			: getCursorContext(this.referenceDoc, {
				maxLineCount: this.windowLength,
			}).context;

		return this.tokenizer.tokenize(text);
	}

	private static syntaxAwareSupportsLanguage(languageId: string): boolean {
		switch (languageId) {
			case 'csharp':
				return true;
			default:
				return false;
		}
	}

	protected similarityScore(a: Set<string>, b: Set<string>): number {
		return computeScore(a, b);
	}

	async getEnclosingMemberStart(text: string, offset: number): Promise<Parser.SyntaxNode | undefined> {
		let tree: Parser.Tree | undefined;

		try {
			tree = await parseTreeSitter(this.referenceDoc.languageId, text);

			let nodeAtPos: Parser.SyntaxNode | undefined = tree.rootNode.namedDescendantForIndex(offset);

			while (nodeAtPos) {
				if (BlockTokenSubsetMatcher.isMember(nodeAtPos) || BlockTokenSubsetMatcher.isBlock(nodeAtPos)) {
					break;
				}

				nodeAtPos = nodeAtPos.parent ?? undefined;
			}

			return nodeAtPos;
		} finally {
			tree?.delete();
		}
	}

	static isMember(node: Parser.SyntaxNode | undefined): boolean {
		switch (node?.type) {
			case 'method_declaration':
			case 'property_declaration':
			case 'field_declaration':
			case 'constructor_declaration':
				return true;
			default:
				return false;
		}
	}

	static isBlock(node: Parser.SyntaxNode | undefined): boolean {
		switch (node?.type) {
			case 'class_declaration':
			case 'struct_declaration':
			case 'record_declaration':
			case 'enum_declaration':
			case 'interface_declaration':
				return true;
			default:
				return false;
		}
	}
}

function computeScore(a: Set<string>, b: Set<string>) {
	const subsetOverlap = new Set();

	b.forEach(x => {
		if (a.has(x)) {
			subsetOverlap.add(x);
		}
	});

	return subsetOverlap.size;
}
