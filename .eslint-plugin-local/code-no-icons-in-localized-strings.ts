/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import { TSESTree } from '@typescript-eslint/utils';

export default new class NoIconsInLocalizedStrings implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		messages: {
			noIconInLocalizedString: 'Theme icon syntax $(…) should not appear inside localized strings. Move it outside the localize call or pass it as a placeholder argument.'
		},
		docs: {
			description: 'Prevents $(icon) theme icon syntax inside localize() string arguments',
		},
		type: 'problem',
		schema: false,
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {

		const iconPattern = /(?<!\\)\$\([a-zA-Z][\w~-]*\)/;

		function isLocalizeCall(callee: TSESTree.CallExpression['callee']): { isLocalize: boolean; messageArgIndex: number } {
			if (callee.type === 'Identifier' && (callee.name === 'localize' || callee.name === 'localize2')) {
				return { isLocalize: true, messageArgIndex: 1 };
			}

			if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier' && callee.property.name === 'localize') {
				return { isLocalize: true, messageArgIndex: 1 };
			}

			return { isLocalize: false, messageArgIndex: -1 };
		}

		function getStringValue(node: TSESTree.Node): string | undefined {
			if (node.type === 'Literal' && typeof node.value === 'string') {
				return node.value;
			}
			if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
				return node.quasis[0].value.cooked ?? undefined;
			}
			return undefined;
		}

		function checkCallExpression(node: TSESTree.CallExpression) {
			const { isLocalize, messageArgIndex } = isLocalizeCall(node.callee);
			if (!isLocalize) {
				return;
			}

			let actualMessageArgIndex = messageArgIndex;
			const firstArg = node.arguments[0];
			if (firstArg && firstArg.type === 'ObjectExpression') {
				actualMessageArgIndex = 1;
			}

			const messageArg = node.arguments[actualMessageArgIndex];
			if (!messageArg) {
				return;
			}

			const messageValue = getStringValue(messageArg);
			if (messageValue !== undefined && iconPattern.test(messageValue)) {
				context.report({
					node: messageArg,
					messageId: 'noIconInLocalizedString'
				});
			}
		}

		return {
			CallExpression: (node: any) => checkCallExpression(node as TSESTree.CallExpression)
		};
	}
};
