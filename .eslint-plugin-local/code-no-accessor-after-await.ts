/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TSESTree } from '@typescript-eslint/utils';
import * as eslint from 'eslint';

export default new class NoAccessorAfterAwait implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		messages: {
			accessorAfterAwait: 'ServicesAccessor \'{{name}}\' must not be used after \'await\'. The accessor is only valid synchronously. Extract needed services before any async operation.',
		},
		schema: false,
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {
		return {
			'CallExpression': (node: eslint.Rule.Node) => {
				const callExpression = node as unknown as TSESTree.CallExpression;

				if (!isInvokeFunctionCall(callExpression.callee)) {
					return;
				}

				const functionArg = callExpression.arguments.find(arg =>
					arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression'
				) as TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | undefined;

				if (!functionArg || functionArg.params.length === 0) {
					return;
				}

				const accessorName = getParamName(functionArg.params[0]);
				if (!accessorName) {
					return;
				}

				checkForAccessorAfterAwait(functionArg, accessorName, context);
			},

			'FunctionDeclaration': (node: eslint.Rule.Node) => {
				checkFunctionWithAccessorParam(node as unknown as TSESTree.FunctionDeclaration, context);
			},
			'FunctionExpression': (node: eslint.Rule.Node) => {
				checkFunctionWithAccessorParam(node as unknown as TSESTree.FunctionExpression, context);
			},
			'ArrowFunctionExpression': (node: eslint.Rule.Node) => {
				checkFunctionWithAccessorParam(node as unknown as TSESTree.ArrowFunctionExpression, context);
			},
		};
	}
};

function checkFunctionWithAccessorParam(
	fn: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression,
	context: eslint.Rule.RuleContext
) {
	for (const param of fn.params) {
		if (param.type === 'Identifier' && hasServicesAccessorAnnotation(param)) {
			if (isDirectInvokeFunctionCallback(fn)) {
				return;
			}
			checkForAccessorAfterAwait(fn, param.name, context);
			return;
		}
	}
}

function isDirectInvokeFunctionCallback(
	fn: TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression
): boolean {
	const parent = fn.parent;
	if (parent?.type === 'CallExpression' && isInvokeFunctionCall(parent.callee)) {
		return parent.arguments.some(arg => arg === fn);
	}
	return false;
}

function hasServicesAccessorAnnotation(param: TSESTree.Identifier): boolean {
	const annotation = param.typeAnnotation;
	if (!annotation || annotation.type !== 'TSTypeAnnotation') {
		return false;
	}
	const typeNode = annotation.typeAnnotation;
	if (typeNode.type === 'TSTypeReference' && typeNode.typeName.type === 'Identifier') {
		return typeNode.typeName.name === 'ServicesAccessor';
	}
	return false;
}

function checkForAccessorAfterAwait(
	fn: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | TSESTree.FunctionDeclaration,
	accessorName: string,
	context: eslint.Rule.RuleContext
) {
	let sawAwait = false;
	const visited = new Set<TSESTree.Node>();

	function walk(node: TSESTree.Node) {
		if (visited.has(node)) {
			return;
		}
		visited.add(node);

		if (node !== fn &&
			(node.type === 'ArrowFunctionExpression' ||
				node.type === 'FunctionExpression' ||
				node.type === 'FunctionDeclaration')) {
			return;
		}

		if (node.type === 'AwaitExpression') {
			if (node.argument) {
				walk(node.argument);
			}
			sawAwait = true;
			return;
		}

		if (isAccessorUsage(node, accessorName) && sawAwait) {
			context.report({
				node: node as unknown as eslint.Rule.Node,
				messageId: 'accessorAfterAwait',
				data: { name: accessorName },
			});
			return;
		}

		if (node.type === 'IfStatement') {
			walk(node.test);
			const beforeBranches = sawAwait;

			walk(node.consequent);
			const awaitAfterConsequent = sawAwait;
			const consequentExits = blockAlwaysExits(node.consequent);

			sawAwait = beforeBranches;
			if (node.alternate) {
				walk(node.alternate);
			}
			const awaitAfterAlternate = sawAwait;
			const alternateExits = node.alternate ? blockAlwaysExits(node.alternate) : false;

			if (consequentExits && alternateExits) {
				sawAwait = awaitAfterConsequent || awaitAfterAlternate;
			} else if (consequentExits) {
				sawAwait = awaitAfterAlternate;
			} else if (alternateExits) {
				sawAwait = awaitAfterConsequent;
			} else {
				sawAwait = awaitAfterConsequent || awaitAfterAlternate;
			}
			return;
		}

		if (node.type === 'ConditionalExpression') {
			walk(node.test);
			const beforeBranches = sawAwait;
			walk(node.consequent);
			const awaitAfterConsequent = sawAwait;
			sawAwait = beforeBranches;
			walk(node.alternate);
			sawAwait = sawAwait || awaitAfterConsequent;
			return;
		}

		if (node.type === 'SwitchStatement') {
			walk(node.discriminant);
			const beforeCases = sawAwait;
			let anyCaseHadAwait = false;
			for (const c of node.cases) {
				sawAwait = beforeCases;
				if (c.test) { walk(c.test); }
				c.consequent.forEach(walk);
				anyCaseHadAwait = anyCaseHadAwait || sawAwait;
			}
			sawAwait = anyCaseHadAwait;
			return;
		}

		if (node.type === 'TryStatement') {
			const beforeTry = sawAwait;
			walk(node.block);
			const awaitAfterTry = sawAwait;
			sawAwait = beforeTry;
			if (node.handler) { walk(node.handler.body); }
			const awaitAfterCatch = sawAwait;
			sawAwait = awaitAfterTry || awaitAfterCatch;
			if (node.finalizer) { walk(node.finalizer); }
			return;
		}

		if (node.type === 'ForOfStatement' && node.await) {
			walkChildren(node, (child) => {
				if (child === node.right) {
					walk(child);
					sawAwait = true;
				} else {
					walk(child);
				}
			});
			return;
		}

		walkChildren(node, walk);
	}

	if (fn.body) {
		walk(fn.body);
	}
}

function blockAlwaysExits(node: TSESTree.Node): boolean {
	if (node.type === 'ReturnStatement' || node.type === 'ThrowStatement') {
		return true;
	}
	if (node.type === 'BlockStatement' && node.body.length > 0) {
		return blockAlwaysExits(node.body[node.body.length - 1]);
	}
	if (node.type === 'IfStatement') {
		return blockAlwaysExits(node.consequent) &&
			!!node.alternate && blockAlwaysExits(node.alternate);
	}
	return false;
}

function isAccessorUsage(node: TSESTree.Node, accessorName: string): boolean {
	if (node.type === 'CallExpression' &&
		node.callee.type === 'MemberExpression' &&
		node.callee.object.type === 'Identifier' &&
		node.callee.object.name === accessorName) {
		return true;
	}
	if (node.type === 'Identifier' && node.name === accessorName) {
		const parent = node.parent;
		if (parent?.type === 'CallExpression' && parent.arguments.includes(node)) {
			return true;
		}
	}
	return false;
}

function walkChildren(node: TSESTree.Node, visit: (child: TSESTree.Node) => void) {
	switch (node.type) {
		case 'BlockStatement':
			node.body.forEach(visit);
			break;
		case 'ExpressionStatement':
			visit(node.expression);
			break;
		case 'VariableDeclaration':
			node.declarations.forEach(decl => {
				if (decl.init) { visit(decl.init); }
			});
			break;
		case 'CallExpression':
			visit(node.callee);
			node.arguments.forEach(visit);
			break;
		case 'MemberExpression':
			visit(node.object);
			if (node.computed) { visit(node.property); }
			break;

		case 'ReturnStatement':
			if (node.argument) { visit(node.argument); }
			break;
		case 'BinaryExpression':
		case 'LogicalExpression':
			visit(node.left);
			visit(node.right);
			break;
		case 'AssignmentExpression':
			visit(node.left);
			visit(node.right);
			break;
		case 'TemplateLiteral':
			node.expressions.forEach(visit);
			break;
		case 'TaggedTemplateExpression':
			visit(node.tag);
			visit(node.quasi);
			break;
		case 'ArrayExpression':
			node.elements.forEach(e => { if (e) { visit(e); } });
			break;
		case 'ObjectExpression':
			node.properties.forEach(p => {
				if (p.type === 'Property') {
					visit(p.value);
				} else {
					visit(p);
				}
			});
			break;
		case 'SpreadElement':
			visit(node.argument);
			break;
		case 'UnaryExpression':
		case 'UpdateExpression':
			visit(node.argument);
			break;

		case 'ForStatement':
			if (node.init) { visit(node.init); }
			if (node.test) { visit(node.test); }
			if (node.update) { visit(node.update); }
			visit(node.body);
			break;
		case 'ForInStatement':
			visit(node.left);
			visit(node.right);
			visit(node.body);
			break;
		case 'ForOfStatement':
			visit(node.left);
			visit(node.right);
			visit(node.body);
			break;
		case 'WhileStatement':
		case 'DoWhileStatement':
			visit(node.test);
			visit(node.body);
			break;
		case 'ThrowStatement':
			if (node.argument) { visit(node.argument); }
			break;
		case 'NewExpression':
			visit(node.callee);
			node.arguments.forEach(visit);
			break;
		case 'SequenceExpression':
			node.expressions.forEach(visit);
			break;
		case 'TSAsExpression':
		case 'TSNonNullExpression':
			visit(node.expression);
			break;
		default:
			break;
	}
}

function getParamName(param: TSESTree.Parameter): string | null {
	if (param.type === 'Identifier') {
		return param.name;
	}
	return null;
}

const invokeFunctionNames = new Set(['invokeFunction', 'invokeWithinContext']);

function isInvokeFunctionCall(callee: TSESTree.Expression): boolean {
	if (callee.type === 'MemberExpression' &&
		callee.property.type === 'Identifier' &&
		invokeFunctionNames.has(callee.property.name)) {
		return true;
	}
	if (callee.type === 'Identifier' && invokeFunctionNames.has(callee.name)) {
		return true;
	}
	return false;
}
