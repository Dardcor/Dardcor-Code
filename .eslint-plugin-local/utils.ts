/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import type * as ESTree from 'estree';
import { TSESTree } from '@typescript-eslint/utils';

export function createImportRuleListener(validateImport: (node: TSESTree.Literal, value: string) => any): eslint.Rule.RuleListener {

	function _checkImport(node: TSESTree.Node | null) {
		if (node && node.type === 'Literal' && typeof node.value === 'string') {
			validateImport(node, node.value);
		}
	}

	return {
		ImportDeclaration: (node: ESTree.ImportDeclaration) => {
			_checkImport((node as TSESTree.ImportDeclaration).source);
		},
		['CallExpression[callee.type="Import"][arguments.length=1] > Literal']: (node: TSESTree.Literal) => {
			_checkImport(node);
		},
		['TSImportEqualsDeclaration > TSExternalModuleReference > Literal']: (node: TSESTree.Literal) => {
			_checkImport(node);
		},
		ExportAllDeclaration: (node: ESTree.ExportAllDeclaration) => {
			_checkImport((node as TSESTree.ExportAllDeclaration).source);
		},
		ExportNamedDeclaration: (node: ESTree.ExportNamedDeclaration) => {
			_checkImport((node as TSESTree.ExportNamedDeclaration).source);
		},

	};
}
