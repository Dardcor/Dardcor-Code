/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SyntaxNode } from 'web-tree-sitter';
import { LRUCache } from '../../../util/common/cache';
import { OverlayNode, TreeSitterOffsetRange } from './nodes';
import { _parse } from './parserWithCaching';
import { runQueries } from './querying';
import { WASMLanguage } from './treeSitterLanguages';
import { syntacticallyValidAtoms } from './treeSitterQueries';

export class StructureComputer {

	private _cache = new LRUCache<OverlayNode | undefined>(5);

	public setCacheSize(size: number) {
		this._cache = new LRUCache(size);
	}

	public async getStructure(lang: WASMLanguage, source: string): Promise<OverlayNode | undefined> {
		const cacheKey = `${lang}:${source}`;
		let cacheValue = this._cache.get(cacheKey);
		if (!cacheValue) {
			cacheValue = await this._getStructure(lang, source);
			this._cache.put(cacheKey, cacheValue);
		}
		return cacheValue;
	}

	private async _getStructure(lang: WASMLanguage, source: string): Promise<OverlayNode | undefined> {
		const queries = syntacticallyValidAtoms[lang];

		if (queries.length === 0) {
			return undefined;
		}

		const treeRef = await _parse(lang, source);

		try {
			const captures = runQueries(queries, treeRef.tree.rootNode)
				.flatMap(e => e.captures)
				.sort((a, b) => TreeSitterOffsetRange.compare(a.node, b.node));

			const excludedRanges: TreeSitterOffsetRange[] = [];
			for (const capture of captures) {
				if (capture.name.endsWith('.exclude_captures')) {
					excludedRanges.push(TreeSitterOffsetRange.ofSyntaxNode(capture.node));
				}
			}

			const root = new OverlayNode(0, source.length, 'root', []);

			const parentStack = [root];

			for (let i = 0; i < captures.length; ++i) {
				const currentCapture = captures[i];
				const currentNode = currentCapture.node;

				if (excludedRanges.some(r => TreeSitterOffsetRange.isEqual(r, currentNode))) {
					continue;
				}

				let currentParent: OverlayNode;
				do {
					currentParent = parentStack.pop()!;
				} while (currentParent && !TreeSitterOffsetRange.doesContain(currentParent, currentNode));

				const ambientParents = new Set(['export_statement', 'ambient_declaration']);

				if (ambientParents.has(currentParent.kind)) {

					currentParent.kind = currentNode.type;
					parentStack.push(currentParent);

				} else {
					let nodeKind = currentNode.type;
					if ((lang === WASMLanguage.TypeScript || lang === WASMLanguage.TypeScriptTsx || lang === WASMLanguage.JavaScript) &&
						nodeKind === 'method_definition' && currentNode.namedChildren.some(c => c.type === 'property_identifier' && c.text === 'constructor')) {
						nodeKind = 'constructor';
					}

					let startIndex = currentNode.startIndex;

					const prevSibling = currentNode.previousSibling;
					if (prevSibling !== null) {
						const textBetweenNodes = source.substring(prevSibling.endIndex, currentNode.startIndex);
						const nlIdx = textBetweenNodes.indexOf('\n');
						if (nlIdx === -1) {
							startIndex = prevSibling.endIndex;
						} else {
							startIndex = prevSibling.endIndex + nlIdx + 1;
						}
					}

					let endIndex = currentNode.endIndex;

					if (currentNode.nextSibling !== null) {
						let nextSibling: SyntaxNode | null = currentNode.nextSibling;

						if (lang === WASMLanguage.TypeScript || lang === WASMLanguage.TypeScriptTsx || lang === WASMLanguage.JavaScript || lang === WASMLanguage.Cpp) {
							while (nextSibling &&
								(nextSibling.type === ';' ||
									nextSibling.type === ',' ||
									(nextSibling.type === 'comment' && !source.substring(endIndex, nextSibling.startIndex).includes('\n') ))
							) {
								excludedRanges.push(TreeSitterOffsetRange.ofSyntaxNode(nextSibling));
								endIndex = nextSibling.endIndex;
								nextSibling = nextSibling.nextSibling;
							}
						}

						if (nextSibling !== null) {
							const textBetweenNodes = source.substring(endIndex, nextSibling.startIndex);
							const nlIdx = textBetweenNodes.indexOf('\n');
							if (nlIdx !== -1) {
								endIndex = endIndex + nlIdx + 1;
							}
						}
					}

					const newNode = new OverlayNode(startIndex, endIndex, nodeKind, []);
					currentParent.children.push(newNode);
					parentStack.push(currentParent, newNode);
				}
			}

			return root;

		} catch (e) {
			console.error(e instanceof Error ? e : new Error(e));
		} finally {
			treeRef.dispose();
		}
	}
}

export const structureComputer = new StructureComputer();
