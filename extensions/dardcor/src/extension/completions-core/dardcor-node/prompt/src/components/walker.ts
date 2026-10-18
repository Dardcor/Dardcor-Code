/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Chunk, PromptSnapshotNode } from './components';

interface WalkContext {
	[key: string]: unknown;
}

export type WalkContextTransformer = (
	node: PromptSnapshotNode,
	parent: PromptSnapshotNode | undefined,
	context: WalkContext
) => WalkContext;

export class SnapshotWalker {
	constructor(
		private readonly snapshot: PromptSnapshotNode,
		private readonly transformers: WalkContextTransformer[] = defaultTransformers()
	) { }

	walkSnapshot(
		visitor: (n: PromptSnapshotNode, parent: PromptSnapshotNode | undefined, context: WalkContext) => boolean
	) {
		this.walkSnapshotNode(this.snapshot, undefined, visitor, {});
	}

	private walkSnapshotNode(
		node: PromptSnapshotNode,
		parent: PromptSnapshotNode | undefined,
		visitor: (n: PromptSnapshotNode, parent: PromptSnapshotNode | undefined, context: WalkContext) => boolean,
		context: WalkContext
	) {
		const newContext = this.transformers.reduce((ctx, transformer) => transformer(node, parent, ctx), { ...context });

		const accept = visitor(node, parent, newContext);
		if (!accept) {
			return;
		}

		for (const child of node.children ?? []) {
			this.walkSnapshotNode(child, node, visitor, newContext);
		}
	}
}

export function defaultTransformers(): WalkContextTransformer[] {
	return [
		(node, _, context) => {
			if (context.weight === undefined) {
				context.weight = 1;
			}
			const weight = node.props?.weight ?? 1;
			const clampedWeight = typeof weight === 'number' ? Math.max(0, Math.min(1, weight)) : 1;
			return { ...context, weight: clampedWeight * (context.weight as number) };
		},
		(node, _, context) => {
			if (node.name === Chunk.name) {
				const chunks = context.chunks ? new Set<string>(context.chunks as Set<string>) : new Set<string>();
				chunks.add(node.path);
				return { ...context, chunks };
			}
			return context;
		},
		(node, _, context) => {
			if (node.props?.source !== undefined) {
				return { ...context, source: node.props.source };
			}
			return context;
		},
	];
}
