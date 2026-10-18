/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from './cancellation.js';

type SparseEmbedding = Record< string, number>;
type TermFrequencies = Map< string, number>;
type DocumentOccurrences = Map< string, number>;

function countMapFrom<K>(values: Iterable<K>): Map<K, number> {
	const map = new Map<K, number>();
	for (const value of values) {
		map.set(value, (map.get(value) ?? 0) + 1);
	}
	return map;
}

interface DocumentChunkEntry {
	readonly text: string;
	readonly tf: TermFrequencies;
}

export interface TfIdfDocument {
	readonly key: string;
	readonly textChunks: readonly string[];
}

export interface TfIdfScore {
	readonly key: string;
	readonly score: number;
}

export interface NormalizedTfIdfScore {
	readonly key: string;
	readonly score: number;
}

export class TfIdfCalculator {
	calculateScores(query: string, token: CancellationToken): TfIdfScore[] {
		const embedding = this.computeEmbedding(query);
		const idfCache = new Map<string, number>();
		const scores: TfIdfScore[] = [];
		for (const [key, doc] of this.documents) {
			if (token.isCancellationRequested) {
				return [];
			}

			for (const chunk of doc.chunks) {
				const score = this.computeSimilarityScore(chunk, embedding, idfCache);
				if (score > 0) {
					scores.push({ key, score });
				}
			}
		}

		return scores;
	}

	private static termFrequencies(input: string): TermFrequencies {
		return countMapFrom(TfIdfCalculator.splitTerms(input));
	}

	private static *splitTerms(input: string): Iterable<string> {
		const normalize = (word: string) => word.toLowerCase();

		for (const [word] of input.matchAll(/\b\p{Letter}[\p{Letter}\d]{2,}\b/gu)) {
			yield normalize(word);

			const camelParts = word.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/g);
			if (camelParts.length > 1) {
				for (const part of camelParts) {
					if (part.length > 2 && /\p{Letter}{3,}/gu.test(part)) {
						yield normalize(part);
					}
				}
			}
		}
	}

	private chunkCount = 0;

	private readonly chunkOccurrences: DocumentOccurrences = new Map< string, number>();

	private readonly documents = new Map< string, {
		readonly chunks: ReadonlyArray<DocumentChunkEntry>;
	}>();

	updateDocuments(documents: ReadonlyArray<TfIdfDocument>): this {
		for (const { key } of documents) {
			this.deleteDocument(key);
		}

		for (const doc of documents) {
			const chunks: Array<{ text: string; tf: TermFrequencies }> = [];
			for (const text of doc.textChunks) {
				const tf = TfIdfCalculator.termFrequencies(text);

				for (const term of tf.keys()) {
					this.chunkOccurrences.set(term, (this.chunkOccurrences.get(term) ?? 0) + 1);
				}

				chunks.push({ text, tf });
			}

			this.chunkCount += chunks.length;
			this.documents.set(doc.key, { chunks });
		}
		return this;
	}

	deleteDocument(key: string) {
		const doc = this.documents.get(key);
		if (!doc) {
			return;
		}

		this.documents.delete(key);
		this.chunkCount -= doc.chunks.length;

		for (const chunk of doc.chunks) {
			for (const term of chunk.tf.keys()) {
				const currentOccurrences = this.chunkOccurrences.get(term);
				if (typeof currentOccurrences === 'number') {
					const newOccurrences = currentOccurrences - 1;
					if (newOccurrences <= 0) {
						this.chunkOccurrences.delete(term);
					} else {
						this.chunkOccurrences.set(term, newOccurrences);
					}
				}
			}
		}
	}

	private computeSimilarityScore(chunk: DocumentChunkEntry, queryEmbedding: SparseEmbedding, idfCache: Map<string, number>): number {


		let sum = 0;
		for (const [term, termTfidf] of Object.entries(queryEmbedding)) {
			const chunkTf = chunk.tf.get(term);
			if (!chunkTf) {
				continue;
			}

			let chunkIdf = idfCache.get(term);
			if (typeof chunkIdf !== 'number') {
				chunkIdf = this.computeIdf(term);
				idfCache.set(term, chunkIdf);
			}

			const chunkTfidf = chunkTf * chunkIdf;
			sum += chunkTfidf * termTfidf;
		}
		return sum;
	}

	private computeEmbedding(input: string): SparseEmbedding {
		const tf = TfIdfCalculator.termFrequencies(input);
		return this.computeTfidf(tf);
	}

	private computeIdf(term: string): number {
		const chunkOccurrences = this.chunkOccurrences.get(term) ?? 0;
		return chunkOccurrences > 0
			? Math.log((this.chunkCount + 1) / chunkOccurrences)
			: 0;
	}

	private computeTfidf(termFrequencies: TermFrequencies): SparseEmbedding {
		const embedding = Object.create(null);
		for (const [word, occurrences] of termFrequencies) {
			const idf = this.computeIdf(word);
			if (idf > 0) {
				embedding[word] = occurrences * idf;
			}
		}
		return embedding;
	}
}

export function normalizeTfIdfScores(scores: TfIdfScore[]): NormalizedTfIdfScore[] {

	const result = scores.slice(0) as { score: number }[];

	result.sort((a, b) => b.score - a.score);

	const max = result[0]?.score ?? 0;
	if (max > 0) {
		for (const score of result) {
			score.score /= max;
		}
	}

	return result as TfIdfScore[];
}
