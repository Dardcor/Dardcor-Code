/**
 * Dardcor Code - Text Snapshot Buffer Builder (Task 231)
 * Mirrors: vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts
 */

import { PieceTree } from './piece-tree.js';

export interface ITextBufferChunk {
	readonly text: string;
}

export interface ITextSnapshot {
	read(): string | null;
}

export class TextBufferChunk implements ITextBufferChunk {
	constructor(public readonly text: string) {}
}

export class TextSnapshot implements ITextSnapshot {
	private _index = 0;

	constructor(private readonly _chunks: readonly string[]) {}

	public read(): string | null {
		if (this._index >= this._chunks.length) {
			return null;
		}
		return this._chunks[this._index++];
	}

	public getText(): string {
		return this._chunks.join('');
	}

	public getChunkCount(): number {
		return this._chunks.length;
	}
}

export class TextBufferBuilder {
	private _chunks: string[] = [];
	private _totalLength = 0;

	public acceptChunk(chunk: string): void {
		if (!chunk) {
			return;
		}
		this._chunks.push(chunk);
		this._totalLength += chunk.length;
	}

	public acceptChunks(chunks: Iterable<string>): void {
		for (const chunk of chunks) {
			this.acceptChunk(chunk);
		}
	}

	public getTotalLength(): number {
		return this._totalLength;
	}

	public getChunkCount(): number {
		return this._chunks.length;
	}

	public finish(): TextSnapshot {
		const snapshot = new TextSnapshot(this._chunks);
		this._chunks = [];
		this._totalLength = 0;
		return snapshot;
	}
}

export interface IPieceDescriptor {
	readonly bufferIndex: number;
	readonly start: number;
	readonly length: number;
}

export class PieceTreeBufferFactory {
	private readonly _builder = new TextBufferBuilder();
	private _firstChunk: string | null = null;

	public acceptChunk(chunk: string): void {
		if (this._firstChunk === null) {
			this._firstChunk = chunk;
		}
		this._builder.acceptChunk(chunk);
	}

	public createPieceTree(): PieceTree {
		const text = this._builder.finish().getText();
		return new PieceTree(text);
	}

	public createSnapshot(): ITextSnapshot {
		return this._builder.finish();
	}

	public static fromText(text: string): PieceTreeBufferFactory {
		const factory = new PieceTreeBufferFactory();
		factory.acceptChunk(text);
		return factory;
	}

	public static buildPieceDescriptors(chunks: readonly string[]): IPieceDescriptor[] {
		const descriptors: IPieceDescriptor[] = [];
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			if (!chunk) {
				continue;
			}
			descriptors.push({ bufferIndex: i, start: 0, length: chunk.length });
		}
		return descriptors;
	}

	public static chunkLineByLine(text: string): string[] {
		return text.split(/\r?\n/);
	}
}
