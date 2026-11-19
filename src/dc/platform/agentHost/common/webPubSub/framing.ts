/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { type ChunkEnvelope, type ChunkOptions, Reassembler, chunk } from './chunking.js';
import { parseGroupName, type ParseGroupNameOptions, type ParsedGroup } from './groups.js';

export const RELIABLE_JSON_SUBPROTOCOL = 'json.reliable.webpubsub.azure.v1';

export interface SendToGroupCommand {
	readonly type: 'sendToGroup';
	readonly group: string;
	readonly ackId: number;
	readonly dataType: 'json';
	readonly noEcho: true;
	readonly data: ChunkEnvelope;
}

export interface GroupMessage {
	readonly type: 'message';
	readonly from: 'group';
	readonly group: string;
	readonly dataType: 'json';
	readonly data: ChunkEnvelope;
	readonly fromUserId?: string;
	readonly sequenceId?: number;
}

export interface BuildPublishOptions {
	readonly group: string;

	readonly nextAckId: () => number;

	readonly payload: unknown;

	readonly chunkOptions?: ChunkOptions;
}

export function buildPublish(options: BuildPublishOptions): SendToGroupCommand[] {
	const envelopes = chunk(options.payload, options.chunkOptions);
	return envelopes.map(
		envelope => ({
			type: 'sendToGroup',
			group: options.group,
			ackId: options.nextAckId(),
			dataType: 'json',
			noEcho: true,
			data: envelope,
		} satisfies SendToGroupCommand),
	);
}

export type InboundResult =
	| { readonly kind: 'payload'; readonly group: ParsedGroup; readonly payload: unknown }
	| { readonly kind: 'pending'; readonly group: ParsedGroup }
	| { readonly kind: 'ignored' };

export class FramingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FramingError';
	}
}

export interface ParseInboundOptions {
	readonly reassembler: Reassembler;

	readonly groupValidation?: ParseGroupNameOptions;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function parseInbound(frame: unknown, options: ParseInboundOptions): InboundResult {
	if (!isObject(frame)) {
		return { kind: 'ignored' };
	}
	if (frame['type'] !== 'message' || frame['from'] !== 'group') {
		return { kind: 'ignored' };
	}
	if (frame['dataType'] !== 'json') {
		throw new FramingError(`group-fanout frame has unsupported dataType '${String(frame['dataType'])}'`);
	}
	if (typeof frame['group'] !== 'string') {
		throw new FramingError(`group-fanout frame is missing a string 'group' field`);
	}
	if (!isObject(frame['data'])) {
		throw new FramingError(`group-fanout frame is missing a 'data' ChunkEnvelope`);
	}

	const group = parseGroupName(frame['group'], options.groupValidation);
	const envelope = frame['data'] as ChunkEnvelope;
	const payload = options.reassembler.ingest(envelope);
	if (payload === null) {
		return { kind: 'pending', group };
	}
	return { kind: 'payload', group, payload };
}
