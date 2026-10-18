/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ComponentStatistics, PromptMetadata } from '../../../../prompt/src/components/components';
import { getTokenizer, Tokenizer, TokenizerName } from '../../../../prompt/src/tokenization';
import { LRUCacheMap } from '../../helpers/cache';
import { setDefault } from '../../util/map';
import { CompletionsPromptOptions } from '../completionsPromptFactory/completionsPromptFactory';
import { CodeSnippetWithId, TraitWithId } from '../contextProviders/contextItemSchemas';
import {
	EMPTY_NODE,
	IVirtualNode,
	NodeId,
	rectifyWeights,
	render,
	RenderedText,
	RenderNode,
	snapshot,
} from '../render/renderNode';
import { getAvailableNodeId, NodeCostFunction } from '../render/utils';

const NUM_CACHED_LINE_COSTS = 20_000;

export type RenderedComponent = {
	root: RenderNode;
	renderedNodes: Map<NodeId, RenderNode>;
	text: string;
	cost: number;
	metadata: PromptMetadata;
};

export type ComponentSnapshot = {
	root: RenderNode;
	mask?: NodeId[];
	statistics?: Map<NodeId, ComponentStatistics>;
};

export type ValidatedContextItems = {
	traits: TraitWithId[];
	codeSnippets: CodeSnippetWithId[];
};

export interface VirtualPromptComponent {
	name: string;
	snapshot(options: CompletionsPromptOptions, context?: ValidatedContextItems): ComponentSnapshot;
	estimatedCost?(options: CompletionsPromptOptions, context?: ValidatedContextItems): number;
}

let renderId = 0;
const renderCache = new LRUCacheMap<
	NodeId,
	{ budget: number; mask: Set<NodeId>; tokenizer: TokenizerName; render: RenderedText }
>();
export function renderWithMetadata(
	component: VirtualPromptComponent,
	budget: number,
	options: CompletionsPromptOptions,
	context?: ValidatedContextItems
): RenderedComponent {
	renderId++;
	const tokenizerName = options.promptOpts?.tokenizer ?? TokenizerName.o200k;
	const start = performance.now();
	const { root, mask, statistics } = component.snapshot(options, context);
	const renderEnd = performance.now();

	const maskSet = new Set(mask);
	const cachedRender = renderCache?.get(root.id);
	let renderedText: RenderedText;
	if (
		cachedRender &&
		cachedRender.budget >= budget &&
		cachedRender.render.cost <= budget &&
		cachedRender.tokenizer === tokenizerName &&
		maskSet.size === cachedRender.mask.size &&
		[...maskSet].every(id => cachedRender.mask.has(id))
	) {
		renderedText = cachedRender.render;
	} else {
		const tokenizer = getTokenizer(tokenizerName);
		const costFunction = (text: string) => tokenizer.tokenLength(text);
		renderedText = render(root, { budget, mask, costFunction });
		renderCache.set(root.id, {
			budget,
			mask: maskSet,
			tokenizer: tokenizerName,
			render: renderedText,
		});
	}
	const { text, cost, renderedNodes } = renderedText;
	const elisionEnd = performance.now();
	for (const [id, stat] of statistics?.entries() ?? []) {
		stat.actualTokens = renderedNodes.get(id)?.cost ?? 0;
	}
	const metadata: PromptMetadata = {
		renderId: renderId,
		rendererName: 'renderNode',
		tokenizer: tokenizerName,
		elisionTimeMs: elisionEnd - renderEnd,
		renderTimeMs: renderEnd - start,
		updateDataTimeMs: 0,
		componentStatistics: [{ componentPath: component.name, actualTokens: cost }],
	};
	return { root, renderedNodes, text, cost, metadata };
}

function cachedLineCostFunction(tokenizer: Tokenizer, cache: Map<string, number>): NodeCostFunction {
	return (node: IVirtualNode) => {
		const key = node.text.join('') + '\n';
		return setDefault(cache, key, () => tokenizer.tokenLength(key) + 1);
	};
}

function getLinewiseNode(raw: string, costFunction: NodeCostFunction, reversed: boolean): RenderNode {
	const lines = raw.split('\n');
	const children = lines.map(line => ({ id: getAvailableNodeId(), text: [line], children: [], canMerge: true }));
	const seps = [''];
	if (children.length >= 1) {
		seps.push(...Array<string>(children.length - 1).fill('\n'), '');
	}
	const virtualNode = { id: getAvailableNodeId(), text: seps, children, canMerge: true };
	const nodeCostFunction = (node: IVirtualNode) => (node.id === virtualNode.id ? 0 : costFunction(node));
	const root = snapshot(virtualNode, nodeCostFunction);
	let valueTarget = reversed ? children.length : 1;
	for (const child of root.children) {
		child.weight = valueTarget * Math.max(1, child.cost);
		valueTarget += reversed ? -1 : 1;
	}
	return root;
}

export class BasicPrefixComponent implements VirtualPromptComponent {
	readonly name = 'basicPrefix';
	private costCache = new LRUCacheMap<string, number>(NUM_CACHED_LINE_COSTS);

	snapshot(options: CompletionsPromptOptions): ComponentSnapshot {
		const { completionState, promptOpts } = options;
		const rawPrefix = completionState.textDocument.getText({
			start: { line: 0, character: 0 },
			end: completionState.position,
		});
		const tokenizer = getTokenizer(promptOpts?.tokenizer);
		const costFunction = cachedLineCostFunction(tokenizer, this.costCache);
		const root = getLinewiseNode(rawPrefix, costFunction, false);
		return { root };
	}
}

export class TraitComponent implements VirtualPromptComponent {
	readonly name = 'traitProvider';

	snapshot(options: CompletionsPromptOptions, context?: ValidatedContextItems): ComponentSnapshot {
		const { promptOpts } = options;
		const tokenizer = getTokenizer(promptOpts?.tokenizer);
		if (!context || context.traits.length === 0) {
			return { root: EMPTY_NODE };
		}
		const weights: Map<number, number> = new Map();
		let totalWeight = 0;
		const children: RenderNode[] = [];
		const statistics: Map<NodeId, ComponentStatistics> = new Map();
		for (const trait of context.traits) {
			const id = getAvailableNodeId();
			const text = `${trait.name}: ${trait.value}`;
			const child: RenderNode = {
				id,
				text: [text],
				children: [],
				cost: tokenizer.tokenLength(text),
				weight: 0,
				elisionMarker: '',
				canMerge: true,
				requireRenderedChild: true,
			};
			children.push(child);
			statistics.set(id, {
				componentPath: trait.id,
				source: trait,
				expectedTokens: child.cost,
			});
			weights.set(id, trait.importance ?? 0);
			totalWeight += trait.importance ?? 0;
		}
		totalWeight = Math.max(totalWeight, 1);
		const header = `Related context:\n`;
		const text: string[] = [header, ...new Array<string>(children.length).fill('\n')];
		const root: RenderNode = {
			id: getAvailableNodeId(),
			text,
			children,
			cost: 0,
			weight: 0,
			elisionMarker: '',
			canMerge: true,
			requireRenderedChild: true,
		};
		rectifyWeights(root, node => (weights.get(node.id) ?? 0) / totalWeight);
		return { root, statistics };
	}
}

export class ConcatenatedContextComponent implements VirtualPromptComponent {
	constructor(
		readonly name: string,
		readonly components: VirtualPromptComponent[]
	) { }

	snapshot(options: CompletionsPromptOptions, context?: ValidatedContextItems): ComponentSnapshot {
		const snapshots = this.components.map(component => component.snapshot(options, context));
		const children = snapshots.map(s => s.root).filter(n => n.id !== EMPTY_NODE.id);
		if (children.length === 0) {
			return { root: EMPTY_NODE };
		}
		const text = ['', ...Array<string>(children.length - 1).fill('\n'), ''];
		const root: RenderNode = {
			id: getAvailableNodeId(),
			text,
			children,
			cost: 0,
			weight: 0,
			elisionMarker: '',
			canMerge: true,
			requireRenderedChild: false,
		};
		const mask: NodeId[] = [];
		const statistics = new Map<NodeId, ComponentStatistics>();
		for (const s of snapshots) {
			for (const [id, stat] of s.statistics?.entries() ?? []) {
				statistics.set(id, stat);
			}
			if (s.mask) {
				mask.push(...s.mask);
			}
		}
		return { root, mask, statistics };
	}
}
