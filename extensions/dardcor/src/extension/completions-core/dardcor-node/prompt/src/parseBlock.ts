/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as Parser from 'web-tree-sitter';
import {
	WASMLanguage,
	isSupportedLanguageId,
	languageIdToWasmLanguage,
	parseTreeSitter,
	parseTreeSitterIncludingVersion,
	queryPythonIsDocstring,
} from './parse';

interface BlockParser {
	isEmptyBlockStart: (text: string, offset: number) => Promise<boolean>;

	isBlockBodyFinished: (prefix: string, completion: string, offset: number) => Promise<number | undefined>;

	getNodeStart: (text: string, offset: number) => Promise<number | undefined>;
}

abstract class BaseBlockParser implements BlockParser {
	abstract isEmptyBlockStart(text: string, offset: number): Promise<boolean>;

	constructor(
		protected readonly languageId: string,
		protected readonly nodeMatch: { [parent: string]: string },
		protected readonly nodeTypesWithBlockOrStmtChild: Map<string, string>
	) { }

	protected async getNodeMatchAtPosition<T>(
		text: string,
		offset: number,
		cb: (nd: Parser.SyntaxNode) => T
	): Promise<T | undefined> {
		const tree = await parseTreeSitter(this.languageId, text);
		try {
			const nodeAtPos = tree.rootNode.descendantForIndex(offset);

			let nodeToComplete: Parser.SyntaxNode | null = nodeAtPos;

			while (nodeToComplete) {
				const blockNodeType = this.nodeMatch[nodeToComplete.type];
				if (blockNodeType) {
					if (!this.nodeTypesWithBlockOrStmtChild.has(nodeToComplete.type)) {
						break;
					}

					const fieldLabel = this.nodeTypesWithBlockOrStmtChild.get(nodeToComplete.type)!;
					const childToCheck =
						fieldLabel === ''
							? nodeToComplete.namedChildren[0]
							: nodeToComplete.childForFieldName(fieldLabel);
					if (childToCheck?.type === blockNodeType) {
						break;
					}
				}

				nodeToComplete = nodeToComplete.parent;
			}
			if (!nodeToComplete) {
				return;
			}
			return cb(nodeToComplete);
		} finally {
			tree.delete();
		}
	}

	protected getNextBlockAtPosition<T>(
		text: string,
		offset: number,
		cb: (nd: Parser.SyntaxNode) => T
	): Promise<T | undefined> {
		return this.getNodeMatchAtPosition(text, offset, nodeToComplete => {
			let block = nodeToComplete.children.reverse().find(x => x.type === this.nodeMatch[nodeToComplete.type]);
			if (!block) {
				return;
			}

			if (this.languageId === 'python' && block.parent) {
				const parent = block.parent.type === ':' ? block.parent.parent : block.parent;

				let nextComment = parent?.nextSibling;

				while (nextComment && nextComment.type === 'comment') {
					const commentInline =
						nextComment.startPosition.row === block.endPosition.row &&
						nextComment.startPosition.column >= block.endPosition.column;

					const commentAtEnd =
						nextComment.startPosition.row > parent!.endPosition.row &&
						nextComment.startPosition.column > parent!.startPosition.column;

					if (commentInline || commentAtEnd) {
						block = nextComment;
						nextComment = nextComment.nextSibling;
					} else {
						break;
					}
				}
			}

			if (block.endIndex >= block.tree.rootNode.endIndex - 1 && (block.hasError || block.parent!.hasError)) {
				return;
			}

			return cb(block);
		});
	}

	async isBlockBodyFinished(prefix: string, completion: string, offset: number): Promise<number | undefined> {
		const solution = (prefix + completion).trimEnd();
		const endIndex = await this.getNextBlockAtPosition(solution, offset, block => block.endIndex);
		if (endIndex === undefined) {
			return;
		}
		if (endIndex < solution.length) {
			const lengthOfBlock = endIndex - prefix.length;
			return lengthOfBlock > 0 ? lengthOfBlock : undefined;
		}
	}

	getNodeStart(text: string, offset: number): Promise<number | undefined> {
		const solution = text.trimEnd();
		return this.getNodeMatchAtPosition(solution, offset, block => block.startIndex);
	}
}

class RegexBasedBlockParser extends BaseBlockParser {
	constructor(
		languageId: string,
		protected readonly blockEmptyMatch: string,
		private readonly lineMatch: RegExp,
		nodeMatch: { [parent: string]: string },
		nodeTypesWithBlockOrStmtChild: Map<string, string>
	) {
		super(languageId, nodeMatch, nodeTypesWithBlockOrStmtChild);
	}

	private isBlockStart(line: string): boolean {
		return this.lineMatch.test(line.trimStart());
	}

	private async isBlockBodyEmpty(text: string, offset: number): Promise<boolean> {
		const res = await this.getNextBlockAtPosition(text, offset, block => {
			if (block.startIndex < offset) { offset = block.startIndex; }
			const blockText = text.substring(offset, block.endIndex).trim();
			if (blockText === '' || blockText.replace(/\s/g, '') === this.blockEmptyMatch) {
				return true;
			}
			return false;
		});
		return res === undefined || res;
	}

	async isEmptyBlockStart(text: string, offset: number): Promise<boolean> {
		offset = rewindToNearestNonWs(text, offset);
		return this.isBlockStart(getLineAtOffset(text, offset)) && this.isBlockBodyEmpty(text, offset);
	}
}

function getLineAtOffset(text: string, offset: number): string {
	const prevNewline = text.lastIndexOf('\n', offset - 1);
	let nextNewline = text.indexOf('\n', offset);
	if (nextNewline < 0) {
		nextNewline = text.length;
	}
	return text.slice(prevNewline + 1, nextNewline);
}

function rewindToNearestNonWs(text: string, offset: number): number {
	let result = offset;
	while (result > 0 && /\s/.test(text.charAt(result - 1))) {
		result--;
	}
	return result;
}

function indent(nd: Parser.SyntaxNode, source: string): string | undefined {
	const startIndex = nd.startIndex;
	const lineStart = nd.startIndex - nd.startPosition.column;
	const prefix = source.substring(lineStart, startIndex);
	if (/^\s*$/.test(prefix)) {
		return prefix;
	}
	return undefined;
}

function outdented(fst: Parser.SyntaxNode, snd: Parser.SyntaxNode, source: string): boolean {
	if (snd.startPosition.row <= fst.startPosition.row) {
		return false;
	}
	const fstIndent = indent(fst, source);
	const sndIndent = indent(snd, source);
	return fstIndent !== undefined && sndIndent !== undefined && fstIndent.startsWith(sndIndent);
}

class TreeSitterBasedBlockParser extends BaseBlockParser {
	constructor(
		languageId: string,
		nodeMatch: { [parent: string]: string },
		nodeTypesWithBlockOrStmtChild: Map<string, string>,
		private readonly startKeywords: string[],
		private readonly blockNodeType: string,
		private readonly emptyStatementType: string | null,
		private readonly curlyBraceLanguage: boolean
	) {
		super(languageId, nodeMatch, nodeTypesWithBlockOrStmtChild);
	}

	private isBlockEmpty(block: Parser.SyntaxNode, offset: number): boolean {
		let trimmed = block.text.trim();

		if (this.curlyBraceLanguage) {
			if (trimmed.startsWith('{')) {
				trimmed = trimmed.slice(1);
			}
			if (trimmed.endsWith('}')) {
				trimmed = trimmed.slice(0, -1);
			}
			trimmed = trimmed.trim();
		}

		if (trimmed.length === 0) {
			return true;
		}

		if (
			this.languageId === 'python' &&
			(block.parent?.type === 'class_definition' || block.parent?.type === 'function_definition') &&
			block.children.length === 1 &&
			queryPythonIsDocstring(block.parent)
		) {
			return true;
		}

		return false;
	}

	async isEmptyBlockStart(text: string, offset: number): Promise<boolean> {
		if (offset > text.length) {
			throw new RangeError('Invalid offset');
		}

		for (let i = offset; i < text.length; i++) {
			if (text.charAt(i) === '\n') {
				break;
			} else if (/\S/.test(text.charAt(i))) {
				return false;
			}
		}

		offset = rewindToNearestNonWs(text, offset);

		const [tree, version] = await parseTreeSitterIncludingVersion(this.languageId, text);
		try {
			const nodeAtPos = tree.rootNode.descendantForIndex(offset - 1);
			if (nodeAtPos === null) {
				return false;
			}

			if (this.curlyBraceLanguage && nodeAtPos.type === '}') {
				return false;
			}

			if (
				(this.languageId === 'javascript' || this.languageId === 'typescript') &&
				nodeAtPos.parent &&
				nodeAtPos.parent.type === 'object' &&
				nodeAtPos.parent.text.trim() === '{'
			) {
				return true;
			}

			if (this.languageId === 'typescript') {
				let currNode = nodeAtPos;
				while (currNode.parent) {
					if (currNode.type === 'function_signature' || currNode.type === 'method_signature') {
						const next = nodeAtPos.nextSibling;
						if (next && currNode.hasError && outdented(currNode, next, text)) {
							return true;
						}

						const semicolon = currNode.children.find(c => c.type === ';');
						return !semicolon && currNode.endIndex <= offset;
					}
					currNode = currNode.parent;
				}
			}


			let errorNode = null;
			let blockNode = null;
			let blockParentNode = null;
			let currNode: Parser.SyntaxNode | null = nodeAtPos;
			while (currNode !== null) {
				if (currNode.type === this.blockNodeType) {
					blockNode = currNode;
					break;
				}
				if (this.nodeMatch[currNode.type]) {
					blockParentNode = currNode;
					break;
				}
				if (currNode.type === 'ERROR') {
					errorNode = currNode;
					break;
				}
				currNode = currNode.parent;
			}
			if (blockNode !== null) {
				if (!blockNode.parent || !this.nodeMatch[blockNode.parent.type]) {
					return false;
				}

				if (this.languageId === 'python') {
					const prevSibling = blockNode.previousSibling;
					if (
						prevSibling !== null &&
						prevSibling.hasError &&
						(prevSibling.text.startsWith('"""') || prevSibling.text.startsWith(`'''`))
					) {
						return true;
					}
				}

				return this.isBlockEmpty(blockNode, offset);
			}
			if (errorNode !== null) {
				if (
					errorNode.previousSibling?.type === 'module' ||
					errorNode.previousSibling?.type === 'internal_module' ||
					errorNode.previousSibling?.type === 'def'
				) {
					return true;
				}

				if (this.languageId === 'python' && version >= 14) {
					if (errorNode.hasError && (errorNode.text.startsWith('"') || errorNode.text.startsWith(`'`))) {
						const parentType = errorNode.parent?.type;
						if (
							parentType === 'function_definition' ||
							parentType === 'class_definition' ||
							parentType === 'module'
						) {
							return true;
						}
					}
				}

				const children = [...errorNode.children].reverse();
				const keyword = children.find(child => this.startKeywords.includes(child.type));
				let block = children.find(child => child.type === this.blockNodeType);

				if (keyword) {
					switch (this.languageId) {
						case 'python': {
							if (keyword.type === 'try' && nodeAtPos.type === 'identifier' && nodeAtPos.text.length > 4) {
								block = children
									.find(child => child.hasError)
									?.children.find(child => child.type === 'block');
							}

							let colonNode;
							let parenCount = 0;
							for (const child of errorNode.children) {
								if (child.type === ':' && parenCount === 0) {
									colonNode = child;
									break;
								}
								if (child.type === '(') {
									parenCount += 1;
								}
								if (child.type === ')') {
									parenCount -= 1;
								}
							}
							if (colonNode && keyword.endIndex <= colonNode.startIndex && colonNode.nextSibling) {
								if (keyword.type === 'def') {
									const sibling = colonNode.nextSibling;
									if (sibling.type === '"' || sibling.type === `'`) {
										return true;
									}
									if (sibling.type === 'ERROR' && (sibling.text === '"""' || sibling.text === `'''`)) {
										return true;
									}
								}
								return false;
							}

							break;
						}
						case 'javascript': {
							if (keyword.type === 'class') {
								if (version <= 13) {
									const formalParameters = children.find(child => child.type === 'formal_parameters');
									if (formalParameters) {
										return true;
									}
								} else {
									const children = errorNode.children;
									for (let i = 0; i < children.length; i++) {
										const child = children[i];
										if (child.type === 'formal_parameters') {
											return (
												i + 1 === children.length ||
												(children[i + 1]?.type === '{' && i + 2 === children.length)
											);
										}
									}
								}
							}

							const leftCurlyBrace = children.find(child => child.type === '{');
							if (
								leftCurlyBrace &&
								leftCurlyBrace.startIndex > keyword.endIndex &&
								leftCurlyBrace.nextSibling !== null
							) {
								return false;
							}

							const doNode = children.find(child => child.type === 'do');
							if (doNode && keyword.type === 'while') {
								return false;
							}

							if (keyword.type === '=>' && keyword.nextSibling && keyword.nextSibling.type !== '{') {
								return false;
							}

							break;
						}
						case 'typescript': {
							const leftCurlyBrace = children.find(child => child.type === '{');
							if (
								leftCurlyBrace &&
								leftCurlyBrace.startIndex > keyword.endIndex &&
								leftCurlyBrace.nextSibling !== null
							) {
								return false;
							}

							const doNode = children.find(child => child.type === 'do');
							if (doNode && keyword.type === 'while') {
								return false;
							}

							if (keyword.type === '=>' && keyword.nextSibling && keyword.nextSibling.type !== '{') {
								return false;
							}

							break;
						}
					}

					if (block && block.startIndex > keyword.endIndex) {
						return this.isBlockEmpty(block, offset);
					}
					return true;
				}
			}
			if (blockParentNode !== null) {
				const expectedType = this.nodeMatch[blockParentNode.type];
				const block = blockParentNode.children
					.slice()
					.reverse()
					.find(x => x.type === expectedType);
				if (!block) {
					if (this.nodeTypesWithBlockOrStmtChild.has(blockParentNode.type)) {
						const fieldLabel = this.nodeTypesWithBlockOrStmtChild.get(blockParentNode.type)!;
						const child =
							fieldLabel === ''
								? blockParentNode.children[0]
								: blockParentNode.childForFieldName(fieldLabel);
						if (child && child.type !== this.blockNodeType && child.type !== this.emptyStatementType) {
							return false;
						}
					}

					return true;
				} else {
					return this.isBlockEmpty(block, offset);
				}
			}

			return false;
		} finally {
			tree.delete();
		}
	}
}

const wasmLanguageToBlockParser: { [languageId in WASMLanguage]: BlockParser } = {
	python: new TreeSitterBasedBlockParser(
		'python',
		{
			class_definition: 'block',
			elif_clause: 'block',
			else_clause: 'block',
			except_clause: 'block',
			finally_clause: 'block',
			for_statement: 'block',
			function_definition: 'block',
			if_statement: 'block',
			try_statement: 'block',
			while_statement: 'block',
			with_statement: 'block',
		},
		new Map(),
		['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with'],
		'block',
		null,
		false
	),
	javascript: new TreeSitterBasedBlockParser(
		'javascript',
		{
			arrow_function: 'statement_block',
			catch_clause: 'statement_block',
			do_statement: 'statement_block',
			else_clause: 'statement_block',
			finally_clause: 'statement_block',
			for_in_statement: 'statement_block',
			for_statement: 'statement_block',
			function: 'statement_block',
			function_expression: 'statement_block',
			function_declaration: 'statement_block',
			generator_function: 'statement_block',
			generator_function_declaration: 'statement_block',
			if_statement: 'statement_block',
			method_definition: 'statement_block',
			try_statement: 'statement_block',
			while_statement: 'statement_block',
			with_statement: 'statement_block',
			class: 'class_body',
			class_declaration: 'class_body',
		},
		new Map([
			['arrow_function', 'body'],
			['do_statement', 'body'],
			['else_clause', ''],
			['for_in_statement', 'body'],
			['for_statement', 'body'],
			['if_statement', 'consequence'],
			['while_statement', 'body'],
			['with_statement', 'body'],
		]),
		[
			'=>',
			'try',
			'catch',
			'finally',
			'do',
			'for',
			'if',
			'else',
			'while',
			'with',
			'function',
			'function*',
			'class',
		],
		'statement_block',
		'empty_statement',
		true
	),
	typescript: new TreeSitterBasedBlockParser(
		'typescript',
		{
			ambient_declaration: 'statement_block',
			arrow_function: 'statement_block',
			catch_clause: 'statement_block',
			do_statement: 'statement_block',
			else_clause: 'statement_block',
			finally_clause: 'statement_block',
			for_in_statement: 'statement_block',
			for_statement: 'statement_block',
			function: 'statement_block',
			function_expression: 'statement_block',
			function_declaration: 'statement_block',
			generator_function: 'statement_block',
			generator_function_declaration: 'statement_block',
			if_statement: 'statement_block',
			internal_module: 'statement_block',
			method_definition: 'statement_block',
			module: 'statement_block',
			try_statement: 'statement_block',
			while_statement: 'statement_block',
			abstract_class_declaration: 'class_body',
			class: 'class_body',
			class_declaration: 'class_body',
		},
		new Map([
			['arrow_function', 'body'],
			['do_statement', 'body'],
			['else_clause', ''],
			['for_in_statement', 'body'],
			['for_statement', 'body'],
			['if_statement', 'consequence'],
			['while_statement', 'body'],
			['with_statement', 'body'],
		]),
		[
			'declare',
			'=>',
			'try',
			'catch',
			'finally',
			'do',
			'for',
			'if',
			'else',
			'while',
			'with',
			'function',
			'function*',
			'class',
		],
		'statement_block',
		'empty_statement',
		true
	),
	tsx: new TreeSitterBasedBlockParser(
		'typescriptreact',
		{
			ambient_declaration: 'statement_block',
			arrow_function: 'statement_block',
			catch_clause: 'statement_block',
			do_statement: 'statement_block',
			else_clause: 'statement_block',
			finally_clause: 'statement_block',
			for_in_statement: 'statement_block',
			for_statement: 'statement_block',
			function: 'statement_block',
			function_expression: 'statement_block',
			function_declaration: 'statement_block',
			generator_function: 'statement_block',
			generator_function_declaration: 'statement_block',
			if_statement: 'statement_block',
			internal_module: 'statement_block',
			method_definition: 'statement_block',
			module: 'statement_block',
			try_statement: 'statement_block',
			while_statement: 'statement_block',
			abstract_class_declaration: 'class_body',
			class: 'class_body',
			class_declaration: 'class_body',
		},
		new Map([
			['arrow_function', 'body'],
			['do_statement', 'body'],
			['else_clause', ''],
			['for_in_statement', 'body'],
			['for_statement', 'body'],
			['if_statement', 'consequence'],
			['while_statement', 'body'],
			['with_statement', 'body'],
		]),
		[
			'declare',
			'=>',
			'try',
			'catch',
			'finally',
			'do',
			'for',
			'if',
			'else',
			'while',
			'with',
			'function',
			'function*',
			'class',
		],
		'statement_block',
		'empty_statement',
		true
	),
	go: new RegexBasedBlockParser(
		'go',
		'{}',
		/\b(func|if|else|for)\b/,
		{
			communication_case: 'block',
			default_case: 'block',
			expression_case: 'block',
			for_statement: 'block',
			func_literal: 'block',
			function_declaration: 'block',
			if_statement: 'block',
			labeled_statement: 'block',
			method_declaration: 'block',
			type_case: 'block',
		},
		new Map()
	),
	ruby: new RegexBasedBlockParser(
		'ruby',
		'end',
		/\b(BEGIN|END|case|class|def|do|else|elsif|for|if|module|unless|until|while)\b|->/,
		{
			begin_block: '}',
			block: '}',
			end_block: '}',
			lambda: 'block',
			for: 'do',
			until: 'do',
			while: 'do',
			case: 'end',
			do: 'end',
			if: 'end',
			method: 'end',
			module: 'end',
			unless: 'end',
			do_block: 'end',
		},
		new Map()
	),
	'c-sharp': new TreeSitterBasedBlockParser(
		'csharp',
		{
		},
		new Map([
		]),
		[
		],
		'block',
		null,
		true
	),
	java: new TreeSitterBasedBlockParser(
		'java',
		{
		},
		new Map([
		]),
		[
		],
		'block',
		null,
		true
	),
	php: new TreeSitterBasedBlockParser(
		'php',
		{
		},
		new Map([
		]),
		[
		],
		'block',
		null,
		true
	),
	cpp: new TreeSitterBasedBlockParser(
		'cpp',
		{
		},
		new Map([
		]),
		[
		],
		'block',
		null,
		true
	),
};

export function getBlockParser(languageId: string): BlockParser {
	if (!isSupportedLanguageId(languageId)) {
		throw new Error(`Language ${languageId} is not supported`);
	}
	return wasmLanguageToBlockParser[languageIdToWasmLanguage(languageId)];
}

export async function isEmptyBlockStart(languageId: string, text: string, offset: number) {
	if (!isSupportedLanguageId(languageId)) {
		return false;
	}
	return getBlockParser(languageId).isEmptyBlockStart(text, offset);
}

export async function isBlockBodyFinished(languageId: string, prefix: string, completion: string, offset: number) {
	if (!isSupportedLanguageId(languageId)) {
		return undefined;
	}
	return getBlockParser(languageId).isBlockBodyFinished(prefix, completion, offset);
}

export async function getNodeStart(languageId: string, text: string, offset: number) {
	if (!isSupportedLanguageId(languageId)) {
		return;
	}
	return getBlockParser(languageId).getNodeStart(text, offset);
}
