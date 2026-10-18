/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Content, FunctionCall, FunctionResponse, Part } from '@google/genai';
import { Raw } from '@vscode/prompt-tsx';
import type { LanguageModelChatMessage } from 'vscode';
import { CustomDataPartMimeTypes } from '../../../platform/endpoint/common/endpointTypes';
import { LanguageModelChatMessageRole, LanguageModelDataPart, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, LanguageModelToolResultPart, LanguageModelToolResultPart2 } from '../../../dardcorTypes';

function apiContentToGeminiContent(content: (LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart | LanguageModelDataPart | LanguageModelThinkingPart)[]): Part[] {
	const convertedContent: Part[] = [];
	let pendingSignature: string | undefined;

	for (const part of content) {
		if (part instanceof LanguageModelThinkingPart) {
			if (part.metadata && typeof part.metadata === 'object' && 'signature' in part.metadata) {
				const metadataObj = part.metadata as Record<string, unknown>;
				if (typeof metadataObj.signature === 'string') {
					pendingSignature = metadataObj.signature;
				}
			}
		} else if (part instanceof LanguageModelToolCallPart) {
			const functionCallPart: Part = {
				functionCall: {
					name: part.name,
					args: part.input as Record<string, unknown> || {}
				},
				...(pendingSignature ? { thoughtSignature: pendingSignature } : {})
			};

			if (pendingSignature) {
				pendingSignature = undefined;
			}

			convertedContent.push(functionCallPart);
		} else if (part instanceof LanguageModelDataPart) {
			if (part.mimeType !== CustomDataPartMimeTypes.StatefulMarker && part.mimeType !== CustomDataPartMimeTypes.CacheControl) {
				convertedContent.push({
					inlineData: {
						data: Buffer.from(part.data).toString('base64'),
						mimeType: part.mimeType
					}
				});
			}
		} else if (part instanceof LanguageModelToolResultPart || part instanceof LanguageModelToolResultPart2) {
			const textContent = part.content
				.filter((p): p is LanguageModelTextPart => p instanceof LanguageModelTextPart)
				.map(p => p.value)
				.join('');

			const imageParts = part.content.filter((p): p is LanguageModelDataPart =>
				p instanceof LanguageModelDataPart &&
				p.mimeType !== CustomDataPartMimeTypes.StatefulMarker &&
				p.mimeType !== CustomDataPartMimeTypes.CacheControl
			);

			let imageDescription = '';
			if (imageParts.length > 0) {
				imageDescription = `\n[Contains ${imageParts.length} image(s) with types: ${imageParts.map(p => p.mimeType).join(', ')}]`;
			}

			const functionName = part.callId?.split('_')[0] || 'unknown_function';

			let responsePayload: any = {};
			if (textContent) {
				try {
					responsePayload = JSON.parse(textContent);
					if (typeof responsePayload !== 'object' || responsePayload === null || Array.isArray(responsePayload)) {
						responsePayload = { result: responsePayload };
					}
				} catch {
					responsePayload = { result: textContent + imageDescription };
				}
				if (imageParts.length > 0) {
					responsePayload.images = imageParts.map(p => ({
						mimeType: p.mimeType,
						size: p.data.length,
						data: Buffer.from(p.data).toString('base64')
					}));
				}
			} else if (imageParts.length > 0) {
				responsePayload = {
					images: imageParts.map(p => ({
						mimeType: p.mimeType,
						size: p.data.length,
						data: Buffer.from(p.data).toString('base64')
					}))
				};
			}

			const functionResponse: FunctionResponse = {
				name: functionName,
				response: responsePayload
			};

			convertedContent.push({ functionResponse });
		} else if (part instanceof LanguageModelTextPart) {
			if (part.value !== '') {
				convertedContent.push({
					text: part.value
				});
			}
		}
	}
	return convertedContent;
}

export function apiMessageToGeminiMessage(messages: LanguageModelChatMessage[]): { contents: Content[]; systemInstruction?: Content } {
	const contents: Content[] = [];
	let systemInstruction: Content | undefined;

	const pendingToolCalls = new Map<string, FunctionCall>();

	for (const message of messages) {
		if (message.role === LanguageModelChatMessageRole.System) {
			const systemText = message.content
				.filter((p): p is LanguageModelTextPart => p instanceof LanguageModelTextPart)
				.map(p => p.value)
				.join('');

			if (systemText.trim()) {
				systemInstruction = {
					role: 'user',
					parts: [{ text: systemText }]
				};
			}
		} else if (message.role === LanguageModelChatMessageRole.Assistant) {
			const parts = apiContentToGeminiContent(message.content);

			parts.forEach(part => {
				if (part.functionCall && part.functionCall.name) {
					pendingToolCalls.set(part.functionCall.name, part.functionCall);
				}
			});

			contents.push({
				role: 'model',
				parts
			});
		} else if (message.role === LanguageModelChatMessageRole.User) {
			const parts = apiContentToGeminiContent(message.content);

			contents.push({
				role: 'user',
				parts
			});
		}
	}

	for (let i = 0; i < contents.length; i++) {
		const c = contents[i];
		if (c.role === 'model' && c.parts && c.parts.some(p => 'functionResponse' in p)) {
			const modelParts: Part[] = [];
			const toolResultParts: Part[] = [];
			for (const p of c.parts) {
				if ('functionResponse' in p) {
					toolResultParts.push(p);
				} else {
					modelParts.push(p);
				}
			}
			c.parts = modelParts;
			if (toolResultParts.length) {
				contents.splice(i + 1, 0, { role: 'user', parts: toolResultParts });
				i++;
			}
		}
	}
	for (let i = contents.length - 1; i >= 0; i--) {
		const c = contents[i];
		if (c.role === 'model' && (!c.parts || c.parts.length === 0)) {
			contents.splice(i, 1);
		}
	}

	return { contents, systemInstruction };
}

export function geminiMessagesToRawMessagesForLogging(contents: Content[], systemInstruction?: Content): Raw.ChatMessage[] {
	const fullMessages = geminiMessagesToRawMessages(contents, systemInstruction);

	return fullMessages.map(message => {
		const content = message.content.map(part => {
			if (part.type === Raw.ChatCompletionContentPartKind.Image) {
				return {
					...part,
					imageUrl: { url: '(image)' }
				};
			}
			return part;
		});

		if (message.role === Raw.ChatRole.Tool) {
			return {
				...message,
				content: [{ type: Raw.ChatCompletionContentPartKind.Text, text: '(tool result)' }]
			};
		}

		return {
			...message,
			content
		};
	});
}

export function geminiMessagesToRawMessages(contents: Content[], systemInstruction?: Content): Raw.ChatMessage[] {
	const rawMessages: Raw.ChatMessage[] = [];

	if (systemInstruction && systemInstruction.parts) {
		const systemContent: Raw.ChatCompletionContentPart[] = [];
		systemInstruction.parts.forEach((part: Part) => {
			if (part.text) {
				systemContent.push({ type: Raw.ChatCompletionContentPartKind.Text, text: part.text });
			}
		});
		if (systemContent.length) {
			rawMessages.push({ role: Raw.ChatRole.System, content: systemContent });
		}
	}

	for (const content of contents) {
		const messageParts: Raw.ChatCompletionContentPart[] = [];
		let toolCalls: Raw.ChatMessageToolCall[] | undefined;

		if (content.parts) {
			content.parts.forEach((part: Part) => {
				if (part.text) {
					messageParts.push({ type: Raw.ChatCompletionContentPartKind.Text, text: part.text });
				} else if (part.inlineData) {
					messageParts.push({
						type: Raw.ChatCompletionContentPartKind.Image,
						imageUrl: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
					});
				} else if (part.functionCall && part.functionCall.name) {
					toolCalls ??= [];
					toolCalls.push({
						id: part.functionCall.name,
						type: 'function',
						function: {
							name: part.functionCall.name,
							arguments: JSON.stringify(part.functionCall.args ?? {})
						}
					});
				} else if (part.functionResponse && part.functionResponse.name) {
					const toolContent: Raw.ChatCompletionContentPart[] = [];

					const response = part.functionResponse.response;
					if (response && typeof response === 'object' && 'images' in response && Array.isArray(response.images)) {
						for (const img of response.images) {
							if (img && typeof img === 'object' && 'data' in img && 'mimeType' in img) {
								toolContent.push({
									type: Raw.ChatCompletionContentPartKind.Image,
									imageUrl: { url: `data:${img.mimeType};base64,${img.data}` }
								});
							}
						}

						const cleanResponse = { ...response };
						if ('images' in cleanResponse) {
							cleanResponse.images = response.images.map((img: any) => ({
								mimeType: img.mimeType,
								size: img.size || (img.data ? img.data.length : 0)
							}));
						}
						toolContent.push({ type: Raw.ChatCompletionContentPartKind.Text, text: JSON.stringify(cleanResponse) });
					} else {
						toolContent.push({ type: Raw.ChatCompletionContentPartKind.Text, text: JSON.stringify(response) });
					}

					rawMessages.push({
						role: Raw.ChatRole.Tool,
						content: toolContent,
						toolCallId: part.functionResponse.name
					});
				}
			});
		}

		if (messageParts.length > 0 || toolCalls) {
			const role = content.role === 'model' ? Raw.ChatRole.Assistant : Raw.ChatRole.User;
			const msg: Raw.ChatMessage = { role, content: messageParts };

			if (toolCalls && content.role === 'model') {
				(msg as Raw.AssistantChatMessage).toolCalls = toolCalls;
			}

			rawMessages.push(msg);
		}
	}

	return rawMessages;
}
