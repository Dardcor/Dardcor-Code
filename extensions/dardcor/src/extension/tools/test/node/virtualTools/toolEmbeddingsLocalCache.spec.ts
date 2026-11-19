/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LanguageModelToolInformation } from 'vscode';
import { Embedding, EmbeddingType } from '../../../../../platform/embeddings/common/embeddingsComputer';
import { IVSCodeExtensionContext } from '../../../../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../../../../platform/filesystem/common/fileSystemService';
import { MockFileSystemService } from '../../../../../platform/filesystem/node/test/mockFileSystemService';
import { ITestingServicesAccessor } from '../../../../../platform/test/node/services';
import { DisposableStore } from '../../../../../util/dardcor/base/common/lifecycle';
import { URI } from '../../../../../util/dardcor/base/common/uri';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { ToolEmbeddingLocalCache } from '../../../common/virtualTools/toolEmbeddingsLocalCache';

class TestableFileSystemService extends MockFileSystemService {
	private writtenFiles = new Map<string, Uint8Array>();

	override async writeFile(uri: URI, content: Uint8Array): Promise<void> {
		const uriString = uri.toString();
		this.writtenFiles.set(uriString, content);

		const contentString = Buffer.from(content).toString('base64');
		this.mockFile(uri, contentString);
	}

	override async readFile(uri: URI): Promise<Uint8Array> {
		const uriString = uri.toString();

		if (this.writtenFiles.has(uriString)) {
			return this.writtenFiles.get(uriString)!;
		}

		try {
			const base64Content = await super.readFile(uri);
			return Buffer.from(new TextDecoder().decode(base64Content), 'base64');
		} catch {
			throw new Error('ENOENT');
		}
	}

	getWrittenContent(uri: URI): Uint8Array | undefined {
		return this.writtenFiles.get(uri.toString());
	}
}

describe('ToolEmbeddingLocalCache', () => {
	let disposables: DisposableStore;
	let accessor: ITestingServicesAccessor;
	let mockFileSystem: TestableFileSystemService;
	let cache: ToolEmbeddingLocalCache;
	let mockContext: IVSCodeExtensionContext;
	let embeddingType: EmbeddingType;

	const createSampleTool = (name: string, description: string = `Description for ${name}`): LanguageModelToolInformation => ({
		name,
		description
	} as LanguageModelToolInformation);

	const createSampleEmbedding = (type: EmbeddingType, values: number[] = [0.1, 0.2, 0.3, 0.4]): Embedding => ({
		type,
		value: values
	});

	const createFloat32Embedding = (type: EmbeddingType, values: number[]): Embedding => ({
		type,
		value: Array.from(Float32Array.from(values))
	});

	const expectEmbeddingToEqual = (actual: Embedding | undefined, expected: Embedding) => {
		expect(actual).toBeDefined();
		expect(actual!.type).toEqual(expected.type);
		expect(actual!.value.length).toBe(expected.value.length);
		actual!.value.forEach((actualVal, i) => {
			const expectedVal = expected.value[i];
			expect(Math.abs(actualVal - expectedVal)).toBeLessThan(1e-5);
		});
	};

	beforeEach(() => {
		disposables = new DisposableStore();
		const testingServiceCollection = disposables.add(createExtensionUnitTestingServices());
		mockFileSystem = new TestableFileSystemService();
		testingServiceCollection.set(IFileSystemService, mockFileSystem);
		testingServiceCollection.set(IVSCodeExtensionContext, { globalStorageUri: URI.file('/tmp') } as any);
		accessor = testingServiceCollection.createTestingAccessor();
		mockContext = accessor.get(IVSCodeExtensionContext);
		embeddingType = EmbeddingType.text3small_512;

		cache = disposables.add(new ToolEmbeddingLocalCache(
			embeddingType,
			mockFileSystem,
			mockContext
		));
	});

	afterEach(() => {
		disposables.dispose();
	});

	describe('Basic Operations', () => {
		it('should initialize without error when no cache file exists', async () => {
			await expect(cache.initialize()).resolves.not.toThrow();
		});

		it('should get undefined for non-existent tool', () => {
			const tool = createSampleTool('nonexistent');
			expect(cache.get(tool)).toBeUndefined();
		});

		it('should store and retrieve embeddings', () => {
			const tool = createSampleTool('test-tool');
			const embedding = createSampleEmbedding(embeddingType);

			cache.set(tool, embedding);
			const retrieved = cache.get(tool);

			expect(retrieved).toEqual(embedding);
		});

		it('should generate consistent keys for same tool', () => {
			const tool1 = createSampleTool('same-tool', 'description');
			const tool2 = createSampleTool('same-tool', 'description');
			const embedding = createSampleEmbedding(embeddingType);

			cache.set(tool1, embedding);
			const retrieved = cache.get(tool2);

			expect(retrieved).toEqual(embedding);
		});

		it('should generate different keys for different tools', () => {
			const tool1 = createSampleTool('tool1');
			const tool2 = createSampleTool('tool2');
			const embedding1 = createSampleEmbedding(embeddingType, [0.1, 0.2]);
			const embedding2 = createSampleEmbedding(embeddingType, [0.3, 0.4]);

			cache.set(tool1, embedding1);
			cache.set(tool2, embedding2);

			expect(cache.get(tool1)).toEqual(embedding1);
			expect(cache.get(tool2)).toEqual(embedding2);
		});
	});

	describe('Persistence', () => {
		it('should save and load cache to/from binary format', async () => {
			const tool1 = createSampleTool('persistent-tool-1');
			const tool2 = createSampleTool('persistent-tool-2');
			const embedding1 = createFloat32Embedding(embeddingType, [0.1, 0.2, 0.3, 0.4]);
			const embedding2 = createFloat32Embedding(embeddingType, [0.5, 0.6, 0.7, 0.8]);

			cache.set(tool1, embedding1);
			cache.set(tool2, embedding2);

			cache.save();

			const cacheUri = URI.joinPath(mockContext.globalStorageUri, 'toolEmbeddingsCache.bin');
			const writtenContent = mockFileSystem.getWrittenContent(cacheUri);
			expect(writtenContent).toBeDefined();
			expect(writtenContent!.length).toBeGreaterThan(0);

			const newCache = disposables.add(new ToolEmbeddingLocalCache(
				embeddingType,
				mockFileSystem,
				mockContext
			));

			await newCache.initialize();

			expectEmbeddingToEqual(newCache.get(tool1), embedding1);
			expectEmbeddingToEqual(newCache.get(tool2), embedding2);
		});

		it('should discard cache when embedding type does not match', async () => {
			const tool = createSampleTool('type-mismatch-tool');
			const embedding = createSampleEmbedding(embeddingType);

			cache.set(tool, embedding);
			cache.save();

			const differentType = EmbeddingType.metis_1024_I16_Binary;
			const newCache = disposables.add(new ToolEmbeddingLocalCache(
				differentType,
				mockFileSystem,
				mockContext
			));

			await newCache.initialize();

			expect(newCache.get(tool)).toBeUndefined();
		});

		it('should handle corrupted cache file gracefully', async () => {
			const cacheUri = URI.joinPath(mockContext.globalStorageUri, 'toolEmbeddingsCache.bin');

			const corruptedData = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
			await mockFileSystem.writeFile(cacheUri, corruptedData);

			await expect(cache.initialize()).resolves.not.toThrow();

			const tool = createSampleTool('test-after-corruption');
			expect(cache.get(tool)).toBeUndefined();
		});

		it('should handle version mismatch gracefully', async () => {
			const tool = createSampleTool('version-test-tool');
			const embedding = createSampleEmbedding(embeddingType);

			cache.set(tool, embedding);
			cache.save();

			const cacheUri = URI.joinPath(mockContext.globalStorageUri, 'toolEmbeddingsCache.bin');
			const currentContent = mockFileSystem.getWrittenContent(cacheUri)!;
			const modifiedContent = new Uint8Array(currentContent);
			modifiedContent[0] = 99;
			await mockFileSystem.writeFile(cacheUri, modifiedContent);

			const newCache = disposables.add(new ToolEmbeddingLocalCache(
				embeddingType,
				mockFileSystem,
				mockContext
			));

			await newCache.initialize();

			expect(newCache.get(tool)).toBeUndefined();
		});
	});

	describe('Binary Format Efficiency', () => {
		it('should use binary format with fixed-length keys', async () => {
			const tool = createSampleTool('efficiency-test');
			const embedding = createSampleEmbedding(embeddingType, new Array(512).fill(0).map((_, i) => i / 512));

			cache.set(tool, embedding);
			cache.save();

			const cacheUri = URI.joinPath(mockContext.globalStorageUri, 'toolEmbeddingsCache.bin');
			const content = mockFileSystem.getWrittenContent(cacheUri)!;

			expect(content.length).toBeLessThan(3000);
			expect(content.length).toBeGreaterThan(100);
		});
	});

	describe('Multiple Tool Scenarios', () => {
		it('should handle many tools efficiently', async () => {
			const tools: LanguageModelToolInformation[] = [];
			const embeddings: Embedding[] = [];

			for (let i = 0; i < 50; i++) {
				const tool = createSampleTool(`bulk-tool-${i}`, `Description ${i}`);
				const embedding = createSampleEmbedding(embeddingType, [i, i + 0.1, i + 0.2, i + 0.3]);

				tools.push(tool);
				embeddings.push(embedding);
				cache.set(tool, embedding);
			}

			await cache.save();

			const newCache = disposables.add(new ToolEmbeddingLocalCache(
				embeddingType,
				mockFileSystem,
				mockContext
			));

			await newCache.initialize();

			tools.forEach((tool, i) => {
				expect(cache.get(tool)).toEqual(embeddings[i]);
				expectEmbeddingToEqual(newCache.get(tool), embeddings[i]);
			});
		});
	});
});
