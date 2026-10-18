/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageModelToolInformation } from 'vscode';
import { Embedding, EmbeddingType } from '../../../../platform/embeddings/common/embeddingsComputer';
import { packEmbedding, unpackEmbedding } from '../../../../platform/embeddings/common/embeddingsStorage';
import { IVSCodeExtensionContext } from '../../../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import { readVariableLengthQuantity, writeVariableLengthQuantity } from '../../../../util/common/variableLengthQuantity';
import { RunOnceScheduler } from '../../../../util/dardcor/base/common/async';
import { VSBuffer, decodeHex, encodeHex } from '../../../../util/dardcor/base/common/buffer';
import { StringSHA1 } from '../../../../util/dardcor/base/common/hash';
import { Disposable } from '../../../../util/dardcor/base/common/lifecycle';
import { LRUCache } from '../../../../util/dardcor/base/common/map';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { IToolEmbeddingsCache } from './toolEmbeddingsComputer';

const EMBEDDING_CACHE_FILE_NAME = 'toolEmbeddingsCache.bin';
const CACHE_VERSION = 1;
const SHA1_DIGEST_LENGTH = 20;

export class ToolEmbeddingLocalCache extends Disposable implements IToolEmbeddingsCache {
	private readonly _storageUri: URI;
	private readonly _lru = new LRUCache<string, Embedding>(1000);
	private readonly _toolHashes = new WeakMap<LanguageModelToolInformation, string>();
	private readonly _storageScheduler = this._register(new RunOnceScheduler(() => this.save(), 5000));
	private readonly _embeddingType: EmbeddingType;

	constructor(
		embeddingType: EmbeddingType,
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IVSCodeExtensionContext _context: IVSCodeExtensionContext,
	) {
		super();
		this._embeddingType = embeddingType;
		this._storageUri = URI.joinPath(_context.globalStorageUri, EMBEDDING_CACHE_FILE_NAME);
	}

	public async initialize(): Promise<void> {
		try {
			const buffer = VSBuffer.wrap(await this._fileSystemService.readFile(this._storageUri, true));
			let offset = 0;

			const versionResult = readVariableLengthQuantity(buffer, offset);
			offset += versionResult.consumed;
			if (versionResult.value !== CACHE_VERSION) {
				return;
			}

			const typeLengthResult = readVariableLengthQuantity(buffer, offset);
			offset += typeLengthResult.consumed;
			const typeLength = typeLengthResult.value;

			const typeBytes = buffer.slice(offset, offset + typeLength);
			offset += typeLength;
			const storedEmbeddingTypeId = new TextDecoder().decode(typeBytes.buffer);
			const storedEmbeddingType = new EmbeddingType(storedEmbeddingTypeId);

			if (!storedEmbeddingType.equals(this._embeddingType)) {
				return;
			}

			const entriesCountResult = readVariableLengthQuantity(buffer, offset);
			offset += entriesCountResult.consumed;
			const entriesCount = entriesCountResult.value;

			for (let i = 0; i < entriesCount; i++) {
				const keyBytes = buffer.slice(offset, offset + SHA1_DIGEST_LENGTH);
				offset += SHA1_DIGEST_LENGTH;
				const key = encodeHex(keyBytes);

				const embeddingLengthResult = readVariableLengthQuantity(buffer, offset);
				offset += embeddingLengthResult.consumed;
				const embeddingLength = embeddingLengthResult.value;

				const embeddingBytes = buffer.slice(offset, offset + embeddingLength);
				offset += embeddingLength;

				const embedding = unpackEmbedding(this._embeddingType, new Uint8Array(embeddingBytes.buffer));
				this._lru.set(key, embedding);
			}
		} catch {
		}
	}

	public get(tool: LanguageModelToolInformation): Embedding | undefined {
		return this._lru.get(this._getKey(tool));
	}

	public set(tool: LanguageModelToolInformation, embedding: Embedding): void {
		const key = this._getKey(tool);
		this._lru.set(key, embedding);
		this._storageScheduler.schedule();
	}

	private _getKey(tool: LanguageModelToolInformation): string {
		let hash = this._toolHashes.get(tool);
		if (!hash) {
			const sha = new StringSHA1();
			sha.update(tool.name);
			sha.update('\0');
			sha.update(tool.description);
			hash = sha.digest();
			this._toolHashes.set(tool, hash);
		}

		return hash;
	}

	public async save() {
		this._storageScheduler.cancel();

		if (!this._lru.size) {
			return;
		}

		const entries = this._lru.toJSON();
		const buffers: VSBuffer[] = [];

		buffers.push(writeVariableLengthQuantity(CACHE_VERSION));

		const typeBytes = new TextEncoder().encode(this._embeddingType.id);
		buffers.push(writeVariableLengthQuantity(typeBytes.length));
		buffers.push(VSBuffer.wrap(typeBytes));

		buffers.push(writeVariableLengthQuantity(entries.length));

		for (const [key, embedding] of entries) {
			const keyBinary = decodeHex(key);
			buffers.push(VSBuffer.wrap(keyBinary.buffer));

			const packedEmbedding = packEmbedding(embedding);
			buffers.push(writeVariableLengthQuantity(packedEmbedding.length));
			buffers.push(VSBuffer.wrap(packedEmbedding));
		}

		const totalBuffer = VSBuffer.concat(buffers);
		await this._fileSystemService.writeFile(this._storageUri, totalBuffer.buffer);
	}
}

