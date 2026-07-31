/**
 * Dardcor Code - dc.chat API Bridge (Task 625)
 * Mirrors: vs/workbench/api/common/extHostChat.ts
 */

import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol.js';
import { URI } from '../../core/types/uri.js';
import { MarkdownString } from './ext-host-api-impl.js';
import { CancellationToken } from '../../core/async/cancellation.js';

export interface ChatRequestReference {
	readonly id?: string;
	readonly uri?: URI;
	readonly variableName?: string;
	readonly value?: { kind: 'reference'; uri: URI };
}

export interface ChatRequest {
	readonly prompt: string;
	readonly references: readonly ChatRequestReference[];
	readonly tools?: readonly unknown[];
}

export interface IChatAgentRequest {
	readonly prompt: string;
	readonly references?: readonly ChatRequestReference[];
}

export interface IChatResponseStreamPart {
	kind: 'markdown' | 'reference' | 'progress' | 'toolCall';
	value: string | MarkdownString | { uri: URI } | number;
}

export class ChatResponseStream {
	private readonly _parts: IChatResponseStreamPart[] = [];
	private _closed = false;

	public markdown(value: string | MarkdownString): void {
		this._push({ kind: 'markdown', value });
	}

	public reference(reference: ChatRequestReference | { uri: URI }): void {
		this._push({ kind: 'reference', value: reference.uri ? { uri: reference.uri } : { uri: undefined as any } });
	}

	public progress(value: number): void {
		this._push({ kind: 'progress', value });
	}

	public get parts(): readonly IChatResponseStreamPart[] {
		return this._parts.slice();
	}

	public close(): void {
		this._closed = true;
	}

	public get isClosed(): boolean {
		return this._closed;
	}

	private _push(part: IChatResponseStreamPart): void {
		if (!this._closed) {
			this._parts.push(part);
		}
	}
}

export interface IChatAgentMetadata {
	readonly description: string;
	readonly fullName?: string;
	readonly iconPath?: URI | { light: URI; dark: URI };
	readonly isDefault?: boolean;
	readonly isSecondary?: boolean;
	readonly userPrompt?: string;
	readonly disallowToolUse?: boolean;
}

export interface IChatAgentHandler {
	(request: ChatRequest, context: { history?: unknown[] }, stream: ChatResponseStream, token?: CancellationToken): void | Promise<void>;
}

export interface IChatApi {
	registerChatAgent(id: string, metadata: IChatAgentMetadata, handler: IChatAgentHandler): IDisposable;
	sendChatResponse(responseId: string, content: string | MarkdownString): Promise<void>;
	readonly onDidReceiveMessage: Event<{ agentId: string; message: any }>;
}

/**
 * Chat bridge. Chat agents run here; the main side forwards user
 * prompts to the agent handler and renders the streamed response.
 */
export class ExtHostChat extends Disposable {
	private _nextAgentHandle = 1;
	private readonly _agents = new Map<number, { id: string; metadata: IChatAgentMetadata; handler: IChatAgentHandler }>();
	private _nextResponseId = 1;

	private readonly _onDidReceiveMessage = this._register(new Emitter<{ agentId: string; message: any }>());
	readonly onDidReceiveMessage: Event<{ agentId: string; message: any }> = this._onDidReceiveMessage.event;

	constructor(private readonly _rpc: RPCProtocol) {
		super();
	}

	public registerChatAgent(id: string, metadata: IChatAgentMetadata, handler: IChatAgentHandler): IDisposable {
		if (this._findByAgentId(id)) {
			throw new Error(`Chat agent '${id}' sudah terdaftar`);
		}
		const handle = this._nextAgentHandle++;
		this._agents.set(handle, { id, metadata, handler });
		this._rpc.notify('main', 'chat.registerAgent', {
			handle,
			id,
			description: metadata.description,
			fullName: metadata.fullName,
			isDefault: metadata.isDefault,
			isSecondary: metadata.isSecondary
		});
		return toDisposable(() => {
			if (this._agents.delete(handle)) {
				this._rpc.notify('main', 'chat.unregisterAgent', { handle });
			}
		});
	}

	public async sendChatResponse(responseId: string, content: string | MarkdownString): Promise<void> {
		const value = content instanceof MarkdownString ? content.value : content;
		await this._rpc.call('main', 'chat.sendResponse', { responseId, content: value });
	}

	public get api(): IChatApi {
		return {
			registerChatAgent: (id: string, metadata: IChatAgentMetadata, handler: IChatAgentHandler) => this.registerChatAgent(id, metadata, handler),
			sendChatResponse: (responseId: string, content: string | MarkdownString) => this.sendChatResponse(responseId, content),
			onDidReceiveMessage: this.onDidReceiveMessage
		};
	}

	public get channelHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				switch (command) {
					case '$invoke': {
						const registration = this._agents.get(payload.handle);
						if (!registration) {
							throw new Error(`Chat agent tidak dikenal: ${payload.handle}`);
						}
						const stream = new ChatResponseStream();
						const request: ChatRequest = {
							prompt: payload.prompt,
							references: (payload.references ?? []).map((ref: any) => ({
								id: ref.id,
								uri: ref.uri ? URI.parse(ref.uri) : undefined,
								variableName: ref.variableName,
								value: ref.uri ? { kind: 'reference', uri: URI.parse(ref.uri) } : undefined
							}))
						};
						const responseId = `${registration.id}#${this._nextResponseId++}`;
						return Promise.resolve(registration.handler(request, { history: payload.history ?? [] }, stream, CancellationToken.None)).then(() => ({
							responseId,
							parts: stream.parts.map(part => this._serializePart(part))
						}));
					}
					case '$onMessage': {
						this._onDidReceiveMessage.fire({ agentId: payload.agentId, message: payload.message });
						return undefined;
					}
					default:
						throw new Error(`Perintah chat tidak dikenal: ${command}`);
				}
			}
		};
	}

	private _serializePart(part: IChatResponseStreamPart): any {
		if (part.kind === 'markdown') {
			const value = part.value;
			return { kind: 'markdown', value: value instanceof MarkdownString ? { value: value.value, isTrusted: value.isTrusted } : { value: String(value), isTrusted: false } };
		}
		if (part.kind === 'reference') {
			const ref = part.value as { uri: URI };
			return { kind: 'reference', uri: ref.uri.toString() };
		}
		return { kind: part.kind, value: part.value };
	}

	private _findByAgentId(id: string): { id: string } | undefined {
		for (const agent of this._agents.values()) {
			if (agent.id === id) {
				return agent;
			}
		}
		return undefined;
	}
}
