/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from '../../../base/common/lifecycle.js';
import type { ISettableObservable } from '../../../base/common/observable.js';
import type { StopWatch } from '../../../base/common/stopwatch.js';
import { createDecorator, type BrandedService } from '../../instantiation/common/instantiation.js';
import type { IAgent } from './agent.js';
import type { AgentHostLaunchKind, AgentHostTurnFailureStage, IAgentHostClientTelemetryContext } from './agentHostTelemetry.js';
import type { StateAction } from './state/sessionActions.js';
import type { ErrorInfo, Message, Turn, URI as ProtocolURI } from './state/sessionState.js';

export const IAgentHostChatContributions = createDecorator<IAgentHostChatContributions>('agentHostChatContributions');

export type TurnEndReason =
	| { readonly kind: 'success' }
	| { readonly kind: 'cancelled' }
	| { readonly kind: 'error'; readonly error: ErrorInfo; readonly resumable: boolean }
	| { readonly kind: 'rejected'; readonly error: ErrorInfo }
	| { readonly kind: 'localCommand' };

export interface ITurnEnd {
	readonly session: ProtocolURI;
	readonly channel: ProtocolURI;
	readonly turnId: string | undefined;
	readonly reason: TurnEndReason;
	readonly clientContext?: IAgentHostClientTelemetryContext;
}

export interface IOutgoingTurn {
	readonly session: ProtocolURI;
	readonly chat: ProtocolURI;
	readonly message: Message;
	readonly turnId: string;
}

export interface ISendContribution {
	readonly instructions?: readonly string[];
	readonly text?: string;
}

export interface IOutgoingTurnContributionResult {
	readonly instructions?: readonly string[];
	readonly message: Message;
}

export interface IIncomingRequest {
	readonly session: ProtocolURI;
	readonly chat: ProtocolURI;
	readonly turnChannel: ProtocolURI;
	readonly message: Message;
	readonly turnId: string;
	readonly source: 'direct' | 'queued';
	readonly clientId: string | undefined;
	readonly clientContext: IAgentHostClientTelemetryContext;
}

export type IncomingRequestDisposition =
	| { readonly kind: 'accept' }
	| { readonly kind: 'handled' }
	| {
		readonly kind: 'reject';
		readonly error: ErrorInfo;
		readonly stage: AgentHostTurnFailureStage;
	};

export interface IHydrationContext {
	readonly session: ProtocolURI;
	readonly chat: ProtocolURI;
	readonly workspaceTransitions?: ReadonlyMap<string, string>;
}

export interface IRestoredChat {
	readonly title?: string;
	readonly draft?: Message;
}

export interface IAppliedClientAction {
	readonly channel: ProtocolURI;
	readonly session: ProtocolURI;
	readonly action: StateAction;
	readonly clientId: string | undefined;
	readonly clientContext: IAgentHostClientTelemetryContext;
}

export interface IDispatchedAction {
	readonly channel: ProtocolURI;
	readonly session: ProtocolURI;
	readonly action: StateAction;
	readonly rejectionReason?: string;
}

export interface IQueuedMessageSender {
	readonly clientId: string | undefined;
	readonly clientContext: IAgentHostClientTelemetryContext;
}

export interface ISendTurnMessageOptions {
	readonly agent: IAgent;
	readonly sessionChannel: ProtocolURI;
	readonly turnChannel: ProtocolURI;
	readonly chat: ProtocolURI;
	readonly message: Message;
	readonly turnId: string;
	readonly senderClientId: string | undefined;
	readonly clientContext: IAgentHostClientTelemetryContext;
	readonly turnStopWatch: StopWatch;
}

export interface IAgentHostChatContributionHost {
	readonly hostLaunchKind: AgentHostLaunchKind;
	sendTurnMessage(options: ISendTurnMessageOptions): void;
}

type MementoKeySegment = string | boolean | number;
type MementoKeySegments = readonly MementoKeySegment[];

export interface IChatMementoKey<T, TExtra extends MementoKeySegments> {
	readonly scope: 'chat';
	readonly debugName: string;
	readonly create: () => T;
	readonly _extra?: TExtra;
}

export interface ISessionMementoKey<T, TExtra extends MementoKeySegments> {
	readonly scope: 'session';
	readonly debugName: string;
	readonly create: () => T;
	readonly _extra?: TExtra;
}

export function createChatMementoKey<T, TExtra extends MementoKeySegments = []>(debugName: string, create: () => T): IChatMementoKey<T, TExtra> {
	return { scope: 'chat', debugName, create };
}

export function createSessionMementoKey<T, TExtra extends MementoKeySegments = []>(debugName: string, create: () => T): ISessionMementoKey<T, TExtra> {
	return { scope: 'session', debugName, create };
}

export interface IAgentHostChatContributionContext {
	readonly contributionId: string;
	memento<T, TExtra extends MementoKeySegments>(key: IChatMementoKey<T, TExtra> | ISessionMementoKey<T, TExtra>, resource: ProtocolURI, ...extra: TExtra): ISettableObservable<T>;
	deleteMemento<T, TExtra extends MementoKeySegments>(key: IChatMementoKey<T, TExtra> | ISessionMementoKey<T, TExtra>, resource: ProtocolURI, ...extra: TExtra): void;
}

export interface IAgentHostChatContribution extends IDisposable {
	readonly order?: number;
	onTurnEnd?(turn: ITurnEnd): void;
	onDidApplyClientAction?(action: IAppliedClientAction): void;
	onDidDispatchAction?(dispatched: IDispatchedAction): void;
	onOutgoingTurn?(turn: IOutgoingTurn): ISendContribution | undefined | Promise<ISendContribution | undefined>;
	onIncomingRequest?(request: IIncomingRequest): IncomingRequestDisposition | undefined;
	onHydrateTurns?(context: IHydrationContext, turns: readonly Turn[]): readonly Turn[] | Promise<readonly Turn[]>;
	onHydrateChat?(context: IHydrationContext, restored: IRestoredChat): IRestoredChat | Promise<IRestoredChat>;
}

export type IAgentHostChatContributionSignature<Services extends BrandedService[]> = new (context: IAgentHostChatContributionContext, ...services: Services) => IAgentHostChatContribution;

export interface IAgentHostChatContributions extends IDisposable {
	readonly _serviceBrand: undefined;

	registerContribution<Services extends BrandedService[]>(contribution: IAgentHostChatContributionSignature<Services> & { readonly id: string }): IDisposable;
	registerHost(host: IAgentHostChatContributionHost): IDisposable;
	getHost(): IAgentHostChatContributionHost | undefined;
	turnEnd(turn: ITurnEnd): void;
	didApplyClientAction(action: IAppliedClientAction): void;
	didDispatchAction(dispatched: IDispatchedAction): void;
	outgoingTurn(turn: IOutgoingTurn): Promise<IOutgoingTurnContributionResult>;
	incomingRequest(request: IIncomingRequest): IncomingRequestDisposition;
	hydrateTurns(context: IHydrationContext, turns: readonly Turn[]): Promise<readonly Turn[]>;
	hydrateChat(context: IHydrationContext, restored: IRestoredChat): Promise<IRestoredChat>;
	disposeChatState(chat: ProtocolURI): void;
	disposeSessionState(session: ProtocolURI): void;
}
