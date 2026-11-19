/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeSitterChunkHeaderInfo, TreeSitterOffsetRange } from './nodes';


export interface GenericDetail extends DetailBlock {
	comments: TreeSitterChunkHeaderInfo[];
}
export interface PythonDetail extends DetailBlock {
	docstring?: TreeSitterChunkHeaderInfo;
	decorator?: TreeSitterChunkHeaderInfo;
}

export interface BlockNameDetail extends DetailBlock {
	name: string | undefined;
}

export interface DetailBlock {
	body: TreeSitterChunkHeaderInfo;
}

export interface MatchGroup<DetailType extends DetailBlock> {
	mainBlock: TreeSitterChunkHeaderInfo;
	detailBlocks: DetailType;
}

export interface QueryMatchNode<DetailType extends DetailBlock> {
	info: MatchGroup<DetailType>;
	children: QueryMatchNode<DetailType>[];
}

export class QueryMatchTree<DetailType extends DetailBlock> {

	public roots: QueryMatchNode<DetailType>[] = [];

	constructor(groups: MatchGroup<DetailType>[], public readonly syntaxTreeRoot: TreeSitterChunkHeaderInfo) {
		this.formTree(groups);
	}
	private formTree(groups: MatchGroup<DetailType>[]) {
		groups
			.sort((a, b) => a.mainBlock.startIndex - b.mainBlock.startIndex || a.mainBlock.endIndex - b.mainBlock.endIndex);

		const recentParentStack: QueryMatchNode<DetailType>[] = [];

		const peekParent = () => {
			return recentParentStack[recentParentStack.length - 1];
		};

		const hasEqualRange = (a: MatchGroup<DetailType>, b: MatchGroup<DetailType>) => {
			return (a.mainBlock.startIndex === b.mainBlock.startIndex &&
				a.mainBlock.endIndex === b.mainBlock.endIndex);
		};

		for (const group of groups) {
			const matchNode: QueryMatchNode<DetailType> = {
				info: group,
				children: []
			};
			let currParent = peekParent();

			if (!currParent) {
				this.roots.push(matchNode);
				recentParentStack.push(matchNode);
				continue;
			}

			if (hasEqualRange(currParent.info, group)) {
				continue;
			}

			while (currParent && !TreeSitterOffsetRange.doesContain(currParent.info.mainBlock, group.mainBlock)) {
				recentParentStack.pop();
				currParent = peekParent();
			}



			if (currParent) {
				currParent.children.push(matchNode);
			} else {
				this.roots.push(matchNode);
			}

			recentParentStack.push(matchNode);
		}
	}

}


export interface BlockNameNode {
	name: string;
	children: BlockNameNode[];
}
