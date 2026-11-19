/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ILifecycleService = createDecorator<ILifecycleService>('lifecycleService');

export interface BeforeShutdownEvent {

	readonly reason: ShutdownReason;

	veto(value: boolean | Promise<boolean>, id: string): void;
}

export interface InternalBeforeShutdownEvent extends BeforeShutdownEvent {

	finalVeto(vetoFn: () => boolean | Promise<boolean>, id: string): void;
}

export interface BeforeShutdownErrorEvent {

	readonly reason: ShutdownReason;

	readonly error: Error;
}

export enum WillShutdownJoinerOrder {

	Default = 1,

	Last
}

export interface IWillShutdownEventJoiner {
	readonly id: string;
	readonly label: string;
	readonly order?: WillShutdownJoinerOrder;
}

export interface IWillShutdownEventDefaultJoiner extends IWillShutdownEventJoiner {
	readonly order?: WillShutdownJoinerOrder.Default;
}

export interface IWillShutdownEventLastJoiner extends IWillShutdownEventJoiner {
	readonly order: WillShutdownJoinerOrder.Last;
}

export interface WillShutdownEvent {

	readonly reason: ShutdownReason;

	readonly token: CancellationToken;

	join(promise: Promise<void>, joiner: IWillShutdownEventDefaultJoiner): void;

	join(promiseFn: (() => Promise<void>), joiner: IWillShutdownEventLastJoiner): void;

	joiners(): IWillShutdownEventJoiner[];

	force(): void;
}

export const enum ShutdownReason {

	CLOSE = 1,

	QUIT,

	RELOAD,

	LOAD
}

export const enum StartupKind {
	NewWindow = 1,
	ReloadedWindow = 3,
	ReopenedWindow = 4
}

export function StartupKindToString(startupKind: StartupKind): string {
	switch (startupKind) {
		case StartupKind.NewWindow: return 'NewWindow';
		case StartupKind.ReloadedWindow: return 'ReloadedWindow';
		case StartupKind.ReopenedWindow: return 'ReopenedWindow';
	}
}

export const enum LifecyclePhase {

	Starting = 1,

	Ready = 2,

	Restored = 3,

	Eventually = 4
}

export function LifecyclePhaseToString(phase: LifecyclePhase): string {
	switch (phase) {
		case LifecyclePhase.Starting: return 'Starting';
		case LifecyclePhase.Ready: return 'Ready';
		case LifecyclePhase.Restored: return 'Restored';
		case LifecyclePhase.Eventually: return 'Eventually';
	}
}

export interface ILifecycleService {

	readonly _serviceBrand: undefined;

	readonly startupKind: StartupKind;

	phase: LifecyclePhase;

	readonly onBeforeShutdown: Event<BeforeShutdownEvent>;

	readonly onShutdownVeto: Event<void>;

	readonly onBeforeShutdownError: Event<BeforeShutdownErrorEvent>;

	readonly onWillShutdown: Event<WillShutdownEvent>;

	readonly willShutdown: boolean;

	readonly onDidShutdown: Event<void>;

	when(phase: LifecyclePhase): Promise<void>;

	shutdown(): Promise<void>;
}
