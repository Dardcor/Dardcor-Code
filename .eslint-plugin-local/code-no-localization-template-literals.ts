/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import { TSESTree } from '@typescript-eslint/utils';

export default new class NoLocalizationTemplateLiterals implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		messages: {
			noTemplateLiteral: 'Template literals cannot be used in localization calls. Use placeholders like {0}, {1} instead.'
		},
		docs: {
			description: 'Prevents template literals in vscode.l10n.t() and nls.localize() calls',
		},
		schema: false,
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {

		function checkCallExpression(node: TSESTree.CallExpression) {
			const callee = node.callee;
			let isLocalizationCall = false;
			let isNlsLocalize = false;

			if (callee.type === 'MemberExpression') {
				const object = callee.object;
				const property = callee.property;

				if (object.type === 'MemberExpression') {
					const outerObject = object.object;
					const outerProperty = object.property;
					if (outerObject.type === 'Identifier' && outerObject.name === 'vscode' &&
						outerProperty.type === 'Identifier' && outerProperty.name === 'l10n' &&
						property.type === 'Identifier' && property.name === 't') {
						isLocalizationCall = true;
					}
				}

				if (object.type === 'Identifier' && property.type === 'Identifier') {
					if (object.name === 'l10n' && property.name === 't') {
						isLocalizationCall = true;
					} else if (property.name === 'localize') {
						isLocalizationCall = true;
						isNlsLocalize = true;
					}
				}
			}

			if (!isLocalizationCall) {
				return;
			}

			const argsToCheck = isNlsLocalize ? 2 : 1;
			for (let i = 0; i < argsToCheck && i < node.arguments.length; i++) {
				const arg = node.arguments[i];
				if (arg && arg.type === 'TemplateLiteral' && arg.expressions.length > 0) {
					context.report({
						node: arg,
						messageId: 'noTemplateLiteral'
					});
				}
			}
		}

		return {
			CallExpression: (node: any) => checkCallExpression(node as TSESTree.CallExpression)
		};
	}
};
