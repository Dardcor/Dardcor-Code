/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import type * as ESTree from 'estree';

export default new class PolicyLocalizationKeyMatch implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		messages: {
			mismatch: 'Localization key "{{keyValue}}" does not match the key used in nls.localize("{{localizeKey}}", ...). They must be identical.'
		},
		docs: {
			description: 'Ensures that localization keys in policy blocks match the keys used in nls.localize() calls',
		},
		schema: false,
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {

		function checkLocalizationObject(node: ESTree.ObjectExpression) {

			let keyProperty: ESTree.Property | undefined;
			let valueProperty: ESTree.Property | undefined;

			for (const property of node.properties) {
				if (property.type !== 'Property') {
					continue;
				}

				const propertyKey = property.key;
				if (propertyKey.type === 'Identifier') {
					if (propertyKey.name === 'key') {
						keyProperty = property;
					} else if (propertyKey.name === 'value') {
						valueProperty = property;
					}
				}
			}

			if (!keyProperty || !valueProperty) {
				return;
			}

			let keyValue: string | undefined;
			if (keyProperty.value.type === 'Literal' && typeof keyProperty.value.value === 'string') {
				keyValue = keyProperty.value.value;
			}

			if (!keyValue) {
				return;
			}

			if (valueProperty.value.type === 'CallExpression') {
				const callee = valueProperty.value.callee;

				let isLocalizeCall = false;
				if (callee.type === 'MemberExpression') {
					const object = callee.object;
					const property = callee.property;
					if (object.type === 'Identifier' &&
						property.type === 'Identifier' && property.name === 'localize') {
						isLocalizeCall = true;
					}
				} else if (callee.type === 'Identifier' && callee.name === 'localize') {
					isLocalizeCall = true;
				}

				if (isLocalizeCall) {
					const args = valueProperty.value.arguments;
					if (args.length > 0) {
						const firstArg = args[0];
						if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
							const localizeKey = firstArg.value;

							if (keyValue !== localizeKey) {
								context.report({
									node: keyProperty.value,
									messageId: 'mismatch',
									data: {
										keyValue,
										localizeKey
									}
								});
							}
						}
					}
				}
			}
		}

		function isInPolicyBlock(node: ESTree.Node): boolean {
			const ancestors = context.sourceCode.getAncestors(node);

			for (const ancestor of ancestors) {
				if (ancestor.type === 'Property') {
					// eslint-disable-next-line local/code-no-any-casts
					const property = ancestor as any;
					if (property.key && property.key.type === 'Identifier' && property.key.name === 'policy') {
						return true;
					}
				}
			}

			return false;
		}

		return {
			'ObjectExpression': (node: ESTree.ObjectExpression) => {
				if (!isInPolicyBlock(node)) {
					return;
				}

				checkLocalizationObject(node);
			}
		};
	}
};
