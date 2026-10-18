/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export const enum PromptNodeType {
	Piece = 1,
	Text = 2
}
export interface TextJSON {
	type: PromptNodeType.Text;
	text: string;
	lineBreakBefore: boolean | undefined;
}
export const enum PieceCtorKind {
	BaseChatMessage = 1,
	Other = 2,
	ImageChatMessage = 3
}
export interface BasePieceJSON {
	type: PromptNodeType.Piece;
	ctor: PieceCtorKind.BaseChatMessage | PieceCtorKind.Other;
	children: PromptNodeJSON[];
}
export interface ImageChatMessagePieceJSON {
	type: PromptNodeType.Piece;
	ctor: PieceCtorKind.ImageChatMessage;
	children: PromptNodeJSON[];
	props: {
		src: string;
		detail?: 'low' | 'high';
	};
}
export type PieceJSON = BasePieceJSON | ImageChatMessagePieceJSON;
export type PromptNodeJSON = PieceJSON | TextJSON;
export interface PromptElementJSON {
	node: PieceJSON;
}

export function stringifyPromptElementJSON(element: PromptElementJSON): string {
	const strs: string[] = [];
	stringifyPromptNodeJSON(element.node, strs);
	return strs.join('');
}

function stringifyPromptNodeJSON(node: PromptNodeJSON, strs: string[]): void {
	if (node.type === PromptNodeType.Text) {
		if (node.lineBreakBefore) {
			strs.push('\n');
		}

		if (typeof node.text === 'string') {
			strs.push(node.text);
		}
	} else if (node.ctor === PieceCtorKind.ImageChatMessage) {
		strs.push('<image>');
	} else if (node.ctor === PieceCtorKind.BaseChatMessage || node.ctor === PieceCtorKind.Other) {
		for (const child of node.children) {
			stringifyPromptNodeJSON(child, strs);
		}
	}
}
