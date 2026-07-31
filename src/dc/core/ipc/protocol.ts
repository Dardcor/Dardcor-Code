/**
 * Dardcor Code - Framed IPC Serialization Protocol
 */

import { DataBuffer } from '../binary/buffer.js';

export interface IPCMessage {
	id: number;
	type: number;
	channel?: string;
	command?: string;
	payload?: any;
}

export class IPCProtocol {
	private _nextId = 1;

	public serialize(msg: IPCMessage): DataBuffer {
		const str = JSON.stringify(msg);
		return DataBuffer.fromString(str);
	}

	public deserialize(buffer: DataBuffer): IPCMessage {
		const str = buffer.toString();
		return JSON.parse(str);
	}

	public createRequest(channel: string, command: string, payload?: any): IPCMessage {
		return {
			id: this._nextId++,
			type: 1, // Request
			channel,
			command,
			payload
		};
	}
}
