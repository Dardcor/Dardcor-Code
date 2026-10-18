/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Embedding, EmbeddingVector } from './embeddingsComputer';

export interface Node<T> {
	readonly value: T;
	readonly embedding: Embedding;
}

export interface Cluster<T> {
	readonly id: string;
	readonly nodes: readonly Node<T>[];
	readonly centroid: EmbeddingVector;
}

export interface GroupingOptions {
	readonly eps?: number;
	readonly minClusterSize?: number;
	readonly insertThreshold?: number;
}

export class EmbeddingsGrouper<T> {
	private nodes: Node<T>[] = [];
	private clusters: Cluster<T>[] = [];
	private nodeToClusterId = new Map<Node<T>, string>();
	private clusterCounter = 0;
	private normalizedEmbeddings = new Map<Node<T>, EmbeddingVector>();
	private cachedSimilarities: number[] | undefined;
	private readonly options: {
		eps: number;
		minClusterSize: number;
		insertThreshold?: number;
	};

	constructor(options?: GroupingOptions) {
		this.options = {
			eps: 0.9,
			minClusterSize: 2,
			...options,
		};
	}

	addNode(node: Node<T>): void {
		this.nodes.push(node);
		this.normalizedEmbeddings.set(node, this.normalizeVector(node.embedding.value));
		this.cachedSimilarities = undefined;

		if (this.clusters.length > 0) {
			const insertThreshold = this.options.insertThreshold ?? this.lastUsedThreshold;
			const bestCluster = this.findBestClusterForNode(node, insertThreshold);

			if (bestCluster) {
				this.addNodeToCluster(node, bestCluster);
				return;
			}
		}

		this.createSingletonCluster(node);
	}

	addNodes(nodes: Node<T>[], reclusterAfter: boolean = true): void {
		if (nodes.length === 0) {
			return;
		}

		for (const node of nodes) {
			this.nodes.push(node);
		}
		this.cachedSimilarities = undefined;

		if (reclusterAfter) {
			this.recluster();
		} else {
			for (const node of nodes) {
				this.createSingletonCluster(node);
			}
		}
	}

	removeNode(node: Node<T>): boolean {
		const nodeIndex = this.nodes.indexOf(node);
		if (nodeIndex === -1) {
			return false;
		}

		this.nodes.splice(nodeIndex, 1);
		this.normalizedEmbeddings.delete(node);
		this.cachedSimilarities = undefined;

		const clusterId = this.nodeToClusterId.get(node);
		if (clusterId) {
			this.nodeToClusterId.delete(node);
			this.removeNodeFromCluster(node, clusterId);
		}

		return true;
	}

	recluster(): void {
		if (this.nodes.length === 0) {
			this.clusters = [];
			this.nodeToClusterId.clear();
			return;
		}

		this.clusters = [];
		this.nodeToClusterId.clear();

		const clusterAssignments = this.runSimilarityBasedClustering(this.options.eps, this.options.minClusterSize);

		this.createClustersFromAssignments(clusterAssignments);
	}

	getClusters(): readonly Cluster<T>[] {
		return this.clusters;
	}

	getClusterForNode(node: Node<T>): Cluster<T> | undefined {
		const clusterId = this.nodeToClusterId.get(node);
		return clusterId ? this.clusters.find(c => c.id === clusterId) : undefined;
	}

	private lastUsedThreshold = 0.9;

	private computeEpsFromPercentile(percentile: number): number {
		if (this.nodes.length < 2) {
			return 0.9;
		}

		const similarities = this.getSimilarities();
		if (similarities.length === 0) {
			return 0.9;
		}

		const index = Math.floor((percentile / 100) * similarities.length);
		const threshold = similarities[Math.min(index, similarities.length - 1)];

		this.lastUsedThreshold = threshold;
		return threshold;
	}

	private runSimilarityBasedClustering(threshold: number, minClusterSize: number): number[] {
		const assignments: number[] = new Array(this.nodes.length).fill(-1);
		const processed: boolean[] = new Array(this.nodes.length).fill(false);
		let clusterId = 0;

		const seeds = this.findClusterSeeds(threshold, minClusterSize);

		for (const seed of seeds) {
			if (processed[seed]) {
				continue;
			}

			const cluster = this.buildClusterAroundSeed(seed, threshold, processed);
			if (cluster.length >= minClusterSize) {
				for (const nodeIndex of cluster) {
					assignments[nodeIndex] = clusterId;
					processed[nodeIndex] = true;
				}
				clusterId++;
			}
		}

		return assignments;
	}

	private findClusterSeeds(threshold: number, minClusterSize: number): number[] {
		const seeds: number[] = [];
		const similarityCounts: number[] = new Array(this.nodes.length).fill(0);

		for (let i = 0; i < this.nodes.length; i++) {
			for (let j = i + 1; j < this.nodes.length; j++) {
				const similarity = this.cachedCosineSimilarity(this.nodes[i], this.nodes[j]);
				if (similarity >= threshold) {
					similarityCounts[i]++;
					similarityCounts[j]++;
				}
			}
		}

		for (let i = 0; i < this.nodes.length; i++) {
			if (similarityCounts[i] >= minClusterSize - 1) {
				seeds.push(i);
			}
		}

		seeds.sort((a, b) => similarityCounts[b] - similarityCounts[a]);
		return seeds;
	}

	private buildClusterAroundSeed(seed: number, threshold: number, processed: boolean[]): number[] {
		const cluster = [seed];

		for (let i = 0; i < this.nodes.length; i++) {
			if (i === seed || processed[i]) {
				continue;
			}

			const similarity = this.cachedCosineSimilarity(this.nodes[seed], this.nodes[i]);
			if (similarity >= threshold) {
				cluster.push(i);
			}
		}

		return cluster;
	}

	private createClustersFromAssignments(clusterAssignments: number[]): void {
		const clusterMap = new Map<number, Node<T>[]>();
		const unassigned: Node<T>[] = [];

		for (let i = 0; i < clusterAssignments.length; i++) {
			const clusterId = clusterAssignments[i];
			const node = this.nodes[i];

			if (clusterId === -1) {
				unassigned.push(node);
			} else {
				if (!clusterMap.has(clusterId)) {
					clusterMap.set(clusterId, []);
				}
				clusterMap.get(clusterId)!.push(node);
			}
		}

		for (const [, nodes] of clusterMap) {
			if (nodes.length >= this.options.minClusterSize) {
				this.createCluster(nodes);
			} else {
				for (const node of nodes) {
					this.createSingletonCluster(node);
				}
			}
		}

		for (const node of unassigned) {
			this.createSingletonCluster(node);
		}
	}

	private findBestClusterForNode(node: Node<T>, threshold: number): Cluster<T> | undefined {
		let bestCluster: Cluster<T> | undefined;
		let bestSimilarity = -1;

		for (const cluster of this.clusters) {
			const similarity = this.dotProduct(
				this.getNormalizedEmbedding(node),
				cluster.centroid
			);
			if (similarity >= threshold && similarity > bestSimilarity) {
				bestSimilarity = similarity;
				bestCluster = cluster;
			}
		}

		return bestCluster;
	}

	private addNodeToCluster(node: Node<T>, cluster: Cluster<T>): void {
		const updatedNodes = [...cluster.nodes, node];
		const updatedCentroid = this.computeCentroid(updatedNodes.map(n => n.embedding.value));

		const updatedCluster: Cluster<T> = {
			...cluster,
			nodes: updatedNodes,
			centroid: updatedCentroid
		};

		const clusterIndex = this.clusters.indexOf(cluster);
		this.clusters[clusterIndex] = updatedCluster;

		this.nodeToClusterId.set(node, cluster.id);
	}

	private removeNodeFromCluster(node: Node<T>, clusterId: string): void {
		const clusterIndex = this.clusters.findIndex(c => c.id === clusterId);
		if (clusterIndex === -1) {
			return;
		}

		const cluster = this.clusters[clusterIndex];
		const updatedNodes = cluster.nodes.filter(n => n !== node);

		if (updatedNodes.length === 0) {
			this.clusters.splice(clusterIndex, 1);
		} else {
			const updatedCentroid = this.computeCentroid(updatedNodes.map(n => n.embedding.value));
			const updatedCluster: Cluster<T> = {
				...cluster,
				nodes: updatedNodes,
				centroid: updatedCentroid
			};
			this.clusters[clusterIndex] = updatedCluster;

			for (const remainingNode of updatedNodes) {
				this.nodeToClusterId.set(remainingNode, clusterId);
			}
		}
	}

	private createCluster(nodes: Node<T>[]): void {
		const id = `cluster_${this.clusterCounter++}`;
		const centroid = this.computeCentroid(nodes.map(n => n.embedding.value));

		const cluster: Cluster<T> = {
			id,
			nodes,
			centroid
		};

		this.clusters.push(cluster);

		for (const node of nodes) {
			this.nodeToClusterId.set(node, id);
		}
	}

	private createSingletonCluster(node: Node<T>): void {
		this.createCluster([node]);
	}

	private computeCentroid(embeddings: EmbeddingVector[]): EmbeddingVector {
		if (embeddings.length === 0) {
			return [];
		}

		if (embeddings.length === 1) {
			return [...embeddings[0]];
		}

		const dimensions = embeddings[0].length;
		const centroid = new Array(dimensions).fill(0);

		for (const embedding of embeddings) {
			for (let i = 0; i < dimensions; i++) {
				centroid[i] += embedding[i];
			}
		}

		for (let i = 0; i < dimensions; i++) {
			centroid[i] /= embeddings.length;
		}

		return this.normalizeVector(centroid);
	}

	private getSimilarities() {
		if (this.cachedSimilarities) {
			return this.cachedSimilarities;
		}

		const similarities: number[] = [];

		for (let i = 0; i < this.nodes.length; i++) {
			for (let j = i + 1; j < this.nodes.length; j++) {
				const sim = this.cachedCosineSimilarity(this.nodes[i], this.nodes[j]);
				similarities.push(sim);
			}
		}

		similarities.sort((a, b) => a - b);
		this.cachedSimilarities = similarities;
		return this.cachedSimilarities;
	}

	tuneThresholdForTargetClusters(
		maxClusters: number,
		minThreshold: number = 0.7,
		maxThreshold: number = 0.99,
		precision: number = 0.02,
		cliffThreshold: number = 2 / 3,
		cliffGain: number = 0.2
	): { percentile: number; clusterCount: number; threshold: number } {
		if (this.nodes.length === 0) {
			return { percentile: 90, clusterCount: 0, threshold: 0.9 };
		}

		const cliffPoint = Math.floor(maxClusters * cliffThreshold);
		const minGainAfterCliff = Math.max(1, Math.floor(maxClusters * cliffGain));

		let bestThreshold = maxThreshold;
		let bestClusterCount = 1;
		let cliffReached = false;

		let low = minThreshold;
		let high = maxThreshold;

		while (high - low > precision) {
			const mid = (low + high) / 2;
			const clusterCount = this.countClustersForThreshold(mid, this.options.minClusterSize);

			if (clusterCount <= maxClusters) {
				let shouldUpdate = false;

				if (!cliffReached && clusterCount >= cliffPoint) {
					cliffReached = true;
					shouldUpdate = clusterCount > bestClusterCount;
				} else if (cliffReached) {
					shouldUpdate = clusterCount >= bestClusterCount + minGainAfterCliff;
				} else {
					shouldUpdate = clusterCount > bestClusterCount;
				}

				if (shouldUpdate) {
					bestThreshold = mid;
					bestClusterCount = clusterCount;
				}

				low = mid + precision;
			} else {
				high = mid - precision;
			}
		}

		const similarities = this.getSimilarities();
		let approximatePercentile = 90;
		if (similarities.length > 0) {
			const position = similarities.findIndex(s => s >= bestThreshold);
			if (position >= 0) {
				approximatePercentile = Math.round((position / similarities.length) * 100);
			}
		}

		return {
			percentile: approximatePercentile,
			clusterCount: bestClusterCount,
			threshold: bestThreshold
		};
	}

	applyPercentileAndRecluster(percentile: number): void {
		const eps = this.computeEpsFromPercentile(percentile);
		const originalEps = this.options.eps;
		(this.options as any).eps = eps;

		try {
			this.recluster();
		} finally {
			(this.options as any).eps = originalEps;
		}
	}

	private countClustersForThreshold(threshold: number, minClusterSize: number): number {
		if (this.nodes.length === 0) {
			return 0;
		}

		const clusterAssignments = this.runSimilarityBasedClustering(threshold, minClusterSize);

		const clusterIds = new Set<number>();
		for (const clusterId of clusterAssignments) {
			if (clusterId !== -1) {
				clusterIds.add(clusterId);
			}
		}

		const clusterSizes = new Map<number, number>();
		let unassignedCount = 0;

		for (const clusterId of clusterAssignments) {
			if (clusterId === -1) {
				unassignedCount++;
			} else {
				clusterSizes.set(clusterId, (clusterSizes.get(clusterId) || 0) + 1);
			}
		}

		let validClusters = 0;
		let singletons = unassignedCount;

		for (const [, size] of clusterSizes) {
			if (size >= minClusterSize) {
				validClusters++;
			} else {
				singletons += size;
			}
		}

		return validClusters + singletons;
	}

	private getNormalizedEmbedding(node: Node<T>): EmbeddingVector {
		let normalized = this.normalizedEmbeddings.get(node);
		if (!normalized) {
			normalized = this.normalizeVector(node.embedding.value);
			this.normalizedEmbeddings.set(node, normalized);
		}
		return normalized;
	}

	private cachedCosineSimilarity(nodeA: Node<T>, nodeB: Node<T>): number {
		const normA = this.getNormalizedEmbedding(nodeA);
		const normB = this.getNormalizedEmbedding(nodeB);
		return this.dotProduct(normA, normB);
	}

	private dotProduct(a: EmbeddingVector, b: EmbeddingVector): number {
		let dotProduct = 0;
		const len = Math.min(a.length, b.length);
		let i = 0;
		for (; i < len - 3; i += 4) {
			dotProduct += a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3];
		}
		for (; i < len; i++) {
			dotProduct += a[i] * b[i];
		}
		return dotProduct;
	}

	private normalizeVector(vector: EmbeddingVector): EmbeddingVector {
		const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

		if (magnitude === 0) {
			return vector.slice();
		}

		return vector.map(val => val / magnitude);
	}
}
