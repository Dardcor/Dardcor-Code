/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it } from 'vitest';
import { Embedding, EmbeddingType } from '../../common/embeddingsComputer';
import { EmbeddingsGrouper, GroupingOptions, Node } from '../../common/embeddingsGrouper';

interface TestTool {
	name: string;
	category: string;
}

function createEmbedding(values: number[]): Embedding {
	return {
		type: EmbeddingType.text3small_512,
		value: values
	};
}

function createNode(name: string, category: string, embedding: number[]): Node<TestTool> {
	return {
		value: { name, category },
		embedding: createEmbedding(embedding)
	};
}

function createSimilarEmbeddings(): number[][] {
	return [
		[1, 0.8, 0.2, 0.1],
		[0.9, 0.7, 0.1, 0.15],
		[0.1, 0.2, 1, 0.8],
		[0.15, 0.1, 0.9, 0.7],
		[0.5, 0.5, 0.5, 0.5]
	];
}

describe('EmbeddingsGrouper', () => {
	let grouper: EmbeddingsGrouper<TestTool>;

	beforeEach(() => {
		grouper = new EmbeddingsGrouper<TestTool>();
	});

	describe('constructor and initial state', () => {
		it('should initialize with empty clusters', () => {
			expect(grouper.getClusters()).toHaveLength(0);
		});

		it('should accept custom options', () => {
			const options: GroupingOptions = {
				eps: 0.85,
				minClusterSize: 3,
				insertThreshold: 0.7
			};
			const customGrouper = new EmbeddingsGrouper<TestTool>(options);
			expect(customGrouper.getClusters()).toHaveLength(0);
		});
	});

	describe('addNode', () => {
		it('should create singleton cluster for first node', () => {
			const node = createNode('tool1', 'category1', [1, 0, 0, 0]);
			grouper.addNode(node);

			const clusters = grouper.getClusters();
			expect(clusters).toHaveLength(1);
			expect(clusters[0].nodes).toHaveLength(1);
			expect(clusters[0].nodes[0]).toBe(node);
		});

		it('should create separate clusters for dissimilar nodes', () => {
			const node1 = createNode('tool1', 'category1', [1, 0, 0, 0]);
			const node2 = createNode('tool2', 'category2', [0, 1, 0, 0]);

			grouper.addNode(node1);
			grouper.addNode(node2);

			const clusters = grouper.getClusters();
			expect(clusters).toHaveLength(2);
			expect(clusters.every(c => c.nodes.length === 1)).toBe(true);
		});

		it('should add similar nodes to existing clusters when possible', () => {
			const embeddings = createSimilarEmbeddings();
			const nodes = [
				createNode('tool1', 'category1', embeddings[0]),
				createNode('tool2', 'category1', embeddings[1])
			];

			grouper.addNode(nodes[0]);
			grouper.addNode(nodes[1]);

			grouper.recluster();

			const clusters = grouper.getClusters();
			expect(clusters.length).toBeGreaterThan(0);

			const cluster = grouper.getClusterForNode(nodes[0]);
			expect(cluster).toBeDefined();
			expect(cluster!.nodes.some(n => n === nodes[1])).toBe(true);
		});
	});

	describe('addNodes (bulk)', () => {
		it('should handle empty array efficiently', () => {
			grouper.addNodes([]);
			expect(grouper.getClusters()).toHaveLength(0);
		});

		it('should add multiple nodes and cluster them efficiently', () => {
			const embeddings = createSimilarEmbeddings();
			const nodes = [
				createNode('search', 'lookup', embeddings[0]),
				createNode('find', 'lookup', embeddings[1]),
				createNode('create', 'generate', embeddings[2]),
				createNode('make', 'generate', embeddings[3]),
				createNode('random', 'misc', embeddings[4])
			];

			grouper.addNodes(nodes);

			const clusters = grouper.getClusters();
			expect(clusters.length).toBeGreaterThanOrEqual(2);

			const totalNodesInClusters = clusters.reduce((sum, cluster) => sum + cluster.nodes.length, 0);
			expect(totalNodesInClusters).toBe(nodes.length);
		});

		it('should allow deferring clustering with reclusterAfter=false', () => {
			const nodes = [
				createNode('tool1', 'cat1', [1, 0, 0, 0]),
				createNode('tool2', 'cat1', [0.9, 0.1, 0, 0]),
				createNode('tool3', 'cat1', [0, 1, 0, 0])
			];

			grouper.addNodes(nodes, false);

			const clusters = grouper.getClusters();
			expect(clusters).toHaveLength(3);
			expect(clusters.every(c => c.nodes.length === 1)).toBe(true);

			grouper.recluster();
			const clustersAfterRecluster = grouper.getClusters();
			expect(clustersAfterRecluster.length).toBeLessThanOrEqual(clusters.length);
		});
	});

	describe('removeNode', () => {
		it('should return false for non-existent node', () => {
			const node = createNode('tool1', 'category1', [1, 0, 0, 0]);
			const result = grouper.removeNode(node);
			expect(result).toBe(false);
		});

		it('should remove node and return true for existing node', () => {
			const node = createNode('tool1', 'category1', [1, 0, 0, 0]);
			grouper.addNode(node);

			const result = grouper.removeNode(node);
			expect(result).toBe(true);
			expect(grouper.getClusters()).toHaveLength(0);
		});

		it('should remove empty clusters when last node is removed', () => {
			const node = createNode('tool1', 'category1', [1, 0, 0, 0]);
			grouper.addNode(node);
			expect(grouper.getClusters()).toHaveLength(1);

			grouper.removeNode(node);
			expect(grouper.getClusters()).toHaveLength(0);
		});

		it('should update cluster when node is removed from multi-node cluster', () => {
			const embeddings = createSimilarEmbeddings();
			const nodes = [
				createNode('tool1', 'category1', embeddings[0]),
				createNode('tool2', 'category1', embeddings[1]),
				createNode('tool3', 'category1', embeddings[0])
			];

			nodes.forEach(node => grouper.addNode(node));
			grouper.recluster();

			const initialClusters = grouper.getClusters();
			const clusterWithMultipleNodes = initialClusters.find(c => c.nodes.length > 1);

			if (clusterWithMultipleNodes && clusterWithMultipleNodes.nodes.length > 1) {
				const nodeToRemove = clusterWithMultipleNodes.nodes[0];
				grouper.removeNode(nodeToRemove);

				const updatedCluster = grouper.getClusterForNode(clusterWithMultipleNodes.nodes[1]);
				expect(updatedCluster).toBeDefined();
				expect(updatedCluster!.nodes.some(n => n === nodeToRemove)).toBe(false);
			}
		});
	});

	describe('recluster', () => {
		it('should handle empty node list', () => {
			grouper.recluster();
			expect(grouper.getClusters()).toHaveLength(0);
		});

		it('should create single cluster for single node', () => {
			const node = createNode('tool1', 'category1', [1, 0, 0, 0]);
			grouper.addNode(node);
			grouper.recluster();

			const clusters = grouper.getClusters();
			expect(clusters).toHaveLength(1);
			expect(clusters[0].nodes).toHaveLength(1);
		});

		it('should group similar embeddings together', () => {
			const embeddings = createSimilarEmbeddings();
			const nodes = [
				createNode('search', 'lookup', embeddings[0]),
				createNode('find', 'lookup', embeddings[1]),
				createNode('create', 'generate', embeddings[2]),
				createNode('make', 'generate', embeddings[3]),
				createNode('random', 'misc', embeddings[4])
			];

			nodes.forEach(node => grouper.addNode(node));
			grouper.recluster();

			const clusters = grouper.getClusters();
			expect(clusters.length).toBeGreaterThanOrEqual(2);

			const searchCluster = grouper.getClusterForNode(nodes[0]);
			const findCluster = grouper.getClusterForNode(nodes[1]);
			const createCluster = grouper.getClusterForNode(nodes[2]);
			const makeCluster = grouper.getClusterForNode(nodes[3]);

			expect(searchCluster).toBeDefined();
			expect(findCluster).toBeDefined();
			expect(createCluster).toBeDefined();
			expect(makeCluster).toBeDefined();
		});

		it('should respect minimum cluster size option', () => {
			const grouper = new EmbeddingsGrouper<TestTool>({ minClusterSize: 3 });
			const embeddings = createSimilarEmbeddings();
			const nodes = [
				createNode('tool1', 'cat1', embeddings[0]),
				createNode('tool2', 'cat1', embeddings[1])
			];

			nodes.forEach(node => grouper.addNode(node));
			grouper.recluster();

			const clusters = grouper.getClusters();
			expect(clusters.every(c => c.nodes.length < 3)).toBe(true);
		});
	});

	describe('getClusterForNode', () => {
		it('should return undefined for non-existent node', () => {
			const node = createNode('tool1', 'category1', [1, 0, 0, 0]);
			const cluster = grouper.getClusterForNode(node);
			expect(cluster).toBeUndefined();
		});

		it('should return correct cluster for existing node', () => {
			const node = createNode('tool1', 'category1', [1, 0, 0, 0]);
			grouper.addNode(node);

			const cluster = grouper.getClusterForNode(node);
			expect(cluster).toBeDefined();
			expect(cluster!.nodes).toContain(node);
		});
	});

	describe('clustering quality', () => {
		it('should handle identical embeddings', () => {
			const identicalEmbedding = [1, 0, 0, 0];
			const nodes = [
				createNode('tool1', 'cat1', identicalEmbedding),
				createNode('tool2', 'cat1', identicalEmbedding),
				createNode('tool3', 'cat1', identicalEmbedding)
			];

			nodes.forEach(node => grouper.addNode(node));
			grouper.recluster();

			const clusters = grouper.getClusters();
			expect(clusters).toHaveLength(1);
			expect(clusters[0].nodes).toHaveLength(3);
		});

		it('should handle zero vectors', () => {
			const zeroEmbedding = [0, 0, 0, 0];
			const node = createNode('tool1', 'cat1', zeroEmbedding);
			grouper.addNode(node);
			grouper.recluster();

			const clusters = grouper.getClusters();
			expect(clusters).toHaveLength(1);
			expect(clusters[0].centroid).toEqual([0, 0, 0, 0]);
		});

		it('should handle varied similarity distributions', () => {
			const nodes = [
				createNode('very_similar_1', 'cat1', [1, 0.1, 0, 0]),
				createNode('very_similar_2', 'cat1', [0.9, 0.1, 0, 0]),
				createNode('somewhat_similar', 'cat1', [0.7, 0.3, 0.1, 0]),
				createNode('different_1', 'cat2', [0, 0, 1, 0.1]),
				createNode('different_2', 'cat2', [0.1, 0, 0.9, 0.1]),
				createNode('outlier', 'cat3', [0.25, 0.25, 0.25, 0.25])
			];

			nodes.forEach(node => grouper.addNode(node));
			grouper.recluster();

			const clusters = grouper.getClusters();
			expect(clusters.length).toBeGreaterThan(1);
			expect(clusters.length).toBeLessThanOrEqual(nodes.length);

			const allNodesInClusters = clusters.flatMap(c => c.nodes);
			expect(allNodesInClusters).toHaveLength(nodes.length);
		});
	});

	describe('adaptive threshold behavior', () => {
		it('should work with different similarity percentiles', () => {
			const strictGrouper = new EmbeddingsGrouper<TestTool>({ eps: 0.95 });
			const lenientGrouper = new EmbeddingsGrouper<TestTool>({ eps: 0.8 });

			const embeddings = createSimilarEmbeddings();
			const nodes = embeddings.map((emb, i) =>
				createNode(`tool${i}`, 'category', emb)
			);

			nodes.forEach(node => {
				strictGrouper.addNode({ ...node });
				lenientGrouper.addNode({ ...node });
			});

			strictGrouper.recluster();
			lenientGrouper.recluster();

			const strictClusters = strictGrouper.getClusters();
			const lenientClusters = lenientGrouper.getClusters();

			expect(strictClusters.length).toBeGreaterThanOrEqual(lenientClusters.length);
		});
	});

	describe('centroid computation', () => {
		it('should compute correct centroids for clusters', () => {
			const nodes = [
				createNode('tool1', 'cat1', [1, 0, 0, 0]),
				createNode('tool2', 'cat1', [0, 1, 0, 0])
			];

			nodes.forEach(node => grouper.addNode(node));
			grouper.recluster();

			const clusters = grouper.getClusters();
			clusters.forEach(cluster => {
				expect(cluster.centroid).toBeDefined();
				expect(cluster.centroid.length).toBeGreaterThan(0);

				const magnitude = Math.sqrt(cluster.centroid.reduce((sum, val) => sum + val * val, 0));
				if (magnitude > 0) {
					expect(magnitude).toBeCloseTo(1, 5);
				}
			});
		});
	});

	describe('threshold tuning optimization', () => {
		it('should find optimal percentile for target cluster count', () => {
			const embeddings = createSimilarEmbeddings();
			const nodes = [
				createNode('search', 'lookup', embeddings[0]),
				createNode('find', 'lookup', embeddings[1]),
				createNode('create', 'generate', embeddings[2]),
				createNode('make', 'generate', embeddings[3]),
				createNode('random1', 'misc', embeddings[4]),
				createNode('random2', 'misc', [0.3, 0.3, 0.3, 0.1]),
				createNode('random3', 'misc', [0.1, 0.3, 0.3, 0.3])
			];

			grouper.addNodes(nodes, false);

			const result = grouper.tuneThresholdForTargetClusters(4);

			expect(result.clusterCount).toBeLessThanOrEqual(4);
			expect(result.percentile).toBeGreaterThanOrEqual(80);
			expect(result.percentile).toBeLessThanOrEqual(99);
			expect(result.threshold).toBeGreaterThan(0);
		});

		it('should apply percentile and recluster efficiently', () => {
			const embeddings = createSimilarEmbeddings();
			const nodes = embeddings.map((emb, i) =>
				createNode(`tool${i}`, 'category', emb)
			);

			grouper.addNodes(nodes);

			grouper.applyPercentileAndRecluster(98);
			const strictClusterCount = grouper.getClusters().length;

			grouper.applyPercentileAndRecluster(85);
			const lenientClusterCount = grouper.getClusters().length;

			expect(strictClusterCount).toBeGreaterThanOrEqual(lenientClusterCount);

			const allClusters = grouper.getClusters();
			const totalNodes = allClusters.reduce((sum, cluster) => sum + cluster.nodes.length, 0);
			expect(totalNodes).toBe(nodes.length);
		});

		it('should cache similarities for efficient repeated tuning', () => {
			const nodes: Node<TestTool>[] = [];

			for (let group = 0; group < 3; group++) {
				for (let i = 0; i < 10; i++) {
					const baseAngle = group * (2 * Math.PI / 3);
					const variation = i * 0.1;

					const embedding = [
						Math.cos(baseAngle + variation) * 0.8 + 0.2,
						Math.sin(baseAngle + variation) * 0.8 + 0.2,
						Math.cos(baseAngle * 2 + variation * 0.5) * 0.3 + 0.1,
						Math.sin(baseAngle * 2 + variation * 0.5) * 0.3 + 0.1
					];
					nodes.push(createNode(`tool${group}_${i}`, `cat${group}`, embedding));
				}
			}

			grouper.addNodes(nodes, false);

			const result1 = grouper.tuneThresholdForTargetClusters(15);
			const result2 = grouper.tuneThresholdForTargetClusters(8);
			const result3 = grouper.tuneThresholdForTargetClusters(5);

			expect(result1.clusterCount).toBeLessThanOrEqual(15);
			expect(result2.clusterCount).toBeLessThanOrEqual(8);

			expect(result3.clusterCount).toBeLessThanOrEqual(5);

			expect(result1.clusterCount).toBeGreaterThanOrEqual(result2.clusterCount);
			expect(result2.clusterCount).toBeGreaterThanOrEqual(result3.clusterCount);
		}); it('should handle edge cases in threshold tuning', () => {
			const emptyResult = grouper.tuneThresholdForTargetClusters(5);
			expect(emptyResult.clusterCount).toBe(0);

			grouper.addNode(createNode('single', 'cat', [1, 0, 0, 0]));
			const singleResult = grouper.tuneThresholdForTargetClusters(5);
			expect(singleResult.clusterCount).toBe(1);

			const nodes = [
				createNode('tool1', 'cat1', [1, 0, 0, 0]),
				createNode('tool2', 'cat1', [0, 1, 0, 0])
			];
			grouper.addNodes(nodes);
			const highTargetResult = grouper.tuneThresholdForTargetClusters(10);
			expect(highTargetResult.clusterCount).toBeLessThanOrEqual(3);
		});
	});

	describe('edge cases', () => {
		it('should handle single dimension embeddings', () => {
			const nodes = [
				createNode('tool1', 'cat1', [1]),
				createNode('tool2', 'cat1', [0.9]),
				createNode('tool3', 'cat1', [0.1])
			];

			nodes.forEach(node => grouper.addNode(node));
			grouper.recluster();

			const clusters = grouper.getClusters();
			expect(clusters.length).toBeGreaterThan(0);
		});

		it('should handle large number of nodes efficiently', () => {
			const nodes: Node<TestTool>[] = [];
			for (let i = 0; i < 100; i++) {
				const groupId = Math.floor(i / 10);
				const withinGroupVariation = (i % 10) * 0.1;

				const embedding = [
					groupId === 0 ? 1 - withinGroupVariation * 0.2 : withinGroupVariation * 0.2,
					groupId === 1 ? 1 - withinGroupVariation * 0.2 : withinGroupVariation * 0.2,
					groupId === 2 ? 1 - withinGroupVariation * 0.2 : withinGroupVariation * 0.2,
					groupId >= 3 ? 1 - withinGroupVariation * 0.2 : withinGroupVariation * 0.2
				];
				nodes.push(createNode(`tool${i}`, `cat${groupId}`, embedding));
			}

			nodes.forEach(node => grouper.addNode(node));
			grouper.recluster();

			const clusters = grouper.getClusters();
			expect(clusters.length).toBeGreaterThanOrEqual(2);
			expect(clusters.length).toBeLessThanOrEqual(nodes.length);

			const totalNodesInClusters = clusters.reduce((sum, cluster) => sum + cluster.nodes.length, 0);
			expect(totalNodesInClusters).toBe(nodes.length);
		});
	});
});


