/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../util/dardcor/base/common/uri';
import { Range } from '../../../util/dardcor/editor/common/core/range';
import { Embedding, EmbeddingDistance } from '../../embeddings/common/embeddingsComputer';

export interface Chunk {
	readonly text: string;
}

export interface FileChunk extends Chunk {

	readonly rawText: string | undefined;

	readonly file: URI;

	readonly range: Range;

	readonly isFullFile?: boolean;
}

export interface FileChunkAndScore<T extends FileChunk = FileChunk> {
	readonly chunk: T;
	readonly distance: EmbeddingDistance | undefined;
}

export type FileChunkWithOptionalEmbedding = {
	readonly chunk: FileChunk;
	readonly chunkHash: string | undefined;
	readonly embedding: Embedding | undefined;
};

export type FileChunkWithEmbedding = {
	readonly chunk: FileChunk;
	readonly embedding: Embedding;
	readonly chunkHash: string | undefined;
};
