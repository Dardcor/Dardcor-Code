/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/** @jsxRuntime automatic */
/** @jsxImportSource ../../../../prompt/jsx-runtime */

import { CancellationToken } from 'vscode-languageserver-protocol';
import {
	ComponentStatistics,
	PromptOk,
	PromptRenderer,
	PromptRenderOptions,
	PromptSnapshotNode,
	StatusNotOk,
} from '../../../../prompt/src/components/components';
import { defaultTransformers, SnapshotWalker, WalkContextTransformer } from '../../../../prompt/src/components/walker';
import { commentBlockAsSingles, isShebangLine } from '../../../../prompt/src/languageMarker';
import { getTokenizer, TokenizerName } from '../../../../prompt/src/tokenization';
import { isContextNode } from './completionsContext';
import { AfterCursor, BeforeCursor, CurrentFile } from './currentFile';
import { ElidedBlock, makePrompt, WeightedBlock, WishlistElision } from './elision';

const TOKENS_RESERVED_FOR_SUFFIX_ENCODING = 5;

export type CompletionsPromptOk = PromptOk & {
	prefix: string;
	prefixTokens: number;
	suffix: string;
	suffixTokens: number;
	context: string[] | undefined;
};
type CompletionsPrompt = CompletionsPromptOk | StatusNotOk;

export interface CompletionsPromptRenderOptions extends PromptRenderOptions {
	promptTokenLimit: number;
	suffixPercent: number;
	languageId: string;
	delimiter?: string;
}

export class CompletionsPromptRenderer implements PromptRenderer<CompletionsPrompt, CompletionsPromptRenderOptions> {
	private renderId = 0;

	protected formatPrefix: (elidedBlocks: ElidedBlock[]) => string = makePrompt;

	protected formatContext: undefined | ((elidedBlocks: ElidedBlock[]) => string[]);

	render(
		snapshot: PromptSnapshotNode,
		options: CompletionsPromptRenderOptions,
		cancellationToken?: CancellationToken
	): CompletionsPrompt {
		const id = this.renderId++;
		const renderStart = performance.now();
		try {
			if (cancellationToken?.isCancellationRequested) {
				return { status: 'cancelled' };
			}
			const delimiter = options.delimiter ?? '';
			const tokenizer = options.tokenizer ?? TokenizerName.o200k;
			const { prefixBlocks, suffixBlock, componentStatistics } = this.processSnapshot(
				snapshot,
				delimiter,
				options.languageId
			);

			const { prefixTokenLimit, suffixTokenLimit } = this.getPromptLimits(suffixBlock, options);
			const elisionStart = performance.now();
			const elisionStrategy = new WishlistElision();
			const {
				blocks: [elidedSuffix, ...elidedPrefix],
			} = elisionStrategy.elide(
				prefixBlocks,
				prefixTokenLimit,
				suffixBlock,
				suffixTokenLimit,
				getTokenizer(tokenizer)
			);
			const elisionEnd = performance.now();

			const prefix = this.formatPrefix(elidedPrefix);
			const context = this.formatContext ? this.formatContext(elidedPrefix) : undefined;
			const suffix = elidedSuffix.elidedValue;
			const prefixTokens = elidedPrefix.reduce((acc, block) => acc + block.elidedTokens, 0);

			componentStatistics.push(...computeComponentStatistics([...elidedPrefix, elidedSuffix]));
			return {
				prefix,
				prefixTokens,
				suffix,
				suffixTokens: elidedSuffix.elidedTokens,
				context,
				status: 'ok',
				metadata: {
					renderId: id,
					rendererName: 'c',
					tokenizer: tokenizer,
					elisionTimeMs: elisionEnd - elisionStart,
					renderTimeMs: performance.now() - renderStart,
					componentStatistics,
					updateDataTimeMs: componentStatistics.reduce(
						(acc, component) => acc + (component.updateDataTimeMs ?? 0),
						0
					),
				},
			};
		} catch (e) {
			return { status: 'error', error: e as Error };
		}
	}

	private getPromptLimits(suffixBlock: WeightedBlock | undefined, options: CompletionsPromptRenderOptions) {
		const suffix = suffixBlock?.value ?? '';

		let availableTokens = options.promptTokenLimit;
		const suffixPercent = options.suffixPercent;

		if (suffix.length === 0 || suffixPercent === 0) {
			return { prefixTokenLimit: availableTokens, suffixTokenLimit: 0 };
		}

		availableTokens = suffix.length > 0 ? availableTokens - TOKENS_RESERVED_FOR_SUFFIX_ENCODING : availableTokens;

		const suffixTokenLimit = Math.ceil(availableTokens * (suffixPercent / 100));
		const prefixTokenLimit = availableTokens - suffixTokenLimit;

		return {
			prefixTokenLimit,
			suffixTokenLimit,
		};
	}

	protected processSnapshot(
		snapshot: PromptSnapshotNode,
		delimiter: string,
		languageId: string
	): {
		prefixBlocks: WeightedBlock[];
		suffixBlock: WeightedBlock;
		componentStatistics: ComponentStatistics[];
	} {
		const prefixBlocks: WeightedBlock[] = [];
		const suffixBlocks: WeightedBlock[] = [];
		const componentStatistics: ComponentStatistics[] = [];
		let foundDocument = false;

		const walker = new SnapshotWalker(snapshot, transformers);
		walker.walkSnapshot((node, _parent, context) => {
			if (node === snapshot) {
				return true;
			}

			if (node.name === CurrentFile.name) {
				foundDocument = true;
			}

			if (node.statistics.updateDataTimeMs && node.statistics.updateDataTimeMs > 0) {
				componentStatistics.push({
					componentPath: node.path,
					updateDataTimeMs: node.statistics.updateDataTimeMs,
				});
			}

			if (node.value === undefined || node.value === '') {
				return true;
			}

			const chunks = context.chunks as Set<string> | undefined;
			if (context.type === 'suffix') {
				suffixBlocks.push({
					value: normalizeLineEndings(node.value),
					type: 'suffix',
					weight: context.weight as number,
					componentPath: node.path,
					nodeStatistics: node.statistics,
					chunks,
					source: context.source,
				});
			} else {
				const nodeValueWithDelimiter = node.value.endsWith(delimiter) ? node.value : node.value + delimiter;
				let value = nodeValueWithDelimiter;
				if (context.type === 'prefix') {
					value = node.value;
				} else if (isShebangLine(node.value)) {
					value = nodeValueWithDelimiter;
				} else {
					value = commentBlockAsSingles(nodeValueWithDelimiter, languageId);
				}
				prefixBlocks.push({
					type: context.type === 'prefix' ? 'prefix' : 'context',
					value: normalizeLineEndings(value),
					weight: context.weight as number,
					componentPath: node.path,
					nodeStatistics: node.statistics,
					chunks,
					source: context.source,
				});
			}
			return true;
		});

		if (!foundDocument) {
			throw new Error(`Node of type ${CurrentFile.name} not found`);
		}
		if (suffixBlocks.length > 1) {
			throw new Error(`Only one suffix is allowed`);
		}

		const suffixBlock: WeightedBlock =
			suffixBlocks.length === 1
				? suffixBlocks[0]
				: {
					componentPath: '',
					value: '',
					weight: 1,
					nodeStatistics: {},
					type: 'suffix',
				};
		return { prefixBlocks, suffixBlock, componentStatistics };
	}
}

export const transformers: WalkContextTransformer[] = [
	...defaultTransformers(),
	(node, _, context) => {
		if (isContextNode(node)) {
			return { ...context, type: 'context' };
		}
		return context;
	},
	(node, _, context) => {
		if (node.name === BeforeCursor.name) {
			return {
				...context,
				type: 'prefix',
			};
		}
		return context;
	},
	(node, _, context) => {
		if (node.name === AfterCursor.name) {
			return {
				...context,
				type: 'suffix',
			};
		}
		return context;
	},
];

function computeComponentStatistics(elidedBlocks: ElidedBlock[]) {
	return elidedBlocks.map(block => {
		const result: ComponentStatistics = {
			componentPath: block.componentPath,
		};
		if (block.tokens !== 0) {
			result.expectedTokens = block.tokens;
			result.actualTokens = block.elidedTokens;
		}
		if (block.nodeStatistics.updateDataTimeMs !== undefined) {
			result.updateDataTimeMs = block.nodeStatistics.updateDataTimeMs;
		}
		if (block.source) {
			result.source = block.source;
		}
		return result;
	});
}

export function normalizeLineEndings(text: string) {
	return text.replace(/\r\n?/g, '\n');
}
