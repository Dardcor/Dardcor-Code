/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import type * as ESTree from 'estree';
import { TSESTree } from '@typescript-eslint/utils';

export default new class NoInOperator implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		messages: {
			noInOperator: 'The "in" operator should not be used. Use type discriminator properties and classes instead or the `hasKey`-utility.',
		},
		schema: false,
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {

		function checkInOperator(inNode: ESTree.BinaryExpression) {
			const node = inNode as TSESTree.BinaryExpression;
			const ancestors = context.sourceCode.getAncestors(node as ESTree.Node);

			for (const ancestor of ancestors) {
				if (ancestor.type === 'FunctionDeclaration' ||
					ancestor.type === 'FunctionExpression' ||
					ancestor.type === 'ArrowFunctionExpression') {

					if ((ancestor as { returnType?: any }).returnType?.typeAnnotation?.type === 'TSTypePredicate') {
						return;
					}
				}
			}

			context.report({
				node,
				messageId: 'noInOperator'
			});
		}

		return {
			['BinaryExpression[operator="in"]']: checkInOperator,
		};
	}
};
