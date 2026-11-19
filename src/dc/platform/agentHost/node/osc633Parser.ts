/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export const enum Osc633EventType {
	PromptStart,
	CommandStart,
	CommandExecuted,
	CommandFinished,
	CommandLine,
	Property,
}

export interface IOsc633PromptStartEvent {
	type: Osc633EventType.PromptStart;
}

export interface IOsc633CommandStartEvent {
	type: Osc633EventType.CommandStart;
}

export interface IOsc633CommandExecutedEvent {
	type: Osc633EventType.CommandExecuted;
}

export interface IOsc633CommandFinishedEvent {
	type: Osc633EventType.CommandFinished;
	exitCode: number | undefined;
}

export interface IOsc633CommandLineEvent {
	type: Osc633EventType.CommandLine;
	commandLine: string;
	nonce: string | undefined;
}

export interface IOsc633PropertyEvent {
	type: Osc633EventType.Property;
	key: string;
	value: string;
}

export type Osc633Event =
	| IOsc633PromptStartEvent
	| IOsc633CommandStartEvent
	| IOsc633CommandExecutedEvent
	| IOsc633CommandFinishedEvent
	| IOsc633CommandLineEvent
	| IOsc633PropertyEvent;

export interface IOsc633ParseResult {
	cleanedData: string;
	events: Osc633Event[];
}

export type Osc633ParseSegment =
	| { readonly kind: 'data'; readonly data: string }
	| { readonly kind: 'event'; readonly event: Osc633Event };

function deserializeOscMessage(message: string): string {
	if (message.indexOf('\\') === -1) {
		return message;
	}
	return message.replaceAll(
		/\\(\\|x([0-9a-f]{2}))/gi,
		(_match: string, op: string, hex?: string) => hex ? String.fromCharCode(parseInt(hex, 16)) : op,
	);
}

function parseOsc633Payload(payload: string): Osc633Event | undefined {
	const semiIdx = payload.indexOf(';');
	if ((semiIdx === -1 ? payload.length : semiIdx) !== 1) {
		return undefined;
	}

	const command = payload[0];
	const argsRaw = semiIdx === -1 ? '' : payload.substring(semiIdx + 1);

	switch (command) {
		case 'A':
			return { type: Osc633EventType.PromptStart };
		case 'B':
			return { type: Osc633EventType.CommandStart };
		case 'C':
			return { type: Osc633EventType.CommandExecuted };
		case 'D': {
			const exitCode = argsRaw.length > 0 ? parseInt(argsRaw, 10) : undefined;
			return {
				type: Osc633EventType.CommandFinished,
				exitCode: exitCode !== undefined && !isNaN(exitCode) ? exitCode : undefined,
			};
		}
		case 'E': {
			const nonceIdx = argsRaw.indexOf(';');
			const commandLine = deserializeOscMessage(nonceIdx === -1 ? argsRaw : argsRaw.substring(0, nonceIdx));
			const nonce = nonceIdx === -1 ? undefined : argsRaw.substring(nonceIdx + 1);
			return { type: Osc633EventType.CommandLine, commandLine, nonce };
		}
		case 'P': {
			const deserialized = deserializeOscMessage(argsRaw);
			const eqIdx = deserialized.indexOf('=');
			if (eqIdx === -1) {
				return undefined;
			}
			return {
				type: Osc633EventType.Property,
				key: deserialized.substring(0, eqIdx),
				value: deserialized.substring(eqIdx + 1),
			};
		}
		default:
			return undefined;
	}
}

const ESC = '\x1b';
const OSC_START = ESC + ']';
const BEL = '\x07';
const ST = ESC + '\\';

export class Osc633Parser {
	private _pendingOsc = '';
	private _inOsc = false;
	private _pendingEscInOsc = false;

	parse(data: string): IOsc633ParseResult {
		const events: Osc633Event[] = [];
		let cleanedData = '';
		for (const segment of this.parseSegments(data)) {
			if (segment.kind === 'data') {
				cleanedData += segment.data;
			} else {
				events.push(segment.event);
			}
		}
		return { cleanedData, events };
	}

	parseSegments(data: string): Osc633ParseSegment[] {
		const segments: Osc633ParseSegment[] = [];
		let pending = '';

		const appendData = (value: string): void => {
			pending += value;
		};
		const flushData = (): void => {
			if (pending.length > 0) {
				segments.push({ kind: 'data', data: pending });
				pending = '';
			}
		};
		const emitEvent = (event: Osc633Event): void => {
			flushData();
			segments.push({ kind: 'event', event });
		};

		if (!this._inOsc && data.indexOf(OSC_START) === -1) {
			appendData(data);
			flushData();
			return segments;
		}

		let i = 0;

		while (i < data.length) {
			if (this._inOsc) {
				if (this._pendingEscInOsc) {
					this._pendingEscInOsc = false;
					if (data[i] === '\\') {
						i++;
						this._inOsc = false;
						const payload = this._pendingOsc;
						this._pendingOsc = '';
						this._handleOscPayload(payload, emitEvent, appendData, ST);
						continue;
					}
					this._inOsc = false;
					const payload = this._pendingOsc;
					this._pendingOsc = '';
					this._handleOscPayload(payload, emitEvent, appendData);
					continue;
				}

				const result = this._consumeOscBody(data, i);
				i = result.nextIndex;
				if (result.complete) {
					this._inOsc = false;
					const payload = this._pendingOsc;
					this._pendingOsc = '';
					this._handleOscPayload(payload, emitEvent, appendData, result.terminator);
				} else if (result.pendingEsc) {
					this._pendingEscInOsc = true;
				}
				continue;
			}

			const escIdx = data.indexOf(OSC_START, i);
			if (escIdx === -1) {
				appendData(data.substring(i));
				i = data.length;
				continue;
			}

			appendData(data.substring(i, escIdx));

			i = escIdx + 2;
			this._pendingOsc = '';
			this._inOsc = true;

			const result = this._consumeOscBody(data, i);
			i = result.nextIndex;
			if (result.complete) {
				this._inOsc = false;
				const payload = this._pendingOsc;
				this._pendingOsc = '';
				this._handleOscPayload(payload, emitEvent, appendData, result.terminator);
			} else if (result.pendingEsc) {
				this._pendingEscInOsc = true;
			}
		}

		flushData();
		return segments;
	}

	private _consumeOscBody(data: string, startIdx: number): { nextIndex: number; complete: boolean; pendingEsc?: boolean; terminator?: string } {
		const belIdx = data.indexOf(BEL, startIdx);
		const escIdx = data.indexOf(ESC, startIdx);

		if (belIdx !== -1 && (escIdx === -1 || belIdx < escIdx)) {
			this._pendingOsc += data.substring(startIdx, belIdx);
			return { nextIndex: belIdx + 1, complete: true, terminator: BEL };
		}

		if (escIdx !== -1) {
			if (escIdx + 1 >= data.length) {
				this._pendingOsc += data.substring(startIdx, escIdx);
				return { nextIndex: data.length, complete: false, pendingEsc: true };
			}

			this._pendingOsc += data.substring(startIdx, escIdx);
			if (data[escIdx + 1] === '\\') {
				return { nextIndex: escIdx + 2, complete: true, terminator: ST };
			}

			return { nextIndex: escIdx, complete: true };
		}

		this._pendingOsc += data.substring(startIdx);
		return { nextIndex: data.length, complete: false };
	}

	private _handleOscPayload(
		payload: string,
		emitEvent: (event: Osc633Event) => void,
		appendData: (data: string) => void,
		terminator = BEL,
	): void {
		if (payload.startsWith('633;')) {
			const oscContent = payload.substring(4);
			const event = parseOsc633Payload(oscContent);
			if (event) {
				emitEvent(event);
			}
		} else {
			appendData(OSC_START + payload + terminator);
		}
	}
}
