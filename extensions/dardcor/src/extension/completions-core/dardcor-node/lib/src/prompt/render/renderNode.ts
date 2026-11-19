/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PriorityQueue } from '../../util/priorityQueue';
import { DEFAULT_ELISION_MARKER, getAvailableNodeId, NodeCostFunction } from './utils';

export type NodeId = number;

export interface IVirtualNode {
	id: NodeId;
	text: readonly string[];
	children: readonly IVirtualNode[];
	canMerge?: boolean;
	elisionMarker?: string;
}

export interface RenderNode extends IVirtualNode {
	readonly id: NodeId;
	readonly text: readonly string[];
	readonly children: readonly RenderNode[];
	readonly cost: number;
	weight: number;
	rectifiedWeight?: number;
	canMerge: boolean;
	elisionMarker: string;
	requireRenderedChild: boolean;
}

export function createRenderNode(partial: Partial<RenderNode>): RenderNode {
	const node: RenderNode = {
		id: partial.id ?? getAvailableNodeId(),
		text: partial.text ?? new Array((partial.children?.length ?? 0) + 1).fill(''),
		children: partial.children ?? [],
		cost: partial.cost ?? 1,
		weight: partial.weight ?? 0,
		rectifiedWeight: partial.rectifiedWeight,
		canMerge: partial.canMerge ?? false,
		elisionMarker: partial.elisionMarker ?? DEFAULT_ELISION_MARKER,
		requireRenderedChild: partial.requireRenderedChild ?? false,
	};
	if (node.text.length !== node.children.length + 1) {
		throw new Error(
			`RenderNode text length (${node.text.length}) must be children length + 1 (${node.children.length + 1})`
		);
	}
	return node;
}

function isRenderedChildRequired(node: RenderNode): boolean {
	return node.requireRenderedChild || (node.rectifiedWeight ?? node.weight) > node.weight;
}

export function rectifiedValue(node: RenderNode): number {
	return (node.rectifiedWeight ?? node.weight) / Math.max(node.cost, 1);
}

export function rectifyWeights(node: RenderNode, weighter?: (node: RenderNode) => number) {
	const rectificationQueue = recursivelyRectifyWeights(node, weighter);
	for (const { item, priority } of rectificationQueue.clear()) {
		for (const node of item.nodes) {
			node.rectifiedWeight = priority * Math.max(node.cost, 1);
		}
	}
}

type NodeGroup = {
	nodes: RenderNode[];
	totalCost: number;
	totalWeight: number;
};
function recursivelyRectifyWeights(
	node: RenderNode,
	weighter?: (node: RenderNode) => number
): PriorityQueue<NodeGroup> {
	const childQueues = node.children.map(child => recursivelyRectifyWeights(child, weighter));
	node.weight = Math.max(0, weighter ? weighter(node) : node.weight);
	if (node.weight === 0 && childQueues.reduce((sum, q) => sum + q.size, 0) === 0) {
		return new PriorityQueue<NodeGroup>([]);
	}

	const merged: PriorityQueue<NodeGroup> = new PriorityQueue(childQueues.flatMap(queue => queue.clear()));
	const group: NodeGroup = {
		nodes: [node],
		totalCost: node.cost,
		totalWeight: node.weight,
	};

	while ((merged.peek()?.priority ?? 0) > group.totalWeight / Math.max(group.totalCost, 1)) {
		const { item } = merged.pop()!;
		group.nodes.push(...item.nodes);
		group.totalCost += item.totalCost;
		group.totalWeight += item.totalWeight;
	}
	merged.insert(group, group.totalWeight / Math.max(group.totalCost, 1));
	return merged;
}

export type RenderedText = {
	text: string;
	cost: number;
	renderedNodes: Map<NodeId, RenderNode>;
};
type RenderOptions = Partial<{
	budget: number;
	mask: NodeId | NodeId[];
	costFunction: (text: string) => number;
}>;

export function render(node: RenderNode, options: RenderOptions = {}): RenderedText {
	const { budget, mask, costFunction } = options;
	const exclude = mask ?? [];
	const exclusionSet = new Set(Array.isArray(exclude) ? exclude : [exclude]);

	if ((budget ?? node.cost) < node.cost || exclusionSet.has(node.id)) {
		return {
			text: node.elisionMarker,
			cost: costFunction ? costFunction(node.elisionMarker) : node.elisionMarker.length,
			renderedNodes: new Map(),
		};
	}

	if (budget === undefined) {
		const elider = (node: RenderNode) => exclusionSet.has(node.id);
		const renderParts: string[] = [];
		const renderedNodes: Map<NodeId, RenderNode> = new Map();
		recursivelyRender(node, renderParts, elider, renderedNodes);
		if (renderParts.length === 0) {
			return renderEmpty(node, costFunction);
		}
		const text = renderParts.join('');
		const cost = costFunction
			? costFunction(text)
			: [...renderedNodes.values()].reduce((sum, n) => sum + n.cost, 0);
		return { text, cost, renderedNodes };
	}

	let targetNodes = new Map<NodeId, RenderNode>();
	const marginalNodes: RenderNode[] = [];
	const explorationQueue = new PriorityQueue<RenderNode>([{ item: node, priority: rectifiedValue(node) }]);
	let remainingBudget = budget;
	while (remainingBudget > 0 && explorationQueue.size > 0) {
		const { item } = explorationQueue.pop()!;
		if (exclusionSet.has(item.id)) {
			continue;
		}
		if (item.cost <= remainingBudget) {
			remainingBudget -= item.cost;
			targetNodes.set(item.id, item);
			marginalNodes.push(item);
			for (const child of item.children) {
				explorationQueue.insert(child, rectifiedValue(child));
			}
		}
	}

	while (targetNodes.size > 0) {
		const renderParts: string[] = [];
		const elider = (node: RenderNode) => !targetNodes.has(node.id);
		const renderedNodes = new Map<NodeId, RenderNode>();
		recursivelyRender(node, renderParts, elider, renderedNodes);
		if (renderParts.length === 0) {
			return renderEmpty(node, costFunction);
		}
		const text = renderParts.join('');
		if (costFunction === undefined) {
			const cost = [...renderedNodes.values()].reduce((sum, n) => sum + n.cost, 0);
			return { text, cost, renderedNodes };
		}

		let cost = costFunction(text);
		if (cost <= budget) {
			return { text, cost, renderedNodes };
		}

		targetNodes = renderedNodes;
		while (marginalNodes.length > 0 && cost > budget) {
			const node = marginalNodes.pop()!;
			if (targetNodes.has(node.id)) {
				cost -= node.cost;
				targetNodes.delete(node.id);
			}
		}

		if (marginalNodes.length === 0) {
			break;
		}
	}
	return renderEmpty(node, costFunction);
}

function renderEmpty(node: RenderNode, costFunction?: (text: string) => number): RenderedText {
	return {
		text: node.elisionMarker,
		cost: costFunction ? costFunction(node.elisionMarker) : node.elisionMarker.length,
		renderedNodes: new Map(),
	};
}

function recursivelyRender(
	node: RenderNode,
	parts: string[],
	elider: (node: RenderNode) => boolean,
	renderedNodes: Map<NodeId, RenderNode>,
	mergeElision: boolean = false
): boolean {
	const numParts = parts.length;
	if (elider(node)) {
		if (numParts >= 2) {
			if (
				mergeElision ||
				(parts[numParts - 2] === node.elisionMarker && parts[numParts - 1].trim().length === 0)
			) {
				parts.pop();
				return false;
			}
		}
		parts.push(node.elisionMarker);
		return false;
	}

	let requiresChild = isRenderedChildRequired(node);
	let didRender = true;
	for (const [i, child] of node.children.entries()) {
		parts.push(node.text[i] ?? '');
		didRender = recursivelyRender(child, parts, elider, renderedNodes, child.canMerge && !didRender);
		requiresChild &&= !didRender;
	}
	if (requiresChild) {
		while (parts.length > numParts) {
			parts.pop();
		}
		return false;
	}
	parts.push(node.text[node.text.length - 1] ?? '');
	renderedNodes.set(node.id, node);
	return true;
}

export function snapshot(
	node: IVirtualNode,
	costFunction: NodeCostFunction,
	elisionMarker: string = DEFAULT_ELISION_MARKER
): RenderNode {
	const children = node.children.map(child => snapshot(child, costFunction, elisionMarker));
	elisionMarker = node.elisionMarker ?? elisionMarker;
	const cost = costFunction(node);
	const renderNode: RenderNode = createRenderNode({
		...node,
		children,
		cost,
		weight: 0,
		elisionMarker: node.elisionMarker ?? elisionMarker,
	});
	return renderNode;
}

export const EMPTY_NODE: RenderNode = {
	id: getAvailableNodeId(),
	text: [''],
	children: [],
	cost: 0,
	weight: 0,
	elisionMarker: '',
	canMerge: true,
	requireRenderedChild: false,
};
