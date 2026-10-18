/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MetadataMap, Raw, RenderPromptResult } from '@vscode/prompt-tsx';
import type * as vscode from 'vscode';
import { IResponsePart } from '../../../platform/chat/common/chatMLFetcher';
import { ChatLocation, ChatResponse } from '../../../platform/chat/common/commonTypes';
import { PositionOffsetTransformer } from '../../../platform/editing/common/positionOffsetTransformer';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { AsyncIterableObject, AsyncIterableSource } from '../../../util/dardcor/base/common/async';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { TextEdit } from '../../../dardcorTypes';
import { ISessionTurnStorage, OutcomeAnnotation } from '../../inlineChat/node/promptCraftingTypes';
import { IContributedLinkifierFactory } from '../../linkify/common/linkifyService';
import { StreamPipe, forEachStreamed } from '../../prompts/node/inline/utils/streaming';
import { ContributedToolName } from '../../tools/common/toolNames';
import { ChatVariablesCollection } from '../common/chatVariablesCollection';
import { Conversation, PromptMetadata, Turn } from '../common/conversation';
import { IBuildPromptContext } from '../common/intents';
import { ChatTelemetryBuilder } from './chatParticipantTelemetry';
import { IDocumentContext } from './documentContext';
import { AsyncReader, ClassifiedTextPiece, IStreamingEditsStrategy, IStreamingTextPieceClassifier, StreamingEditsResult, TextPieceKind, streamLines } from './streamingEdits';

export interface IIntentSlashCommandInfo {

	readonly hiddenFromUser?: boolean;
	readonly allowsEmptyArgs?: boolean;
	readonly defaultEnablement?: boolean;

	readonly toolEquivalent?: ContributedToolName;
}

export interface IIntentInvocationContext {

	readonly location: ChatLocation;

	readonly documentContext?: IDocumentContext;

	readonly request: vscode.ChatRequest;

	readonly slashCommand?: vscode.ChatCommand;
}

export interface IIntent {

	readonly id: string;


	readonly description: string;

	readonly locations: ChatLocation[];

	readonly commandInfo?: IIntentSlashCommandInfo;

	readonly isListedCapability?: boolean;

	invoke(invocationContext: IIntentInvocationContext): Promise<IIntentInvocation>;

	handleRequest?(
		conversation: Conversation,
		request: vscode.ChatRequest,
		stream: vscode.ChatResponseStream,
		token: CancellationToken,
		documentContext: IDocumentContext | undefined,
		agentName: string,
		location: ChatLocation,
		chatTelemetry: ChatTelemetryBuilder,
		yieldRequested: () => boolean,
	): Promise<vscode.ChatResult>;
}


export class IntentError extends Error {
	public readonly errorDetails: vscode.ChatErrorDetails;

	constructor(
		error: string | vscode.ChatErrorDetails,
	) {
		super(typeof error === 'string' ? error : error.message);
		this.errorDetails = typeof error === 'string' ? { message: error } : error;
	}
}

export interface IntentLinkificationOptions {
	readonly disable?: boolean;
	readonly additionaLinkifiers?: readonly IContributedLinkifierFactory[];
}


export const nullRenderPromptResult = (): RenderPromptResult => ({
	hasIgnoredFiles: false,
	messages: [],
	omittedReferences: [],
	references: [],
	tokenCount: 0,
	metadata: promptResultMetadata([]),
});

export const promptResultMetadata = (metadata: PromptMetadata[]): MetadataMap => ({
	get<T extends PromptMetadata>(key: new (...args: any[]) => T): T | undefined {
		return metadata.find(m => m instanceof key) as T | undefined;
	},
	getAll<T extends PromptMetadata>(key: new (...args: any[]) => T): T[] {
		return metadata.filter(m => m instanceof key) as T[];
	}
});

export class TelemetryData extends PromptMetadata {

	override toString(): string {
		return `[TelemetryData](${super.toString()})`;
	}
}

export interface IBuildPromptResult extends RenderPromptResult {

	telemetryData?: readonly TelemetryData[];
}


export interface IIntentInvocation extends Partial<IResponseProcessor> {

	readonly intent: IIntent;

	readonly location: ChatLocation;

	readonly endpoint: IChatEndpoint;

	getAvailableTools?(): vscode.LanguageModelToolInformation[] | Promise<vscode.LanguageModelToolInformation[]> | undefined;

	buildPrompt(
		context: IBuildPromptContext,
		progress: vscode.Progress<vscode.ChatResponseReferencePart | vscode.ChatResponseProgressPart>,
		token: vscode.CancellationToken
	): Promise<IBuildPromptResult>;

	confirmationHandler?(acceptedConfirmationData: any[] | undefined, rejectedConfirmationData: any[] | undefined, progress: vscode.ChatResponseStream): Promise<void>;

	readonly linkification?: IntentLinkificationOptions;

	readonly codeblocksRepresentEdits?: boolean;

	modifyErrorDetails?(errorDetails: vscode.ChatErrorDetails, response: ChatResponse): vscode.ChatErrorDetails;

	getAdditionalVariables?(context: IBuildPromptContext): ChatVariablesCollection | undefined;
}

export class NullIntentInvocation implements IIntentInvocation {

	constructor(
		readonly intent: IIntent,
		readonly location: ChatLocation,
		readonly endpoint: IChatEndpoint
	) { }

	async buildPrompt(): Promise<RenderPromptResult> {
		return nullRenderPromptResult();
	}
}

export interface IResponseProcessorContext {
	readonly chatSessionId: string;

	readonly turn: Turn;

	readonly messages: readonly Raw.ChatMessage[];

	addAnnotations(annotations: OutcomeAnnotation[]): void;

	storeInInlineSession(store: ISessionTurnStorage): void;
}

export interface IResponseProcessor {
	processResponse(context: IResponseProcessorContext, inputStream: AsyncIterable<IResponsePart>, outputStream: vscode.ChatResponseStream, token: CancellationToken): Promise<vscode.ChatResult | void>;
}

export class ReplyInterpreterMetaData extends PromptMetadata {
	constructor(public readonly replyInterpreter: ReplyInterpreter) {
		super();
	}
}

export interface ReplyInterpreter {
	processResponse(context: IResponseProcessorContext, inputStream: AsyncIterable<IResponsePart>, outputStream: vscode.ChatResponseStream, token: CancellationToken): Promise<void>;
}

export class StreamingMarkdownReplyInterpreter implements ReplyInterpreter {
	async processResponse(context: IResponseProcessorContext, inputStream: AsyncIterable<IResponsePart>, outputStream: vscode.ChatResponseStream, token: CancellationToken): Promise<void> {
		for await (const part of inputStream) {
			outputStream.markdown(part.delta.text);
		}
	}
}

export class NoopReplyInterpreter implements ReplyInterpreter {
	async processResponse(): Promise<void> {
		return undefined;
	}
}

export function applyEdits(text: string, edits: TextEdit[]): string {
	const transformer = new PositionOffsetTransformer(text);
	const offsetEdits = edits.map(e => {
		const offsetRange = transformer.toOffsetRange(e.range);
		return ({
			startOffset: offsetRange.start,
			endOffset: offsetRange.endExclusive,
			text: e.newText
		});
	});

	offsetEdits.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);

	for (let i = offsetEdits.length - 1; i >= 0; i--) {
		const edit = offsetEdits[i];
		text = text.substring(0, edit.startOffset) + edit.text + text.substring(edit.endOffset);
	}

	return text;
}

export type LeadingMarkdownStreaming = StreamPipe<string>;
export const LeadingMarkdownStreaming = {
	Mute: StreamPipe.discard<string>(),
	Emit: StreamPipe.identity<string>(),
};

export const enum EarlyStopping {
	None,
	StopAfterFirstCodeBlock,
}

export class StreamingEditsController {

	private readonly _responseStream = new AsyncIterableSource<string>();
	private _lastLength: number = 0;
	private _leftFirstCodeBlock = false;
	private _streamingPromise: Promise<StreamingEditsResult>;

	constructor(
		private readonly _outputStream: vscode.ChatResponseStream,
		private readonly _leadingMarkdownStreamPipe: StreamPipe<string>,
		private readonly _earlyStopping: EarlyStopping,
		textPieceClassifier: IStreamingTextPieceClassifier,
		streamingEditsStrategy: IStreamingEditsStrategy,
	) {
		const textPieceStream = textPieceClassifier(this._responseStream.asyncIterable);
		this._streamingPromise = this._process(textPieceStream, streamingEditsStrategy);
	}

	private async _process(textPieceStream: AsyncIterableObject<ClassifiedTextPiece>, streamingEditsStrategy: IStreamingEditsStrategy): Promise<StreamingEditsResult> {
		const leadingMarkdown = new AsyncIterableSource<string>();

		const processedMarkdown = this._leadingMarkdownStreamPipe(leadingMarkdown.asyncIterable);
		forEachStreamed(processedMarkdown, item => this._outputStream.markdown(item));

		const firstCodeBlockText = new AsyncIterableSource<string>();
		const firstCodeBlockLines = streamLines(firstCodeBlockText.asyncIterable);
		const streamingEditsPromise = streamingEditsStrategy.processStream(firstCodeBlockLines);

		const textPieceStreamWithoutDelimiters = textPieceStream.filter(piece => piece.kind !== TextPieceKind.Delimiter);
		const reader = new AsyncReader(textPieceStreamWithoutDelimiters[Symbol.asyncIterator]());

		await reader.readWhile(
			piece => piece.kind === TextPieceKind.OutsideCodeBlock,
			piece => leadingMarkdown.emitOne(piece.value)
		);
		leadingMarkdown.resolve();

		await reader.readWhile(
			piece => piece.kind === TextPieceKind.InsideCodeBlock,
			piece => firstCodeBlockText.emitOne(piece.value)
		);

		this._leftFirstCodeBlock = true;

		await reader.consumeToEnd();

		firstCodeBlockText.resolve();

		return streamingEditsPromise;
	}

	public update(newText: string): { shouldFinish: boolean } {
		if (this._earlyStopping === EarlyStopping.StopAfterFirstCodeBlock && this._leftFirstCodeBlock) {
			return { shouldFinish: true };
		}

		const chunk = newText.slice(this._lastLength);
		this._lastLength = newText.length;
		this._responseStream.emitOne(chunk);
		return { shouldFinish: false };
	}

	public async finish(): Promise<StreamingEditsResult> {
		this._responseStream.resolve();
		return await this._streamingPromise;
	}
}
