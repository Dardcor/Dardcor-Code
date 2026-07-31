/**
 * Dardcor Code - Binary Stream Encoder For Terminal PTY Output Data (Task 821)
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { concatBuffers, readUInt32BE, writeUInt32BE } from '../transport/framed-protocol.js';

export const enum PtyPacketKind {
	Data = 0,
	Resize = 1,
	Exit = 2
}

export interface PtyDataPacket {
	readonly kind: PtyPacketKind.Data;
	readonly data: Uint8Array;
}

export interface PtyResizePacket {
	readonly kind: PtyPacketKind.Resize;
	readonly cols: number;
	readonly rows: number;
}

export interface PtyExitPacket {
	readonly kind: PtyPacketKind.Exit;
	readonly exitCode: number;
}

export type PtyPacket = PtyDataPacket | PtyResizePacket | PtyExitPacket;

const PACKET_HEADER_SIZE = 5;

export function encodePtyData(data: Uint8Array | string): Uint8Array {
	const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
	return encodePtyPacket({ kind: PtyPacketKind.Data, data: bytes });
}

export function encodePtyResize(cols: number, rows: number): Uint8Array {
	const payload = new Uint8Array(8);
	payload.set(writeUInt32BE(cols), 0);
	payload.set(writeUInt32BE(rows), 4);
	return encodePtyPacket({ kind: PtyPacketKind.Resize, cols, rows });
}

export function encodePtyExit(exitCode: number): Uint8Array {
	return encodePtyPacket({ kind: PtyPacketKind.Exit, exitCode });
}

export function encodePtyPacket(packet: PtyPacket): Uint8Array {
	switch (packet.kind) {
		case PtyPacketKind.Data: {
			const header = new Uint8Array(PACKET_HEADER_SIZE);
			header[0] = PtyPacketKind.Data;
			header.set(writeUInt32BE(packet.data.byteLength), 1);
			return concatBuffers(header, packet.data);
		}
		case PtyPacketKind.Resize: {
			const bytes = new Uint8Array(PACKET_HEADER_SIZE + 8);
			bytes[0] = PtyPacketKind.Resize;
			bytes.set(writeUInt32BE(8), 1);
			bytes.set(writeUInt32BE(packet.cols), 5);
			bytes.set(writeUInt32BE(packet.rows), 9);
			return bytes;
		}
		case PtyPacketKind.Exit: {
			const bytes = new Uint8Array(PACKET_HEADER_SIZE + 4);
			bytes[0] = PtyPacketKind.Exit;
			bytes.set(writeUInt32BE(4), 1);
			bytes.set(writeUInt32BE(packet.exitCode), 5);
			return bytes;
		}
	}
}

export function decodePtyPacket(packet: Uint8Array): PtyPacket {
	if (packet.byteLength < PACKET_HEADER_SIZE) {
		throw new Error(`Invalid PTY packet: ${packet.byteLength} bytes`);
	}
	const kind = packet[0] as PtyPacketKind;
	const length = readUInt32BE(packet, 1);
	switch (kind) {
		case PtyPacketKind.Data:
			return { kind, data: packet.subarray(PACKET_HEADER_SIZE, PACKET_HEADER_SIZE + length) };
		case PtyPacketKind.Resize:
			return {
				kind,
				cols: readUInt32BE(packet, 5),
				rows: readUInt32BE(packet, 9)
			};
		case PtyPacketKind.Exit:
			return { kind, exitCode: readUInt32BE(packet, 5) };
		default:
			throw new Error(`Unknown PTY packet kind: ${kind}`);
	}
}

export class PtyPacketDecoder extends Disposable {
	private _buffer: Uint8Array = new Uint8Array(0);

	private readonly _onPacket = this._register(new Emitter<PtyPacket>());
	readonly onPacket: Event<PtyPacket> = this._onPacket.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	push(chunk: Uint8Array): void {
		this._buffer = concatBuffers(this._buffer, chunk);
		while (this._buffer.byteLength >= PACKET_HEADER_SIZE) {
			const length = readUInt32BE(this._buffer, 1);
			if (this._buffer.byteLength < PACKET_HEADER_SIZE + length) {
				break;
			}
			const packetBytes = this._buffer.subarray(0, PACKET_HEADER_SIZE + length);
			this._buffer = this._buffer.subarray(PACKET_HEADER_SIZE + length);
			try {
				this._onPacket.fire(decodePtyPacket(packetBytes));
			} catch (error) {
				this._onError.fire(error instanceof Error ? error : new Error(String(error)));
			}
		}
	}

	reset(): void {
		this._buffer = new Uint8Array(0);
	}
}
