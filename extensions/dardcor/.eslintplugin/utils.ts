/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TSESTree } from '@typescript-eslint/typescript-estree';
import * as eslint from 'eslint';

export function createImportRuleListener(validateImport: (node: TSESTree.Literal, value: string) => any): eslint.Rule.RuleListener {

	function _checkImport(node: TSESTree.Node | null) {
		if (node && node.type === 'Literal' && typeof node.value === 'string') {
			validateImport(node, node.value);
		}
	}

	return {
		ImportDeclaration: (node: any) => {
			_checkImport((node as TSESTree.ImportDeclaration).source);
		},
		['CallExpression[callee.type="Import"][arguments.length=1] > Literal']: (node: any) => {
			_checkImport(node);
		},
		['TSImportEqualsDeclaration > TSExternalModuleReference > Literal']: (node: any) => {
			_checkImport(node);
		},
		ExportAllDeclaration: (node: any) => {
			_checkImport((node as TSESTree.ExportAllDeclaration).source);
		},
		ExportNamedDeclaration: (node: any) => {
			_checkImport((node as TSESTree.ExportNamedDeclaration).source);
		},

	};
}
