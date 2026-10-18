
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface ISSEEvent {
	type: string;

	data: string;

	id?: string;

	retry?: number;
}

export type SSEEventHandler = (event: ISSEEvent) => void;

const enum Chr {
	CR = 13,
	LF = 10,
	COLON = 58,
	SPACE = 32,
}

export class SSEParser {
	private dataBuffer = '';
	private eventTypeBuffer = '';
	private currentEventId?: string;
	private lastEventIdBuffer?: string;
	private reconnectionTime?: number;
	private buffer: Uint8Array[] = [];
	private endedOnCR = false;
	private readonly onEventHandler: SSEEventHandler;
	private readonly decoder: TextDecoder;
	constructor(onEvent: SSEEventHandler) {
		this.onEventHandler = onEvent;
		this.decoder = new TextDecoder('utf-8');
	}

	public getLastEventId(): string | undefined {
		return this.lastEventIdBuffer;
	}
	public getReconnectionTime(): number | undefined {
		return this.reconnectionTime;
	}

	public feed(chunk: Uint8Array): void {
		if (chunk.length === 0) {
			return;
		}

		let offset = 0;

		if (this.endedOnCR && chunk[0] === Chr.LF) {
			offset++;
		}
		this.endedOnCR = false;

		while (offset < chunk.length) {
			const indexCR = chunk.indexOf(Chr.CR, offset);
			const indexLF = chunk.indexOf(Chr.LF, offset);
			const index = indexCR === -1 ? indexLF : (indexLF === -1 ? indexCR : Math.min(indexCR, indexLF));
			if (index === -1) {
				break;
			}

			let str = '';
			for (const buf of this.buffer) {
				str += this.decoder.decode(buf, { stream: true });
			}
			str += this.decoder.decode(chunk.subarray(offset, index));
			this.processLine(str);

			this.buffer.length = 0;
			offset = index + (chunk[index] === Chr.CR && chunk[index + 1] === Chr.LF ? 2 : 1);
		}


		if (offset < chunk.length) {
			this.buffer.push(chunk.subarray(offset));
		} else {
			this.endedOnCR = chunk[chunk.length - 1] === Chr.CR;
		}
	}
	private processLine(line: string): void {
		if (!line.length) {
			this.dispatchEvent();
			return;
		}

		if (line.startsWith(':')) {
			return;
		}

		let field: string;
		let value: string;

		const colonIndex = line.indexOf(':');
		if (colonIndex === -1) {
			field = line;
			value = '';
		} else {
			field = line.substring(0, colonIndex);
			value = line.substring(colonIndex + 1);

			if (value.startsWith(' ')) {
				value = value.substring(1);
			}
		}

		this.processField(field, value);
	}
	private processField(field: string, value: string): void {
		switch (field) {
			case 'event':
				this.eventTypeBuffer = value;
				break;

			case 'data':
				this.dataBuffer += value;
				this.dataBuffer += '\n';
				break;

			case 'id':
				if (!value.includes('\0')) {
					this.currentEventId = this.lastEventIdBuffer = value;
				} else {
					this.currentEventId = undefined;
				}
				break;

			case 'retry':
				if (/^\d+$/.test(value)) {
					this.reconnectionTime = parseInt(value, 10);
				}
				break;

		}
	}
	private dispatchEvent(): void {
		if (this.dataBuffer === '') {
			this.dataBuffer = '';
			this.eventTypeBuffer = '';
			return;
		}

		if (this.dataBuffer.endsWith('\n')) {
			this.dataBuffer = this.dataBuffer.substring(0, this.dataBuffer.length - 1);
		}

		const event: ISSEEvent = {
			type: this.eventTypeBuffer || 'message',
			data: this.dataBuffer,
		};

		if (this.currentEventId !== undefined) {
			event.id = this.currentEventId;
		}

		if (this.reconnectionTime !== undefined) {
			event.retry = this.reconnectionTime;
		}

		this.onEventHandler(event);

		this.reset();
	}

	public reset(): void {
		this.dataBuffer = '';
		this.eventTypeBuffer = '';
		this.currentEventId = undefined;
	}
}


