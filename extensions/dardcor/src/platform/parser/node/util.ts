/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode } from 'web-tree-sitter';
import { WASMLanguage } from './treeSitterLanguages';

export function extractIdentifier(node: SyntaxNode, languageId: string): string | undefined {
	switch (languageId) {
		case 'python':
		case 'csharp':
			return node.children.find(c => c.type.match(/identifier/))?.text;
		case 'go': {
			const identifierChild = node.children.find(c => c.type.match(/identifier/));
			if (identifierChild) { return identifierChild.text; }
			const specChild = node.children.find(c => c.type.match(/spec/));
			return specChild?.children.find(c => c.type.match(/identifier/))?.text;
		}
		case 'javascript':
		case 'javascriptreact':
		case 'typescript':
		case 'typescriptreact':
		case 'cpp': {
			const declarator = node.children.find(c => c.type.match(/declarator/));
			if (declarator) { return declarator.children.find(c => c.type.match(/identifier/))?.text; }
			const identifierChild = node.children.find(c => c.type.match(/identifier/));
			return identifierChild?.text;
		}
		case 'java': {
			const identifierChild = node.children.find(c => c.type === 'identifier');
			return identifierChild?.text;
		}
		case 'ruby':
			return node.children.find(c => c.type.match(/constant|identifier/))?.text;
		default:
			return node.children.find(c => c.type.match(/identifier/))?.text;
	}
}


export function isDocumentableNode(node: SyntaxNode, language: WASMLanguage) {
	switch (language) {
		case WASMLanguage.TypeScript:
		case WASMLanguage.TypeScriptTsx:
		case WASMLanguage.JavaScript:
			return node.type.match(/definition|declaration|declarator|export_statement/);
		case WASMLanguage.Go:
			return node.type.match(/definition|declaration|declarator|var_spec/);
		case WASMLanguage.Cpp:
			return node.type.match(/definition|declaration|class_specifier/);
		case WASMLanguage.Ruby:
			return node.type.match(/module|class|method|assignment/);
		case WASMLanguage.Python:
			return node.type.match(/^(function_definition|class_definition|decorated_definition)$/);
		default:
			return node.type.match(/definition|declaration|declarator/);
	}
}

export function unwrapPythonDecoratedDefinition(node: SyntaxNode, language: WASMLanguage): SyntaxNode {
	if (language !== WASMLanguage.Python || node.type !== 'decorated_definition') {
		return node;
	}
	return node.children.find(c => c.type === 'function_definition' || c.type === 'class_definition') ?? node;
}
