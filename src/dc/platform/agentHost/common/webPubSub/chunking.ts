/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { VSBuffer, decodeBase64, encodeBase64 } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';

export type ChunkEnvelope =
	| { readonly kind: 'message'; readonly data: unknown }
	| {
		readonly kind: 'chunk';
		readonly group_id: string;
		readonly seq: number;
		readonly total: number;
		readonly bytes: string;
	};

export const DEFAULT_MAX_CHUNK_BYTES = 900 * 1024;

export const DEFAULT_REASSEMBLY_TIMEOUT_MS = 30_000;

export const DEFAULT_MAX_REASSEMBLY_BYTES = 32 * 1024 * 1024;

export const DEFAULT_MAX_REASSEMBLY_TOTAL_BYTES = 64 * 1024 * 1024;

export const DEFAULT_MAX_CONCURRENT_GROUPS = 64;

export const DEFAULT_MAX_SEGMENTS_PER_GROUP = 4096;

export class ChunkingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ChunkingError';
	}
}

export interface ChunkOptions {
	readonly maxChunkBytes?: number;

	readonly newGroupId?: () => string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function bytesToBase64(bytes: Uint8Array): string {
	return encodeBase64(VSBuffer.wrap(bytes), true , false );
}

function base64ToBytes(b64: string): Uint8Array {
	return decodeBase64(b64).buffer;
}

export function chunk(payload: unknown, options: ChunkOptions = {}): ChunkEnvelope[] {
	const maxChunkBytes = options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES;
	if (maxChunkBytes <= 0 || !Number.isFinite(maxChunkBytes)) {
		throw new ChunkingError(`maxChunkBytes must be a positive finite number, got ${maxChunkBytes}`);
	}

	let payloadSerialised: string | undefined;
	try {
		payloadSerialised = JSON.stringify(payload);
	} catch (cause) {
		throw new ChunkingError(`payload is not JSON-serialisable: ${(cause as Error).message}`);
	}
	if (payloadSerialised === undefined) {
		throw new ChunkingError('payload is not JSON-serialisable');
	}
	const rawBytes = textEncoder.encode(payloadSerialised);
	if (rawBytes.byteLength > DEFAULT_MAX_REASSEMBLY_BYTES) {
		throw new ChunkingError(
			`serialized payload is ${rawBytes.byteLength} bytes, exceeds ${DEFAULT_MAX_REASSEMBLY_BYTES}-byte ceiling`,
		);
	}

	const singleSerialised = JSON.stringify({ kind: 'message', data: payload });
	if (textEncoder.encode(singleSerialised).byteLength <= maxChunkBytes) {
		return [{ kind: 'message', data: payload }];
	}

	const newGroupId = options.newGroupId ?? generateUuid;
	const groupId = newGroupId();
	if (typeof groupId !== 'string' || groupId.length === 0) {
		throw new ChunkingError('newGroupId() must return a non-empty string');
	}

	const emptyEnvelope: ChunkEnvelope = {
		kind: 'chunk',
		group_id: groupId,
		seq: DEFAULT_MAX_SEGMENTS_PER_GROUP - 1,
		total: DEFAULT_MAX_SEGMENTS_PER_GROUP,
		bytes: '',
	};
	const overhead = textEncoder.encode(JSON.stringify(emptyEnvelope)).byteLength;
	const encodedBudget = Math.floor((maxChunkBytes - overhead) / 4) * 4;
	if (encodedBudget < 4) {
		throw new ChunkingError(
			`maxChunkBytes (${maxChunkBytes}) leaves no complete base64 quantum after ${overhead} bytes of envelope overhead`,
		);
	}
	const rawBudget = (encodedBudget / 4) * 3;
	const total = Math.ceil(rawBytes.byteLength / rawBudget);
	if (total > DEFAULT_MAX_SEGMENTS_PER_GROUP) {
		throw new ChunkingError(`payload requires ${total} chunks, exceeds ${DEFAULT_MAX_SEGMENTS_PER_GROUP}-chunk ceiling`);
	}

	const out: ChunkEnvelope[] = new Array<ChunkEnvelope>(total);
	for (let i = 0; i < total; i++) {
		const start = i * rawBudget;
		const end = Math.min(start + rawBudget, rawBytes.byteLength);
		const slice = rawBytes.subarray(start, end);
		out[i] = {
			kind: 'chunk',
			group_id: groupId,
			seq: i,
			total,
			bytes: bytesToBase64(slice),
		};
	}
	return out;
}

export interface ReassemblerOptions {
	readonly timeoutMs?: number;

	readonly maxBufferBytes?: number;

	readonly maxTotalBufferBytes?: number;

	readonly maxConcurrentGroups?: number;

	readonly maxSegmentsPerGroup?: number;

	readonly now?: () => number;
}

interface ReassemblyBuffer {
	total: number;
	received: number;
	segments: Map<number, Uint8Array>;
	accumulatedBytes: number;
	startedAt: number;
}

export class Reassembler {
	private readonly buffers = new Map<string, ReassemblyBuffer>();
	private readonly timeoutMs: number;
	private readonly maxBufferBytes: number;
	private readonly maxTotalBufferBytes: number;
	private readonly maxConcurrentGroups: number;
	private readonly maxSegmentsPerGroup: number;
	private readonly now: () => number;
	private accumulatedBytes = 0;

	constructor(options: ReassemblerOptions = {}) {
		this.timeoutMs = options.timeoutMs ?? DEFAULT_REASSEMBLY_TIMEOUT_MS;
		this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_REASSEMBLY_BYTES;
		this.maxTotalBufferBytes = options.maxTotalBufferBytes ?? DEFAULT_MAX_REASSEMBLY_TOTAL_BYTES;
		this.maxConcurrentGroups = options.maxConcurrentGroups ?? DEFAULT_MAX_CONCURRENT_GROUPS;
		this.maxSegmentsPerGroup = options.maxSegmentsPerGroup ?? DEFAULT_MAX_SEGMENTS_PER_GROUP;
		this.now = options.now ?? Date.now;
	}

	ingest(envelope: ChunkEnvelope): unknown {
		if (envelope === null || typeof envelope !== 'object') {
			throw new ChunkingError(`ChunkEnvelope must be an object, got ${typeof envelope}`);
		}
		if (envelope.kind === 'message') {
			if (envelope.data === undefined) {
				throw new ChunkingError(`ChunkEnvelope kind:'message' is missing the required 'data' field`);
			}
			return envelope.data;
		}

		if (envelope.kind !== 'chunk') {
			throw new ChunkingError(`unknown ChunkEnvelope kind: ${String((envelope as { kind: unknown }).kind)}`);
		}

		const { group_id: groupId, seq, total, bytes } = envelope;

		if (!Number.isInteger(total) || total < 1) {
			throw new ChunkingError(`total must be a positive integer, got ${total}`);
		}
		if (total > this.maxSegmentsPerGroup) {
			throw new ChunkingError(`total ${total} exceeds maxSegmentsPerGroup ${this.maxSegmentsPerGroup}`);
		}
		if (typeof groupId !== 'string' || groupId.length === 0) {
			throw new ChunkingError('group_id must be a non-empty string');
		}
		if (typeof bytes !== 'string') {
			throw new ChunkingError('bytes must be a base64 string');
		}

		let buffer = this.buffers.get(groupId);
		if (buffer === undefined) {
			if (this.buffers.size >= this.maxConcurrentGroups) {
				throw new ChunkingError(
					`refusing new group_id '${groupId}': ${this.buffers.size} concurrent groups already in flight`,
				);
			}
			buffer = {
				total,
				received: 0,
				segments: new Map<number, Uint8Array>(),
				accumulatedBytes: 0,
				startedAt: this.now(),
			};
			this.buffers.set(groupId, buffer);
		} else if (buffer.total !== total) {
			this.dropBuffer(groupId);
			throw new ChunkingError(`total mismatch for group_id '${groupId}': existing ${buffer.total}, incoming ${total}`);
		}

		if (!Number.isInteger(seq) || seq < 0 || seq >= total) {
			this.dropBuffer(groupId);
			throw new ChunkingError(`seq ${seq} out of range [0, ${total})`);
		}

		if (buffer.segments.has(seq)) {
			this.dropBuffer(groupId);
			throw new ChunkingError(`duplicate seq ${seq} for group_id '${groupId}'`);
		}

		if (!CANONICAL_BASE64.test(bytes)) {
			this.dropBuffer(groupId);
			throw new ChunkingError(`base64 segment for group_id '${groupId}' is not canonical`);
		}

		let decoded: Uint8Array;
		try {
			decoded = base64ToBytes(bytes);
		} catch (cause) {
			this.dropBuffer(groupId);
			throw new ChunkingError(`base64 decode failed for group_id '${groupId}': ${(cause as Error).message}`);
		}

		if (buffer.accumulatedBytes + decoded.byteLength > this.maxBufferBytes) {
			this.dropBuffer(groupId);
			throw new ChunkingError(`group_id '${groupId}' exceeded ${this.maxBufferBytes}-byte reassembly ceiling`);
		}
		if (this.accumulatedBytes + decoded.byteLength > this.maxTotalBufferBytes) {
			this.dropBuffer(groupId);
			throw new ChunkingError(`aggregate reassembly bytes would exceed ${this.maxTotalBufferBytes}-byte ceiling`);
		}

		buffer.segments.set(seq, decoded);
		buffer.received += 1;
		buffer.accumulatedBytes += decoded.byteLength;
		this.accumulatedBytes += decoded.byteLength;

		if (buffer.received < buffer.total) {
			return null;
		}

		const totalBytes = buffer.accumulatedBytes;
		const merged = new Uint8Array(totalBytes);
		let offset = 0;
		for (let i = 0; i < buffer.total; i++) {
			const slice = buffer.segments.get(i);
			if (slice === undefined) {
				this.dropBuffer(groupId);
				throw new ChunkingError(`internal: segment ${i} missing despite received==total`);
			}
			merged.set(slice, offset);
			offset += slice.byteLength;
		}
		this.dropBuffer(groupId);

		let text: string;
		try {
			text = textDecoder.decode(merged);
		} catch (cause) {
			throw new ChunkingError(
				`reassembled payload for group_id '${groupId}' is not valid UTF-8: ${(cause as Error).message}`,
			);
		}
		try {
			return JSON.parse(text) as unknown;
		} catch (cause) {
			throw new ChunkingError(
				`reassembled payload for group_id '${groupId}' is not valid JSON: ${(cause as Error).message}`,
			);
		}
	}

	sweepExpired(): string[] {
		const dropped: string[] = [];
		const cutoff = this.now() - this.timeoutMs;
		for (const [groupId, buffer] of this.buffers) {
			if (buffer.startedAt <= cutoff) {
				this.dropBuffer(groupId);
				dropped.push(groupId);
			}
		}
		return dropped;
	}

	get inFlightGroupCount(): number {
		return this.buffers.size;
	}

	get inFlightBytes(): number {
		return this.accumulatedBytes;
	}

	private dropBuffer(groupId: string): void {
		const buffer = this.buffers.get(groupId);
		if (buffer === undefined) {
			return;
		}
		this.accumulatedBytes -= buffer.accumulatedBytes;
		this.buffers.delete(groupId);
	}
}
