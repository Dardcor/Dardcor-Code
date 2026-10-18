/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/



import { TSESTree } from '@typescript-eslint/utils';
import * as eslint from 'eslint';
import type * as ESTree from 'estree';


export default {
	meta: {
		type: 'suggestion',

		docs: {
			description: 'disallow unused expressions',
			category: 'Best Practices',
			recommended: false,
			url: 'https://eslint.org/docs/rules/no-unused-expressions'
		},

		schema: [
			{
				type: 'object',
				properties: {
					allowShortCircuit: {
						type: 'boolean',
						default: false
					},
					allowTernary: {
						type: 'boolean',
						default: false
					},
					allowTaggedTemplates: {
						type: 'boolean',
						default: false
					}
				},
				additionalProperties: false
			}
		]
	},

	create(context: eslint.Rule.RuleContext) {
		const config = context.options[0] || {},
			allowShortCircuit = config.allowShortCircuit || false,
			allowTernary = config.allowTernary || false,
			allowTaggedTemplates = config.allowTaggedTemplates || false;


		function looksLikeDirective(node: TSESTree.Node): boolean {
			return node.type === 'ExpressionStatement' &&
				node.expression.type === 'Literal' && typeof node.expression.value === 'string';
		}


		function takeWhile<T>(predicate: (item: T) => boolean, list: T[]): T[] {
			for (let i = 0; i < list.length; ++i) {
				if (!predicate(list[i])) {
					return list.slice(0, i);
				}
			}
			return list.slice();
		}


		function directives(node: TSESTree.Program | TSESTree.BlockStatement): TSESTree.Node[] {
			return takeWhile(looksLikeDirective, node.body);
		}


		function isDirective(node: TSESTree.Node, ancestors: TSESTree.Node[]): boolean {
			const parent = ancestors[ancestors.length - 1],
				grandparent = ancestors[ancestors.length - 2];

			return (parent.type === 'Program' || parent.type === 'BlockStatement' &&
				(/Function/u.test(grandparent.type))) &&
				directives(parent).indexOf(node) >= 0;
		}

		function isValidExpression(node: TSESTree.Node): boolean {
			if (allowTernary) {

				if (node.type === 'ConditionalExpression') {
					return isValidExpression(node.consequent) && isValidExpression(node.alternate);
				}
			}

			if (allowShortCircuit) {
				if (node.type === 'LogicalExpression') {
					return isValidExpression(node.right);
				}
			}

			if (allowTaggedTemplates && node.type === 'TaggedTemplateExpression') {
				return true;
			}

			if (node.type === 'ExpressionStatement') {
				return isValidExpression(node.expression);
			}

			return /^(?:Assignment|OptionalCall|Call|New|Update|Yield|Await|Chain)Expression$/u.test(node.type) ||
				(node.type === 'UnaryExpression' && ['delete', 'void'].indexOf(node.operator) >= 0);
		}

		return {
			ExpressionStatement(node: TSESTree.ExpressionStatement) {
				if (!isValidExpression(node.expression) && !isDirective(node, context.sourceCode.getAncestors(node as ESTree.Node) as TSESTree.Node[])) {
					context.report({ node: node as ESTree.Node, message: `Expected an assignment or function call and instead saw an expression. ${node.expression}` });
				}
			}
		};

	}
};
