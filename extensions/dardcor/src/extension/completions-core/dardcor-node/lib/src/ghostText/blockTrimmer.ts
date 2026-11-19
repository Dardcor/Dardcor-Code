/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { StatementNode, StatementTree } from './statementTree';
import { IPosition, TextDocumentContents } from '../textDocument';

export abstract class BlockTrimmer {
	static isSupported(languageId: string): boolean {
		return StatementTree.isSupported(languageId);
	}

	static isTrimmedByDefault(languageId: string): boolean {
		return StatementTree.isTrimmedByDefault(languageId);
	}

	constructor(
		protected readonly languageId: string,
		protected readonly prefix: string,
		protected readonly completion: string
	) { }

	abstract getCompletionTrimOffset(): Promise<number | undefined>;

	protected async withParsedStatementTree<T>(fn: (tree: StatementTree) => Promise<T> | T): Promise<T> {
		const tree = StatementTree.create(
			this.languageId,
			this.prefix + this.completion,
			this.prefix.length,
			this.prefix.length + this.completion.length
		);
		await tree.build();

		try {
			return await fn(tree);
		} finally {
			tree[Symbol.dispose]();
		}
	}

	protected trimmedCompletion(offset: number | undefined): string {
		return offset === undefined ? this.completion : this.completion.substring(0, offset);
	}

	protected getStatementAtCursor(tree: StatementTree): StatementNode | undefined {
		return tree.statementAt(Math.max(this.prefix.length - 1, 0)) ?? tree.statements[0];
	}

	protected getContainingBlockOffset(stmt: StatementNode | undefined): number | undefined {
		let trimTo: StatementNode | undefined;
		if (stmt && this.isCompoundStatement(stmt)) {
			trimTo = stmt;
		} else if (stmt) {
			let parent = stmt.parent;
			while (parent && !this.isCompoundStatement(parent)) {
				parent = parent.parent;
			}
			trimTo = parent;
		}

		if (trimTo) {
			const newOffset = this.asCompletionOffset(trimTo.node.endIndex);

			if (newOffset && this.completion.substring(newOffset).trim() !== '') { return newOffset; }
		}
		return undefined;
	}

	protected hasNonStatementContentAfter(stmt: StatementNode | undefined): boolean {
		if (!stmt || !stmt.nextSibling) { return false; }
		const spanStart = this.asCompletionOffset(stmt.node.endIndex);
		const spanEnd = this.asCompletionOffset(stmt.nextSibling.node.startIndex);
		const content = this.completion.substring(Math.max(0, spanStart ?? 0), Math.max(0, spanEnd ?? 0));
		return content.trim() !== '';
	}

	protected asCompletionOffset(offset: number | undefined): number | undefined {
		return offset === undefined ? undefined : offset - this.prefix.length;
	}

	protected isCompoundStatement(stmt: StatementNode): boolean {
		return stmt.isCompoundStatementType || stmt.children.length > 0;
	}
}

export class VerboseBlockTrimmer extends BlockTrimmer {
	private readonly offsetLimit: number | undefined;

	constructor(
		languageId: string,
		prefix: string,
		completion: string,
		private readonly lineLimit: number = 10
	) {
		super(languageId, prefix, completion);
		const completionLineEnds = [...this.completion.matchAll(/\n/g)];
		if (completionLineEnds.length >= this.lineLimit && this.lineLimit > 0) {
			this.offsetLimit = completionLineEnds[this.lineLimit - 1].index;
		} else {
			this.offsetLimit = undefined;
		}
	}

	async getCompletionTrimOffset(): Promise<number | undefined> {
		return await this.withParsedStatementTree(tree => {
			const stmt = this.getStatementAtCursor(tree);

			let offset = this.getContainingBlockOffset(stmt);

			if (!this.isWithinLimit(offset)) {
				offset = this.trimToBlankLine(offset);
			}

			if (!this.isWithinLimit(offset)) {
				offset = this.trimToStatement(stmt, offset);
			}

			return offset;
		});
	}

	private isWithinLimit(offset: number | undefined): boolean {
		return this.offsetLimit === undefined || (offset !== undefined && offset <= this.offsetLimit);
	}

	private trimToBlankLine(offset: number | undefined): number | undefined {
		const blankLines = [...this.trimmedCompletion(offset).matchAll(/\r?\n\s*\r?\n/g)].reverse();
		while (blankLines.length > 0 && !this.isWithinLimit(offset)) {
			const match = blankLines.pop()!;
			offset = match.index;
		}
		return offset;
	}

	private trimToStatement(stmt: StatementNode | undefined, offset: number | undefined): number | undefined {
		const min = this.prefix.length;
		const max = this.prefix.length + (this.offsetLimit ?? this.completion.length);
		let s = stmt;
		let next = stmt?.nextSibling;
		while (next && next.node.endIndex <= max && !this.hasNonStatementContentAfter(s)) {
			s = next;
			next = next.nextSibling;
		}
		if (s && s === stmt && s.node.endIndex <= min) {
			s = next;
		}
		if (s && s.node.endIndex > max) {
			return this.trimToStatement(s.children[0], this.asCompletionOffset(s.node.endIndex));
		}
		return this.asCompletionOffset(s?.node?.endIndex) ?? offset;
	}
}

export class TerseBlockTrimmer extends BlockTrimmer {
	private readonly limitOffset: number | undefined;
	private readonly lookAheadOffset: number | undefined;

	constructor(
		languageId: string,
		prefix: string,
		completion: string,
		private readonly lineLimit: number = 3,
		private readonly lookAhead: number = 7
	) {
		super(languageId, prefix, completion);
		const completionLineEnds = [...this.completion.matchAll(/\n/g)];
		const limitAndLookAhead = this.lineLimit + this.lookAhead;
		if (completionLineEnds.length >= this.lineLimit && this.lineLimit > 0) {
			this.limitOffset = completionLineEnds[this.lineLimit - 1].index;
		}
		if (completionLineEnds.length >= limitAndLookAhead && limitAndLookAhead > 0) {
			this.lookAheadOffset = completionLineEnds[limitAndLookAhead - 1].index;
		}
	}

	async getCompletionTrimOffset(): Promise<number | undefined> {
		return await this.withParsedStatementTree(tree => {
			const stmt = tree.statementAt(this.stmtStartPos());

			let offset = this.getContainingBlockOffset(stmt);

			offset = this.trimAtFirstBlankLine(offset);

			if (stmt) {
				offset = this.trimAtStatementChange(stmt, offset);
			}

			if (this.limitOffset && this.lookAheadOffset && (offset === undefined || offset > this.lookAheadOffset)) {
				return this.limitOffset;
			}

			return offset;
		});
	}

	private stmtStartPos(): number {
		const match = this.completion.match(/\S/);
		if (match && match.index !== undefined) {
			return this.prefix.length + match.index;
		}
		return Math.max(this.prefix.length - 1, 0);
	}

	private trimAtFirstBlankLine(offset: number | undefined): number | undefined {
		const blankLines = [...this.trimmedCompletion(offset).matchAll(/\r?\n\s*\r?\n/g)];

		while (blankLines.length > 0 && (offset === undefined || offset > blankLines[0].index)) {
			const match = blankLines.shift()!;
			if (this.completion.substring(0, match.index).trim() !== '') {
				return match.index;
			}
		}
		return offset;
	}

	private trimAtStatementChange(stmt: StatementNode, offset: number | undefined): number | undefined {
		const min = this.prefix.length;
		const max = this.prefix.length + (offset ?? this.completion.length);

		if (stmt.node.endIndex > min && this.isCompoundStatement(stmt)) {
			if (stmt.nextSibling && stmt.node.endIndex < max) {
				return this.asCompletionOffset(stmt.node.endIndex);
			}
			return offset;
		}

		let s = stmt;
		let next = stmt.nextSibling;
		while (
			next &&
			next.node.endIndex <= max &&
			!this.hasNonStatementContentAfter(s) &&
			!this.isCompoundStatement(next)
		) {
			s = next;
			next = next.nextSibling;
		}
		if (next && s.node.endIndex > min && s.node.endIndex < max) {
			return this.asCompletionOffset(s.node.endIndex);
		}
		return offset;
	}
}

export enum BlockPositionType {
	NonBlock = 'non-block',
	EmptyBlock = 'empty-block',
	BlockEnd = 'block-end',
	MidBlock = 'mid-block',
}

export async function getBlockPositionType(
	document: TextDocumentContents,
	position: IPosition
): Promise<BlockPositionType> {
	const text = document.getText();
	const offset = document.offsetAt(position);
	const tree = StatementTree.create(document.detectedLanguageId, text, 0, text.length);
	try {
		await tree.build();

		const stmt = tree.statementAt(offset);

		if (!stmt) { return BlockPositionType.NonBlock; }

		if (!stmt.isCompoundStatementType && stmt.children.length === 0) {
			if (stmt.parent && !stmt.nextSibling && stmt.node.endPosition.row <= position.line) {
				return BlockPositionType.BlockEnd;
			} else if (stmt.parent) {
				return BlockPositionType.MidBlock;
			}
			return BlockPositionType.NonBlock;
		}

		if (stmt.children.length === 0) {
			return BlockPositionType.EmptyBlock;
		}

		const lastChild = stmt.children[stmt.children.length - 1];
		if (offset < lastChild.node.startIndex) {
			return BlockPositionType.MidBlock;
		}

		return BlockPositionType.BlockEnd;
	} finally {
		tree[Symbol.dispose]();
	}
}
