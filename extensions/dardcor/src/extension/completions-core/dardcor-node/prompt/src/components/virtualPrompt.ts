/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PromptElement, PromptSnapshotNode, Status } from './components';
import { VirtualPromptNode, VirtualPromptReconciler } from './reconciler';
import { CancellationToken } from 'vscode-languageserver-protocol';

type PromptSnapshot = Status & { snapshot: PromptSnapshotNode | undefined };

export class VirtualPrompt {
	private reconciler: VirtualPromptReconciler;

	constructor(prompt: PromptElement) {
		this.reconciler = new VirtualPromptReconciler(prompt);
	}

	private snapshotNode(
		node: VirtualPromptNode,
		cancellationToken?: CancellationToken
	): PromptSnapshotNode | 'cancelled' | undefined {
		if (!node) {
			return;
		}

		if (cancellationToken?.isCancellationRequested) {
			return 'cancelled';
		}

		const children = [];
		for (const child of node.children ?? []) {
			const result = this.snapshotNode(child, cancellationToken);
			if (result === 'cancelled') {
				return 'cancelled';
			}
			if (result !== undefined) {
				children.push(result);
			}
		}

		return {
			value: node.props?.value?.toString(),
			name: node.name,
			path: node.path,
			props: node.props,
			children,
			statistics: {
				updateDataTimeMs: node.lifecycle?.lifecycleData.getUpdateTimeMsAndReset(),
			},
		};
	}

	snapshot(cancellationToken?: CancellationToken): PromptSnapshot {
		try {
			const vTree = this.reconciler.reconcile(cancellationToken);

			if (cancellationToken?.isCancellationRequested) {
				return { snapshot: undefined, status: 'cancelled' };
			}

			if (!vTree) {
				throw new Error('Invalid virtual prompt tree');
			}

			const snapshotNode = this.snapshotNode(vTree, cancellationToken);

			if (snapshotNode === 'cancelled' || cancellationToken?.isCancellationRequested) {
				return { snapshot: undefined, status: 'cancelled' };
			}

			return { snapshot: snapshotNode, status: 'ok' };
		} catch (e) {
			return { snapshot: undefined, status: 'error', error: e as Error };
		}
	}

	createPipe(): DataPipe {
		return this.reconciler.createPipe();
	}
}
export interface DataPipe {
	pump(data: unknown): Promise<void>;
}
