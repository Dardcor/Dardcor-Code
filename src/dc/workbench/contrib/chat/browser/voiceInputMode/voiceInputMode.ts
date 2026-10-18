/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';
import { IObservable, ISettableObservable, autorun, observableFromEvent, observableValue, transaction } from '../../../../../base/common/observable.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { AgentsVoiceSettingId, AGENTS_VOICE_ENTITLED } from '../../../agentsVoice/common/agentsVoice.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { DictationSettingId, IChatSpeechToTextService } from '../speechToText/chatSpeechToTextService.js';

export type VoiceInputMode = 'dictation' | 'voice';

export type SimulatedVoiceState = 'off' | 'connecting' | 'idle' | 'listening' | 'speaking' | 'dictating';

export type VoiceWalkthroughVersion = 'handsFree' | 'keyboardHold' | 'buttonHold' | 'clickToggle';

export const CHAT_VOICE_INPUT_MODE = new RawContextKey<VoiceInputMode>('chatVoiceInputMode', 'voice', { type: 'string', description: localize('chatVoiceInputMode', "The currently selected voice input mode in the chat input (dictation or voice).") });

const STORAGE_KEY = 'chat.voiceInputMode.selected';

export const IVoiceInputModeService = createDecorator<IVoiceInputModeService>('voiceInputModeService');

export interface IVoiceInputModeService {
	readonly _serviceBrand: undefined;

	readonly selectedMode: IObservable<VoiceInputMode>;

	readonly voiceAvailable: IObservable<boolean>;

	readonly dictationAvailable: IObservable<boolean>;

	readonly handsFree: IObservable<boolean>;

	readonly simulatedVoiceState: IObservable<SimulatedVoiceState | undefined>;

	readonly simulatedHandsFree: IObservable<boolean | undefined>;

	readonly simulatedVersion: IObservable<VoiceWalkthroughVersion | undefined>;

	readonly simulatedHover: IObservable<boolean>;

	setSelectedMode(mode: VoiceInputMode): void;

	setSimulatedVoiceState(state: SimulatedVoiceState | undefined): void;

	startVoiceStateWalkthrough(version: VoiceWalkthroughVersion): void;

	stepVoiceStateWalkthrough(): void;

	clearSimulation(): void;
}

interface IVoiceWalkthrough {
	readonly handsFree: boolean;
	readonly steps: readonly { readonly state: SimulatedVoiceState | undefined; readonly hover?: boolean; readonly ms?: number }[];
}

export class VoiceInputModeService extends Disposable implements IVoiceInputModeService {

	declare readonly _serviceBrand: undefined;

	private readonly _selectedMode: ISettableObservable<VoiceInputMode>;
	readonly selectedMode: IObservable<VoiceInputMode>;

	readonly voiceAvailable: IObservable<boolean>;
	readonly dictationAvailable: IObservable<boolean>;
	readonly handsFree: IObservable<boolean>;

	private readonly _simulatedVoiceState = observableValue<SimulatedVoiceState | undefined>(this, undefined);
	readonly simulatedVoiceState: IObservable<SimulatedVoiceState | undefined> = this._simulatedVoiceState;

	private readonly _simulatedHandsFree = observableValue<boolean | undefined>(this, undefined);
	readonly simulatedHandsFree: IObservable<boolean | undefined> = this._simulatedHandsFree;

	private readonly _simulatedVersion = observableValue<VoiceWalkthroughVersion | undefined>(this, undefined);
	readonly simulatedVersion: IObservable<VoiceWalkthroughVersion | undefined> = this._simulatedVersion;

	private readonly _simulatedHover = observableValue<boolean>(this, false);
	readonly simulatedHover: IObservable<boolean> = this._simulatedHover;

	private readonly _contextKey: IContextKey<VoiceInputMode>;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IChatSpeechToTextService chatSpeechToTextService: IChatSpeechToTextService,
	) {
		super();

		const stored = this.storageService.get(STORAGE_KEY, StorageScope.PROFILE);
		const initial: VoiceInputMode = stored === 'dictation' ? 'dictation' : 'voice';
		this._selectedMode = observableValue<VoiceInputMode>(this, initial);
		this.selectedMode = this._selectedMode;

		this.voiceAvailable = observableFromEvent(this,
			Event.any(configurationService.onDidChangeConfiguration, contextKeyService.onDidChangeContext),
			() => configurationService.getValue<boolean>('agents.voice.enabled') === true
				&& ChatContextKeys.enabled.getValue(contextKeyService) === true
				&& AGENTS_VOICE_ENTITLED.evaluate({ getValue: key => contextKeyService.getContextKeyValue(key) })
				&& configurationService.getValue<boolean>(AgentsVoiceSettingId.ShowButton) !== false);

		this.dictationAvailable = observableFromEvent(this,
			Event.any(configurationService.onDidChangeConfiguration, contextKeyService.onDidChangeContext),
			() => chatSpeechToTextService.isConfigured
				&& configurationService.getValue<boolean>(DictationSettingId.ShowButton) !== false);

		this.handsFree = observableFromEvent(this,
			configurationService.onDidChangeConfiguration,
			() => configurationService.getValue<boolean>('agents.voice.handsFree') !== false);

		this._contextKey = CHAT_VOICE_INPUT_MODE.bindTo(contextKeyService);
		this._register(autorun(reader => {
			this._contextKey.set(this._selectedMode.read(reader));
		}));
	}

	setSelectedMode(mode: VoiceInputMode): void {
		if (this._selectedMode.get() === mode) {
			return;
		}
		this._selectedMode.set(mode, undefined);
		this.storageService.store(STORAGE_KEY, mode, StorageScope.PROFILE, StorageTarget.USER);
	}

	setSimulatedVoiceState(state: SimulatedVoiceState | undefined): void {
		this._simulatedVoiceState.set(state, undefined);
	}

	private static readonly WALKTHROUGHS: Readonly<Record<VoiceWalkthroughVersion, IVoiceWalkthrough>> = {
		handsFree: {
			handsFree: true,
			steps: [
				{ state: 'off', ms: 1600 },
				{ state: 'connecting', ms: 1400 },
				{ state: 'idle', ms: 1400 },
				{ state: 'listening', ms: 2800 },
				{ state: 'speaking', ms: 2800 },
				{ state: 'listening', ms: 1600 },
				{ state: 'speaking', ms: 2400 },
				{ state: 'idle', ms: 1600 },
				{ state: 'off', ms: 1600 },
			],
		},
		keyboardHold: {
			handsFree: false,
			steps: [
				{ state: 'off', ms: 1600 },
				{ state: 'connecting', ms: 1400 },
				{ state: 'idle', ms: 2400 },
				{ state: 'listening', ms: 2800 },
				{ state: 'speaking', ms: 2800 },
				{ state: 'idle', ms: 1800 },
				{ state: 'listening', ms: 2600 },
				{ state: 'speaking', ms: 2400 },
				{ state: 'idle', ms: 1600 },
				{ state: 'off', ms: 1600 },
			],
		},
		buttonHold: {
			handsFree: false,
			steps: [
				{ state: 'off', ms: 1600 },
				{ state: 'connecting', ms: 1400 },
				{ state: 'idle', ms: 2200 },
				{ state: 'idle', hover: true, ms: 1800 },
				{ state: 'listening', ms: 2800 },
				{ state: 'speaking', ms: 2800 },
				{ state: 'idle', ms: 1800 },
				{ state: 'listening', ms: 2600 },
				{ state: 'speaking', ms: 2400 },
				{ state: 'idle', ms: 1600 },
				{ state: 'off', ms: 1600 },
			],
		},
		clickToggle: {
			handsFree: false,
			steps: [
				{ state: 'off', ms: 1600 },
				{ state: 'connecting', ms: 1400 },
				{ state: 'idle', ms: 2000 },
				{ state: 'listening', ms: 2800 },
				{ state: 'idle', ms: 1800 },
				{ state: 'listening', ms: 2600 },
				{ state: 'speaking', ms: 2800 },
				{ state: 'listening', ms: 1800 },
				{ state: 'idle', ms: 1600 },
				{ state: 'off', ms: 1600 },
			],
		},
	};

	private static readonly WALK_STEP_MS = 2400;

	private _walkTimer: ReturnType<typeof setTimeout> | undefined;
	private _walkIndex = 0;
	private _walkVersion: VoiceWalkthroughVersion | undefined;

	startVoiceStateWalkthrough(version: VoiceWalkthroughVersion): void {
		this.clearSimulation();
		const walkthrough = VoiceInputModeService.WALKTHROUGHS[version];
		this._walkVersion = version;
		this._simulatedHandsFree.set(walkthrough.handsFree, undefined);
		this._simulatedVersion.set(version, undefined);
		this._walkIndex = 0;
		const advance = () => {
			const steps = walkthrough.steps;
			const step = steps[this._walkIndex % steps.length];
			transaction(tx => {
				this._simulatedVoiceState.set(step.state, tx);
				this._simulatedHover.set(step.hover ?? false, tx);
			});
			this._walkIndex++;
			this._walkTimer = setTimeout(advance, step.ms ?? VoiceInputModeService.WALK_STEP_MS);
		};
		advance();
	}

	stepVoiceStateWalkthrough(): void {
		this._stopWalkTimer();
		const version = this._walkVersion ?? 'keyboardHold';
		const steps = VoiceInputModeService.WALKTHROUGHS[version].steps;
		this._walkIndex = this._walkIndex % steps.length;
		const step = steps[this._walkIndex];
		transaction(tx => {
			this._simulatedVersion.set(version, tx);
			this._simulatedHandsFree.set(VoiceInputModeService.WALKTHROUGHS[version].handsFree, tx);
			this._simulatedVoiceState.set(step.state, tx);
			this._simulatedHover.set(step.hover ?? false, tx);
		});
		this._walkIndex++;
	}

	clearSimulation(): void {
		this._stopWalkTimer();
		this._walkIndex = 0;
		this._walkVersion = undefined;
		transaction(tx => {
			this._simulatedVoiceState.set(undefined, tx);
			this._simulatedHandsFree.set(undefined, tx);
			this._simulatedVersion.set(undefined, tx);
			this._simulatedHover.set(false, tx);
		});
	}

	private _stopWalkTimer(): void {
		if (this._walkTimer !== undefined) {
			clearTimeout(this._walkTimer);
			this._walkTimer = undefined;
		}
	}

	override dispose(): void {
		this._stopWalkTimer();
		super.dispose();
	}
}

registerSingleton(IVoiceInputModeService, VoiceInputModeService, InstantiationType.Delayed);
