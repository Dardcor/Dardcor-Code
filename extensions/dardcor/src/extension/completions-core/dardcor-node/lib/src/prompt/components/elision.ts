/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptSnapshotNodeStatistics } from '../../../../prompt/src/components/components';
import { Tokenizer } from '../../../../prompt/src/tokenization';

export interface WeightedBlock {
	componentPath: string;
	type: 'prefix' | 'suffix' | 'context';
	value: string;
	weight: number;
	index?: number;
	nodeStatistics: PromptSnapshotNodeStatistics;
	chunks?: Set<string>;
	source?: unknown;
}
interface ElidableBlock extends WeightedBlock {
	tokens: number;
	markedForRemoval: boolean;
}

interface LineWithPathAndTokens {
	line: string;
	componentPath: string;
	tokens: number;
}

interface PrefixElidableBlock extends ElidableBlock {
	originalIndex: number;
	lines: LineWithPathAndTokens[];
}

export interface ElidedBlock extends WeightedBlock {
	tokens: number;
	elidedValue: string;
	elidedTokens: number;
}

interface ElisionStrategy {
	elide(
		prefixBlocks: WeightedBlock[],
		prefixTokenLimit: number,
		suffixBlock: WeightedBlock,
		suffixTokenLimit: number,
		tokenizer: Tokenizer
	): { blocks: ElidedBlock[]; cycles: number };
}

export class WishlistElision implements ElisionStrategy {
	elide(
		prefixBlocks: WeightedBlock[],
		prefixTokenLimit: number,
		suffixBlock: WeightedBlock,
		suffixTokenLimit: number,
		tokenizer: Tokenizer
	) {
		if (prefixTokenLimit <= 0) {
			throw new Error('Prefix limit must be greater than 0');
		}

		const [elidablePrefixBlocks, maxPrefixTokens] = this.preparePrefixBlocks(prefixBlocks, tokenizer);
		const { elidedSuffix, adjustedPrefixTokenLimit } = this.elideSuffix(
			suffixBlock,
			suffixTokenLimit,
			prefixTokenLimit,
			maxPrefixTokens,
			tokenizer
		);
		const elidedPrefix = this.elidePrefix(
			elidablePrefixBlocks,
			adjustedPrefixTokenLimit,
			maxPrefixTokens,
			tokenizer
		);

		return { blocks: [elidedSuffix, ...elidedPrefix], cycles: 1 };
	}

	private preparePrefixBlocks(blocks: WeightedBlock[], tokenizer: Tokenizer): [PrefixElidableBlock[], number] {
		let maxPrefixTokens = 0;
		const componentPaths = new Set<string>();

		const elidableBlocks = blocks.map((block, index) => {
			let blockTokens = 0;
			const blockLines = block.value.split(/([^\n]*\n+)/).filter(l => l !== '');
			const processedBlockLines = blockLines.map(line => {
				const tokens = tokenizer.tokenLength(line);
				blockTokens += tokens;
				maxPrefixTokens += tokens;
				return { line, componentPath: block.componentPath, tokens };
			});
			const componentPath = block.componentPath;
			if (componentPaths.has(componentPath)) {
				throw new Error(`Duplicate component path in prefix blocks: ${componentPath}`);
			}
			componentPaths.add(componentPath);
			return {
				...block,
				tokens: blockTokens,
				markedForRemoval: false,
				originalIndex: index,
				lines: processedBlockLines,
			};
		});

		return [elidableBlocks, maxPrefixTokens];
	}

	private elideSuffix(
		suffixBlock: WeightedBlock,
		suffixTokenLimit: number,
		prefixTokenLimit: number,
		maxPrefixTokens: number,
		tokenizer: Tokenizer
	) {
		const suffix = suffixBlock.value;
		if (suffix.length === 0 || suffixTokenLimit <= 0) {
			const elidedSuffix: ElidedBlock = {
				...suffixBlock,
				tokens: 0,
				elidedValue: '',
				elidedTokens: 0,
			};
			return {
				elidedSuffix,
				adjustedPrefixTokenLimit: prefixTokenLimit + Math.max(0, suffixTokenLimit),
			};
		}

		if (maxPrefixTokens < prefixTokenLimit) {
			suffixTokenLimit = suffixTokenLimit + (prefixTokenLimit - maxPrefixTokens);
			prefixTokenLimit = maxPrefixTokens;
		}

		const shortenedSuffix = tokenizer.takeFirstTokens(suffix, suffixTokenLimit);
		const elidedSuffix: ElidedBlock = {
			...suffixBlock,
			value: suffix,
			tokens: tokenizer.tokenLength(suffix),
			elidedValue: shortenedSuffix.text,
			elidedTokens: shortenedSuffix.tokens.length,
		};

		return {
			elidedSuffix,
			adjustedPrefixTokenLimit: prefixTokenLimit + Math.max(0, suffixTokenLimit - shortenedSuffix.tokens.length),
		};
	}

	private elidePrefix(
		elidablePrefixBlocks: PrefixElidableBlock[],
		tokenLimit: number,
		maxPrefixTokens: number,
		tokenizer: Tokenizer
	): ElidedBlock[] {
		const prefixBlocks = this.removeLowWeightPrefixBlocks(elidablePrefixBlocks, tokenLimit, maxPrefixTokens);

		const prefixLines = prefixBlocks.filter(block => !block.markedForRemoval).flatMap(block => block.lines);

		if (prefixLines.length === 0) {
			return [];
		}

		const [trimmedLines, prefixTokens] = this.trimPrefixLinesToFit(prefixLines, tokenLimit, tokenizer);
		let currentPrefixTokens = prefixTokens;
		return prefixBlocks.map(block => {
			if (block.markedForRemoval) {
				if (currentPrefixTokens + block.tokens <= tokenLimit && !block.chunks) {
					currentPrefixTokens += block.tokens;
					return { ...block, elidedValue: block.value, elidedTokens: block.tokens };
				}
				return { ...block, elidedValue: '', elidedTokens: 0 };
			}

			const elidedValue = trimmedLines
				.filter(l => l.componentPath === block.componentPath && l.line !== '')
				.map(l => l.line)
				.join('');
			let elidedTokens = block.tokens;
			if (elidedValue !== block.value) {
				elidedTokens = elidedValue !== '' ? tokenizer.tokenLength(elidedValue) : 0;
			}

			return { ...block, elidedValue, elidedTokens };
		});
	}

	private removeLowWeightPrefixBlocks(
		elidablePrefixBlocks: PrefixElidableBlock[],
		tokenLimit: number,
		maxPrefixTokens: number
	): PrefixElidableBlock[] {
		let totalPrefixTokens = maxPrefixTokens;

		elidablePrefixBlocks.sort((a, b) => a.weight - b.weight);
		for (const block of elidablePrefixBlocks) {
			if (totalPrefixTokens <= tokenLimit) { break; }
			if (block.weight === 1) { continue; }

			if (block.chunks && block.markedForRemoval) { continue; }

			if (block.chunks && block.chunks.size > 0) {
				for (const relatedBlock of elidablePrefixBlocks) {
					if (
						!relatedBlock.markedForRemoval &&
						relatedBlock.chunks &&
						[...block.chunks].every(id => relatedBlock.chunks?.has(id))
					) {
						relatedBlock.markedForRemoval = true;
						totalPrefixTokens -= relatedBlock.tokens;
					}
				}
			} else {
				block.markedForRemoval = true;
				totalPrefixTokens -= block.tokens;
			}
		}

		return elidablePrefixBlocks.sort((a, b) => a.originalIndex - b.originalIndex);
	}

	private trimPrefixLinesToFit(
		linesWithComponentPath: LineWithPathAndTokens[],
		tokenLimit: number,
		tokenizer: Tokenizer
	): [LineWithPathAndTokens[], number] {
		let currentPrefixTokens = 0;

		const fittingLines: typeof linesWithComponentPath = [];

		for (let i = linesWithComponentPath.length - 1; i >= 0; i--) {
			const currentLine = linesWithComponentPath[i];
			const lineTokens = currentLine.tokens;

			if (currentPrefixTokens + lineTokens <= tokenLimit) {
				fittingLines.unshift(currentLine);
				currentPrefixTokens += lineTokens;
			} else {
				break;
			}
		}

		if (fittingLines.length === 0) {
			const lastLine = linesWithComponentPath[linesWithComponentPath.length - 1];
			if (lastLine && lastLine.line.length > 0) {
				const prompt = tokenizer.takeLastTokens(lastLine.line, tokenLimit);
				fittingLines.push({
					line: prompt.text,
					componentPath: lastLine.componentPath,
					tokens: prompt.tokens.length,
				});
				return [fittingLines, prompt.tokens.length];
			}

			const errorMsg = `Cannot fit prefix within limit of ${tokenLimit} tokens`;
			throw new Error(errorMsg);
		}
		return [fittingLines, currentPrefixTokens];
	}
}

export function makePrompt(elidedBlocks: ElidedBlock[]): string {
	return elidedBlocks.map(block => block.elidedValue).join('');
}

export function makePrefixPrompt(elidedBlocks: ElidedBlock[]): string {
	return elidedBlocks
		.filter(b => b.type === 'prefix')
		.map(block => block.elidedValue)
		.join('');
}

export function makeContextPrompt(elidedBlocks: ElidedBlock[]): string[] {
	if (elidedBlocks.length === 0) {
		return [];
	}

	const contextGroups = new Map<number, string[]>();
	for (const block of elidedBlocks) {
		if (block.type === 'context' && block.index !== undefined) {
			if (!contextGroups.has(block.index)) {
				contextGroups.set(block.index, []);
			}
			const trimmed = block.elidedValue.trim();
			if (trimmed.length > 0) {
				contextGroups.get(block.index)!.push(trimmed);
			}
		}
	}

	const maxIndex = Math.max(...Array.from(contextGroups.keys()), -1);

	const contextBlocks = [];
	for (let i = 0; i <= maxIndex; i++) {
		const group = contextGroups.get(i);
		if (group && group.length > 0) {
			const value = group.join('\n').trim();
			contextBlocks.push(value);
		} else {
			contextBlocks.push('');
		}
	}

	return contextBlocks;
}
