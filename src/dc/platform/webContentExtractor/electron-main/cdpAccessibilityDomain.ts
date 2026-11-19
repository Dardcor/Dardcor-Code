/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { URI } from '../../../base/common/uri.js';

export interface AXValue {
	type: AXValueType;
	value?: unknown;
	relatedNodes?: AXNode[];
	sources?: AXValueSource[];
}

export interface AXValueSource {
	type: AXValueSourceType;
	value?: AXValue;
	attribute?: string;
	attributeValue?: string;
	superseded?: boolean;
	nativeSource?: AXValueNativeSourceType;
	nativeSourceValue?: string;
	invalid?: boolean;
	invalidReason?: string;
}

export interface AXNode {
	nodeId: string;
	ignored: boolean;
	ignoredReasons?: AXProperty[];
	role?: AXValue;
	chromeRole?: AXValue;
	name?: AXValue;
	description?: AXValue;
	value?: AXValue;
	properties?: AXProperty[];
	childIds?: string[];
	backendDOMNodeId?: number;
}

export interface AXProperty {
	name: AXPropertyName;
	value: AXValue;
}

export type AXValueType = 'boolean' | 'tristate' | 'booleanOrUndefined' | 'idref' | 'idrefList' | 'integer' | 'node' | 'nodeList' | 'number' | 'string' | 'computedString' | 'token' | 'tokenList' | 'domRelation' | 'role' | 'internalRole' | 'valueUndefined';

export type AXValueSourceType = 'attribute' | 'implicit' | 'style' | 'contents' | 'placeholder' | 'relatedElement';

export type AXValueNativeSourceType = 'description' | 'figcaption' | 'label' | 'labelfor' | 'labelwrapped' | 'legend' | 'rubyannotation' | 'tablecaption' | 'title' | 'other';

export type AXPropertyName = 'url' | 'busy' | 'disabled' | 'editable' | 'focusable' | 'focused' | 'hidden' | 'hiddenRoot' | 'invalid' | 'keyshortcuts' | 'settable' | 'roledescription' | 'live' | 'atomic' | 'relevant' | 'root' | 'autocomplete' | 'hasPopup' | 'level' | 'multiselectable' | 'orientation' | 'multiline' | 'readonly' | 'required' | 'valuemin' | 'valuemax' | 'valuetext' | 'checked' | 'expanded' | 'pressed' | 'selected' | 'activedescendant' | 'controls' | 'describedby' | 'details' | 'errormessage' | 'flowto' | 'labelledby' | 'owns';


interface AXNodeTree {
	readonly node: AXNode;
	readonly children: AXNodeTree[];
	parent: AXNodeTree | null;
}

function createNodeTrees(nodes: AXNode[]): AXNodeTree[] {
	if (nodes.length === 0) {
		return [];
	}

	const nodeLookup = new Map<string, AXNode>();
	for (const node of nodes) {
		nodeLookup.set(node.nodeId, node);
	}

	function getNonIgnoredDescendants(nodeId: string): string[] {
		const node = nodeLookup.get(nodeId);
		if (!node || !node.childIds) {
			return [];
		}

		const result: string[] = [];
		for (const childId of node.childIds) {
			const childNode = nodeLookup.get(childId);
			if (!childNode) {
				continue;
			}

			if (childNode.ignored) {
				result.push(...getNonIgnoredDescendants(childId));
			} else {
				result.push(childId);
			}
		}
		return result;
	}

	const nodeMap = new Map<string, AXNodeTree>();
	for (const node of nodes) {
		if (!node.ignored) {
			nodeMap.set(node.nodeId, { node, children: [], parent: null });
		}
	}

	for (const node of nodes) {
		if (node.ignored) {
			continue;
		}

		const treeNode = nodeMap.get(node.nodeId)!;
		if (node.childIds) {
			for (const childId of node.childIds) {
				const childNode = nodeLookup.get(childId);
				if (!childNode) {
					continue;
				}

				if (childNode.ignored) {
					const nonIgnoredDescendants = getNonIgnoredDescendants(childId);
					for (const descendantId of nonIgnoredDescendants) {
						const descendantTreeNode = nodeMap.get(descendantId);
						if (descendantTreeNode) {
							descendantTreeNode.parent = treeNode;
							treeNode.children.push(descendantTreeNode);
						}
					}
				} else {
					const childTreeNode = nodeMap.get(childId);
					if (childTreeNode) {
						childTreeNode.parent = treeNode;
						treeNode.children.push(childTreeNode);
					}
				}
			}
		}
	}

	const roots: AXNodeTree[] = [];
	for (const node of nodeMap.values()) {
		if (!node.parent) {
			roots.push(node);
		}
	}

	return roots;
}

const LINE_MAX_LENGTH = 80;

export function convertAXTreeToMarkdown(uri: URI, axNodes: AXNode[]): string {
	const trees = createNodeTrees(axNodes);
	if (trees.length === 0) {
		return '';
	}

	const allMainContent: string[] = [];
	const allNavLinks: string[] = [];

	for (const tree of trees) {
		const mainContent = extractMainContent(uri, tree);
		const navLinks = collectNavigationLinks(tree);

		if (mainContent.trim().length > 0) {
			allMainContent.push(mainContent);
		}
		allNavLinks.push(...navLinks);
	}

	const combinedMainContent = allMainContent.join('\n\n');

	return combinedMainContent + (allNavLinks.length > 0 ? '\n\n## Additional Links\n' + allNavLinks.join('\n') : '');
}

function extractMainContent(uri: URI, tree: AXNodeTree): string {
	const contentBuffer: string[] = [];
	processNode(uri, tree, contentBuffer, 0, true);
	return contentBuffer.join('');
}

function processNode(uri: URI, node: AXNodeTree, buffer: string[], depth: number, allowWrap: boolean): void {
	const role = getNodeRole(node.node);

	switch (role) {
		case 'navigation':
			return;

		case 'heading':
			processHeadingNode(uri, node, buffer, depth);
			return;

		case 'paragraph':
			processParagraphNode(uri, node, buffer, depth, allowWrap);
			return;

		case 'list':
			buffer.push('\n');
			for (const descChild of node.children) {
				processNode(uri, descChild, buffer, depth + 1, true);
			}
			buffer.push('\n');
			return;

		case 'ListMarker':
			buffer.push(getNodeText(node.node, allowWrap));
			return;

		case 'listitem': {
			const tempBuffer: string[] = [];
			for (const descChild of node.children) {
				processNode(uri, descChild, tempBuffer, depth + 1, true);
			}
			const indent = getLevel(node.node) > 1 ? ' '.repeat(getLevel(node.node)) : '';
			buffer.push(`${indent}${tempBuffer.join('').trim()}\n`);
			return;
		}

		case 'link':
			if (!isNavigationLink(node)) {
				const linkText = getNodeText(node.node, allowWrap);
				const url = getLinkUrl(node.node);
				if (!isSameUriIgnoringQueryAndFragment(uri, node.node)) {
					buffer.push(`[${linkText}](${url})`);
				} else {
					buffer.push(linkText);
				}
			}
			return;
		case 'StaticText': {
			const staticText = getNodeText(node.node, allowWrap);
			if (staticText) {
				buffer.push(staticText);
			}
			break;
		}
		case 'image': {
			const altText = getNodeText(node.node, allowWrap) || 'Image';
			const imageUrl = getImageUrl(node.node);
			if (imageUrl) {
				buffer.push(`![${altText}](${imageUrl})\n\n`);
			} else {
				buffer.push(`[Image: ${altText}]\n\n`);
			}
			break;
		}

		case 'DescriptionList':
			processDescriptionListNode(uri, node, buffer, depth);
			return;

		case 'blockquote':
			buffer.push('> ' + getNodeText(node.node, allowWrap).replace(/\n/g, '\n> ') + '\n\n');
			break;

		case 'generic':
			buffer.push(' ');
			break;

		case 'code': {
			processCodeNode(uri, node, buffer, depth);
			return;
		}

		case 'pre':
			buffer.push('```\n' + getNodeText(node.node, false) + '\n```\n\n');
			break;

		case 'table':
			processTableNode(node, buffer);
			return;
	}

	for (const child of node.children) {
		processNode(uri, child, buffer, depth + 1, allowWrap);
	}
}

function getNodeRole(node: AXNode): string {
	return node.role?.value as string || '';
}

function getNodeText(node: AXNode, allowWrap: boolean): string {
	const text = node.name?.value as string || node.value?.value as string || '';
	if (!allowWrap) {
		return text;
	}

	if (text.length <= LINE_MAX_LENGTH) {
		return text;
	}

	const chars = text.split('');
	let lastSpaceIndex = -1;
	for (let i = 1; i < chars.length; i++) {
		if (chars[i] === ' ') {
			lastSpaceIndex = i;
		}
		if (i % LINE_MAX_LENGTH === 0 && lastSpaceIndex !== -1) {
			chars[lastSpaceIndex] = '\n';
			lastSpaceIndex = i;
		}
	}
	return chars.join('');
}

function getLevel(node: AXNode): number {
	const levelProp = node.properties?.find(p => p.name === 'level');
	return levelProp ? Math.min(Number(levelProp.value.value) || 1, 6) : 1;
}

function getLinkUrl(node: AXNode): string {
	const urlProp = node.properties?.find(p => p.name === 'url');
	return urlProp?.value.value as string || '#';
}

function getImageUrl(node: AXNode): string | null {
	const urlProp = node.properties?.find(p => p.name === 'url');
	return urlProp?.value.value as string || null;
}

function isNavigationLink(node: AXNodeTree): boolean {
	let current: AXNodeTree | null = node;
	while (current) {
		const role = getNodeRole(current.node);
		if (['navigation', 'menu', 'menubar'].includes(role)) {
			return true;
		}
		current = current.parent;
	}
	return false;
}

function isSameUriIgnoringQueryAndFragment(uri: URI, node: AXNode): boolean {
	const link = getLinkUrl(node);
	try {
		const parsed = URI.parse(link);
		return parsed.scheme === uri.scheme && parsed.authority === uri.authority && parsed.path === uri.path;
	} catch (e) {
		return false;
	}
}

function processParagraphNode(uri: URI, node: AXNodeTree, buffer: string[], depth: number, allowWrap: boolean): void {
	buffer.push('\n');
	for (const child of node.children) {
		processNode(uri, child, buffer, depth + 1, allowWrap);
	}
	buffer.push('\n\n');
}

function processHeadingNode(uri: URI, node: AXNodeTree, buffer: string[], depth: number): void {
	buffer.push('\n');
	const level = getLevel(node.node);
	buffer.push(`${'#'.repeat(level)} `);
	for (const child of node.children) {
		if (getNodeRole(child.node) === 'StaticText') {
			buffer.push(getNodeText(child.node, false));
		} else {
			processNode(uri, child, buffer, depth + 1, false);
		}
	}
	buffer.push('\n\n');
}

function processDescriptionListNode(uri: URI, node: AXNodeTree, buffer: string[], depth: number): void {
	buffer.push('\n');

	for (const child of node.children) {
		if (getNodeRole(child.node) === 'term') {
			buffer.push('- **');
			for (const termChild of child.children) {
				processNode(uri, termChild, buffer, depth + 1, true);
			}
			buffer.push('** ');
		} else if (getNodeRole(child.node) === 'definition') {
			for (const descChild of child.children) {
				processNode(uri, descChild, buffer, depth + 1, true);
			}
			buffer.push('\n');
		}
	}

	buffer.push('\n');
}

function isTableCell(role: string): boolean {
	return role === 'cell' || role === 'gridcell' || role === 'columnheader' || role === 'rowheader';
}

function processTableNode(node: AXNodeTree, buffer: string[]): void {
	buffer.push('\n');

	const rows = node.children.filter(child => getNodeRole(child.node).includes('row'));

	if (rows.length > 0) {
		const headerCells = rows[0].children.filter(cell => isTableCell(getNodeRole(cell.node)));

		const headerContent = headerCells.map(cell => getNodeText(cell.node, false) || ' ');
		buffer.push('| ' + headerContent.join(' | ') + ' |\n');

		buffer.push('| ' + headerCells.map(() => '---').join(' | ') + ' |\n');

		for (let i = 1; i < rows.length; i++) {
			const dataCells = rows[i].children.filter(cell => isTableCell(getNodeRole(cell.node)));
			const rowContent = dataCells.map(cell => getNodeText(cell.node, false) || ' ');
			buffer.push('| ' + rowContent.join(' | ') + ' |\n');
		}
	}

	buffer.push('\n');
}

function processCodeNode(uri: URI, node: AXNodeTree, buffer: string[], depth: number): void {
	const tempBuffer: string[] = [];
	for (const child of node.children) {
		processNode(uri, child, tempBuffer, depth + 1, false);
	}
	const isCodeblock = tempBuffer.some(text => text.includes('\n'));
	if (isCodeblock) {
		buffer.push('\n```\n');
		buffer.push(tempBuffer.join(''));
		buffer.push('\n```\n');
	} else {
		buffer.push('`');
		let characterCount = 0;
		for (const tempItem of tempBuffer) {
			characterCount += tempItem.length;
			if (characterCount > LINE_MAX_LENGTH) {
				buffer.push('\n');
				characterCount = 0;
			}
			buffer.push(tempItem);
			buffer.push('`');
		}
	}
}

function collectNavigationLinks(tree: AXNodeTree): string[] {
	const links: string[] = [];
	collectLinks(tree, links);
	return links;
}

function collectLinks(node: AXNodeTree, links: string[]): void {
	const role = getNodeRole(node.node);

	if (role === 'link' && isNavigationLink(node)) {
		const linkText = getNodeText(node.node, true);
		const url = getLinkUrl(node.node);
		const description = node.node.description?.value as string || '';

		links.push(`- [${linkText}](${url})${description ? ' - ' + description : ''}`);
	}

	for (const child of node.children) {
		collectLinks(child, links);
	}
}
