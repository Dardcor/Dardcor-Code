/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { renderFormattedText } from '../../../../../base/browser/formattedTextRenderer.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { status } from '../../../../../base/browser/ui/aria/aria.js';
import { SelectBox } from '../../../../../base/browser/ui/selectBox/selectBox.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { defaultSelectBoxStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { AgentsVoiceStorageKeys } from '../../../agentsVoice/common/agentsVoice.js';
import { CONFIGURE_DICTATION_INSTRUCTIONS_ACTION_ID } from '../actions/configureVoiceInstructionsAction.js';
import { ChatInputOnboarding, IChatInputOnboardingBanner, IChatInputOnboardingHostOptions } from '../widget/input/chatInputOnboarding.js';
import { ChatInputNoticeVariant, ChatInputNoticeWidget } from '../widget/input/chatInputNoticeWidget.js';
import './media/dictationOnboarding.css';

const DICTATION_INTRO_SHOWN_KEY = 'chat.dictation.introShown';

export const SHOW_DICTATION_ONBOARDING_COMMAND = 'workbench.action.chat.showSpeechToTextIntroduction';
export const RESET_DICTATION_ONBOARDING_COMMAND = 'workbench.action.chat.resetSpeechToTextIntroduction';

const OPEN_SETTINGS_COMMAND = 'workbench.action.openSettings';

const DICTATION_SETTINGS_QUERY = 'dictation';

const SYSTEM_DEFAULT_DEVICE_ID = '';

type DictationMediaDevices = Pick<MediaDevices, 'addEventListener' | 'removeEventListener' | 'dispatchEvent' | 'enumerateDevices' | 'getUserMedia'>;
type SwitchMicrophone = (deviceId: string) => Promise<AnalyserNode | undefined>;

type DictationOnboardingAction = 'shown' | 'selectMicrophone' | 'openSettings' | 'openInstructions' | 'close' | 'escape';

type DictationOnboardingActionClassification = {
	action: { classification: 'PublicNonPersonalData'; purpose: 'FeatureInsight'; comment: 'The action taken in the Dictation onboarding card.' };
	source: { classification: 'PublicNonPersonalData'; purpose: 'FeatureInsight'; comment: 'Whether the card appeared automatically on first use or was opened manually.' };
	owner: 'meganrogge';
	comment: 'Tracks engagement with the Dictation onboarding card.';
};

type DictationOnboardingActionEvent = {
	action: DictationOnboardingAction;
	source: 'automatic' | 'manual';
};


const BAR_WIDTH = 1;
const BAR_GAP = 2;

const IDLE_GAIN = 0.55;

const SPEAKING_GAIN = 0.45;

const LEVEL_EASING = 0.12;

const RESTING_OPACITY = 0.35;

const SPEAKING_OPACITY = 0.5;

const UNAVAILABLE_OPACITY = 0.2;

const REDUCED_MOTION_PAINT_INTERVAL_MS = 100;

interface IWave {
	readonly frequency: number;
	readonly amplitude: number;
	readonly speed: number;
	readonly phase: number;
}

function readMicrophoneLevel(analyser: AnalyserNode | undefined, waveform: Uint8Array<ArrayBuffer> | undefined): number {
	if (!analyser || !waveform) {
		return 0;
	}
	analyser.getByteTimeDomainData(waveform);
	let sum = 0;
	for (const sample of waveform) {
		const centered = (sample - 128) / 128;
		sum += centered * centered;
	}
	return Math.min(1, Math.sqrt(sum / waveform.length) * 4);
}

const WAVES: readonly IWave[] = [
	{ frequency: 1.0, amplitude: 0.42, speed: 0.42, phase: 0.0 },
	{ frequency: 1.7, amplitude: 0.26, speed: -0.31, phase: 1.1 },
	{ frequency: 2.6, amplitude: 0.19, speed: 0.24, phase: 2.4 },
	{ frequency: 4.1, amplitude: 0.13, speed: -0.18, phase: 0.7 },
];

function bandFraction(position: number, time: number): number {
	let amplitude = 0;
	let total = 0;
	for (const wave of WAVES) {
		const phase = position * wave.frequency * Math.PI * 2 + time * wave.speed + wave.phase;
		amplitude += (0.5 + 0.5 * Math.sin(phase)) * wave.amplitude;
		total += wave.amplitude;
	}
	if (total === 0) {
		return 0;
	}
	const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, position)));
	return (amplitude / total) * (0.35 + 0.65 * taper);
}

const enum MicrophonePreviewError {
	Denied = 'denied',
	NoDevice = 'noDevice',
	Unavailable = 'unavailable',
}

class MicrophonePreview extends Disposable {

	private readonly session = this._register(new MutableDisposable<DisposableStore>());

	private analyser: AnalyserNode | undefined;
	private waveform: Uint8Array<ArrayBuffer> | undefined;

	private readonly _onDidChangeError = this._register(new Emitter<MicrophonePreviewError | undefined>());
	readonly onDidChangeError = this._onDidChangeError.event;

	private _error: MicrophonePreviewError | undefined;
	get error(): MicrophonePreviewError | undefined { return this._error; }

	constructor(
		private readonly element: HTMLElement,
		private readonly mediaDevices: DictationMediaDevices | undefined,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	getLevel(): number {
		return readMicrophoneLevel(this.analyser, this.waveform);
	}

	async listen(deviceId: string): Promise<void> {
		if (this._store.isDisposed) {
			return;
		}

		this.releaseMicrophone();

		const targetWindow = dom.getWindow(this.element);
		if (!this.mediaDevices?.getUserMedia) {
			this.setError(MicrophonePreviewError.Unavailable);
			return;
		}

		const constraints: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true };
		if (deviceId) {
			constraints.deviceId = { exact: deviceId };
		}

		let stream: MediaStream;
		try {
			stream = await this.mediaDevices.getUserMedia({ audio: constraints });
		} catch (error) {
			this.setError(toPreviewError(error));
			this.logService.trace(`[chat-stt] microphone preview unavailable: ${error}`);
			return;
		}

		const store = new DisposableStore();
		store.add(toDisposable(() => stream.getTracks().forEach(track => track.stop())));

		let analyser: AnalyserNode;
		try {
			const context = new targetWindow.AudioContext();
			store.add(toDisposable(() => void context.close().catch(() => { })));
			if (context.state === 'suspended') {
				await context.resume();
			}
			analyser = context.createAnalyser();
			analyser.fftSize = 256;
			context.createMediaStreamSource(stream).connect(analyser);
		} catch (error) {
			store.dispose();
			this.setError(MicrophonePreviewError.Unavailable);
			this.logService.trace(`[chat-stt] microphone preview analyser unavailable: ${error}`);
			return;
		}

		if (this._store.isDisposed) {
			store.dispose();
			return;
		}

		this.session.value = store;
		this.analyser = analyser;
		this.waveform = new Uint8Array(analyser.fftSize);
		this.setError(undefined);
	}

	releaseMicrophone(): void {
		this.analyser = undefined;
		this.waveform = undefined;
		this.session.clear();
	}

	private setError(error: MicrophonePreviewError | undefined): void {
		if (this._error === error) {
			return;
		}
		this._error = error;
		this._onDidChangeError.fire(error);
	}
}

function toPreviewError(error: unknown): MicrophonePreviewError {
	if (error instanceof DOMException) {
		if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
			return MicrophonePreviewError.Denied;
		}
		if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
			return MicrophonePreviewError.NoDevice;
		}
	}
	return MicrophonePreviewError.Unavailable;
}

interface IWaveformSource {
	getLevel(): number;
	isAvailable(): boolean;
}

class MicrophoneWaveform extends Disposable {

	private bars: HTMLElement[] = [];
	private readonly animationFrame = this._register(new MutableDisposable<IDisposable>());

	private running = false;
	private lastPaint = 0;
	private level = 0;

	constructor(
		private readonly container: HTMLElement,
		private readonly source: IWaveformSource,
		observerCtor: typeof ResizeObserver | undefined,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
	) {
		super();

		container.setAttribute('aria-hidden', 'true');

		const observer = new (observerCtor ?? dom.getWindow(container).ResizeObserver)(() => this.layout());
		observer.observe(container);
		this._register(toDisposable(() => observer.disconnect()));

		this.layout();
		this._register(toDisposable(() => this.stop()));
	}

	private layout(): void {
		const width = this.container.clientWidth;
		if (!width) {
			return;
		}
		const count = Math.max(1, Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));
		if (count === this.bars.length) {
			return;
		}
		dom.clearNode(this.container);
		this.bars = [];
		for (let i = 0; i < count; i++) {
			this.bars.push(dom.append(this.container, dom.$('span.dictation-onboarding-bar')));
		}
	}

	start(): void {
		if (this.running) {
			return;
		}
		this.running = true;
		const targetWindow = dom.getWindow(this.container);
		const tick = () => {
			if (!this.running) {
				return;
			}
			this.update(targetWindow.performance.now());
			this.animationFrame.value = dom.scheduleAtNextAnimationFrame(targetWindow, tick);
		};
		this.animationFrame.value = dom.scheduleAtNextAnimationFrame(targetWindow, tick);
	}

	stop(): void {
		this.running = false;
		this.animationFrame.clear();
	}

	private update(timestamp: number): void {
		const interval = this.accessibilityService.isMotionReduced() ? REDUCED_MOTION_PAINT_INTERVAL_MS : 0;
		if (timestamp - this.lastPaint < interval) {
			return;
		}
		this.lastPaint = timestamp;

		this.level += (this.source.getLevel() - this.level) * LEVEL_EASING;
		const gain = IDLE_GAIN + this.level * SPEAKING_GAIN;
		const time = timestamp * 0.001;

		this.container.style.opacity = (this.source.isAvailable()
			? RESTING_OPACITY + this.level * SPEAKING_OPACITY
			: UNAVAILABLE_OPACITY).toFixed(3);

		const count = this.bars.length;
		for (let i = 0; i < count; i++) {
			const position = count > 1 ? i / (count - 1) : 0;
			const amount = Math.max(0.08, Math.min(1, bandFraction(position, time) * gain));
			this.bars[i].style.transform = `scaleY(${amount.toFixed(3)})`;
		}
	}
}


export interface IMicrophoneOption {
	readonly deviceId: string;
	readonly label: string;
}

export function buildMicrophoneOptions(devices: readonly MediaDeviceInfo[]): IMicrophoneOption[] {
	const seen = new Set<string>();
	const microphones: MediaDeviceInfo[] = [];
	for (const device of devices) {
		if (device.kind !== 'audioinput' || device.deviceId === 'default' || device.deviceId === 'communications') {
			continue;
		}
		if (seen.has(device.deviceId)) {
			continue;
		}
		seen.add(device.deviceId);
		microphones.push(device);
	}

	if (microphones.length === 0) {
		return [{
			deviceId: SYSTEM_DEFAULT_DEVICE_ID,
			label: localize('dictation.onboarding.systemDefault', "System default"),
		}];
	}

	const defaultDevice = devices.find(device => device.kind === 'audioinput' && device.deviceId === 'default');
	const defaultLabel = defaultDevice?.label.replace(/^(?:default|system default)\s*-\s*/i, '').trim();
	const defaultMicrophone = defaultDevice
		? microphones.find(device =>
			(defaultDevice.groupId && device.groupId === defaultDevice.groupId)
			|| (defaultLabel && device.label === defaultLabel)
		) ?? microphones[0]
		: undefined;

	const options: IMicrophoneOption[] = [];
	if (defaultDevice) {
		const label = defaultMicrophone?.label || defaultLabel;
		options.push({
			deviceId: SYSTEM_DEFAULT_DEVICE_ID,
			label: label
				? localize('dictation.onboarding.defaultDevice', "{0} (System default)", label)
				: localize('dictation.onboarding.systemDefault', "System default"),
		});
	}

	for (const device of microphones) {
		if (device === defaultMicrophone) {
			continue;
		}
		options.push({
			deviceId: device.deviceId,
			label: device.label || localize('dictation.onboarding.unknownDevice', "Unknown device ({0})", device.deviceId.slice(0, 8)),
		});
	}
	return options;
}

export function indexOfMicrophone(options: readonly IMicrophoneOption[], deviceId: string): number {
	const index = options.findIndex(option => option.deviceId === deviceId);
	return index === -1 ? 0 : index;
}


export interface IDictationOnboardingBannerOptions {
	readonly container: HTMLElement;
	readonly onDismiss: () => void;
	readonly previewMicrophone: boolean;
	readonly source: 'automatic' | 'manual';
}

export class DictationOnboardingBanner extends ChatInputNoticeWidget implements IChatInputOnboardingBanner {

	private readonly preview: MicrophonePreview | undefined;
	private readonly waveform: MicrophoneWaveform;
	private readonly hint: HTMLElement | undefined;
	private readonly pickerContainer: HTMLElement | undefined;
	private dictationAnalyser: AnalyserNode | undefined;
	private dictationWaveform: Uint8Array<ArrayBuffer> | undefined;
	private switchMicrophone: SwitchMicrophone | undefined;

	private readonly picker = this._register(new MutableDisposable<DisposableStore>());
	private options: IMicrophoneOption[] = [];

	constructor(
		private readonly bannerOptions: IDictationOnboardingBannerOptions,
		private readonly mediaDevices: DictationMediaDevices | undefined,
		@ICommandService private readonly commandService: ICommandService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
		super({
			container: bannerOptions.container,
			variant: ChatInputNoticeVariant.Onboarding,
			className: 'dictation-onboarding-banner',
			ariaLabel: localize('dictation.onboarding.region', "Dictation introduction"),
			ariaDescription: bannerOptions.previewMicrophone
				? localize('dictation.onboarding.regionDescription.preview', "Say anything to check your microphone.")
				: localize('dictation.onboarding.regionDescription', "Speak and it becomes text."),
			onEscape: () => this.dismiss('escape'),
		});

		const header = dom.append(this.domNode, dom.$('.dictation-onboarding-header'));
		const title = dom.append(header, dom.$('.chat-input-notice-title.dictation-onboarding-title'));
		title.textContent = localize('dictation.onboarding.title', "Dictation");
		this.renderDescription(header);

		this.renderClose();

		const device = dom.append(this.domNode, dom.$('.dictation-onboarding-device'));
		this.pickerContainer = dom.append(device, dom.$('.chat-input-notice-picker.dictation-onboarding-picker'));
		this.options = [{
			deviceId: SYSTEM_DEFAULT_DEVICE_ID,
			label: localize('dictation.onboarding.systemDefault', "System default"),
		}];
		this.renderPicker();

		if (this.mediaDevices) {
			this._register(dom.addDisposableListener(this.mediaDevices, 'devicechange', () => void this.refreshMicrophones()));
		}

		const waveformContainer = dom.append(device, dom.$('.dictation-onboarding-waveform'));
		if (this.bannerOptions.previewMicrophone) {
			const preview = this.preview = this._register(instantiationService.createInstance(MicrophonePreview, this.domNode, this.mediaDevices));
			this.waveform = this._register(instantiationService.createInstance(MicrophoneWaveform, waveformContainer, {
				getLevel: () => preview.getLevel(),
				isAvailable: () => preview.error === undefined,
			}, undefined));
			this._register(preview.onDidChangeError(() => this.updateHint()));

			this.hint = dom.append(this.domNode, dom.$('.dictation-onboarding-hint'));
			this.hint.setAttribute('aria-live', 'polite');
			this.updateHint();

			void this.startPreview();
		} else {
			this.waveform = this._register(instantiationService.createInstance(MicrophoneWaveform, waveformContainer, {
				getLevel: () => readMicrophoneLevel(this.dictationAnalyser, this.dictationWaveform),
				isAvailable: () => this.dictationAnalyser !== undefined,
			}, undefined));
			void this.refreshMicrophones();
		}
		this.waveform.start();
		this.logAction('shown');
	}

	override setVisible(visible: boolean): void {
		super.setVisible(visible);
		if (visible) {
			this.waveform.start();
			if (this.preview) {
				void this.startPreview();
			}
		} else {
			this.waveform.stop();
			this.preview?.releaseMicrophone();
		}
	}

	private renderDescription(container: HTMLElement): void {
		const description = dom.append(container, dom.$('.chat-input-notice-description.dictation-onboarding-description'));
		const text = localize({
			key: 'dictation.onboarding.description',
			comment: ['Preserve the double square brackets: they mark the text that becomes a link. Keep both links, in this order - the first opens settings, the second opens the customization file.'],
		}, "Speak and it becomes text. Adjust [[settings]] or [[how it's written]] any time.");

		dom.append(description, renderFormattedText(text, {
			actionHandler: {
				callback: index => {
					const [commandId, ...args] = index === '0'
						? [OPEN_SETTINGS_COMMAND, { query: DICTATION_SETTINGS_QUERY }]
						: [CONFIGURE_DICTATION_INSTRUCTIONS_ACTION_ID];
					this.logAction(index === '0' ? 'openSettings' : 'openInstructions');
					this.commandService.executeCommand(commandId as string, ...args)
						.catch(error => this.logService.error(`[chat-stt] failed to open dictation customization: ${error}`));
				},
				disposables: this._store,
			},
		}, dom.$('span')));

		// eslint-disable-next-line no-restricted-syntax
		for (const link of description.querySelectorAll('a')) {
			link.tabIndex = 0;
			link.setAttribute('role', 'button');
			this._register(dom.addDisposableListener(link, dom.EventType.KEY_DOWN, event => {
				const keyboardEvent = new StandardKeyboardEvent(event);
				if (keyboardEvent.equals(KeyCode.Enter) || keyboardEvent.equals(KeyCode.Space)) {
					keyboardEvent.preventDefault();
					link.click();
				}
			}));
		}
	}

	private async startPreview(): Promise<void> {
		if (!this.preview) {
			return;
		}
		const listening = this.preview.listen(this.currentDeviceId());
		await Promise.all([listening, this.refreshMicrophones()]);
		await this.refreshMicrophones();
	}

	private currentDeviceId(): string {
		return this.storageService.get(AgentsVoiceStorageKeys.MicrophoneDevice, StorageScope.APPLICATION, SYSTEM_DEFAULT_DEVICE_ID);
	}

	async refreshMicrophones(analyserNode?: AnalyserNode, switchMicrophone?: SwitchMicrophone): Promise<void> {
		if (this._store.isDisposed) {
			return;
		}
		this.switchMicrophone = switchMicrophone ?? this.switchMicrophone;
		if (!this.preview && analyserNode) {
			this.dictationAnalyser = analyserNode;
			this.dictationWaveform = new Uint8Array(analyserNode.fftSize);
		}
		if (!this.preview && !this.dictationAnalyser) {
			return;
		}
		if (!this.mediaDevices?.enumerateDevices) {
			return;
		}

		let devices: MediaDeviceInfo[];
		try {
			devices = await this.mediaDevices.enumerateDevices();
		} catch (error) {
			this.logService.trace(`[chat-stt] could not enumerate microphones: ${error}`);
			return;
		}

		if (this._store.isDisposed) {
			return;
		}

		const options = buildMicrophoneOptions(devices);
		if (options.length > 1 && !devices.some(device => device.kind === 'audioinput' && device.label)) {
			return;
		}

		this.options = options;
		this.renderPicker();
	}

	private renderPicker(): void {
		if (!this.pickerContainer) {
			return;
		}
		this.picker.clear();
		dom.clearNode(this.pickerContainer);

		this.pickerContainer.hidden = this.options.length <= 1;
		if (this.pickerContainer.hidden) {
			return;
		}

		dom.append(this.pickerContainer, dom.$(`span.codicon.codicon-${Codicon.micCompact.id}.dictation-onboarding-picker-icon`))
			.setAttribute('aria-hidden', 'true');

		const selected = indexOfMicrophone(this.options, this.currentDeviceId());

		const store = new DisposableStore();
		const selectBox = store.add(new SelectBox(
			this.options.map(option => ({ text: option.label })),
			selected,
			this.contextViewService,
			{ ...defaultSelectBoxStyles, selectBackground: undefined, selectBorder: undefined, selectForeground: undefined },
			{ ariaLabel: localize('dictation.onboarding.microphone', "Microphone"), useCustomDrawn: true },
		));
		selectBox.render(this.pickerContainer);
		store.add(selectBox.onDidSelect(event => this.selectMicrophone(event.index)));
		this.picker.value = store;
	}

	private selectMicrophone(index: number): void {
		const option = this.options[index];
		if (!option) {
			return;
		}
		this.logAction('selectMicrophone');

		if (option.deviceId) {
			this.storageService.store(AgentsVoiceStorageKeys.MicrophoneDevice, option.deviceId, StorageScope.APPLICATION, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(AgentsVoiceStorageKeys.MicrophoneDevice, StorageScope.APPLICATION);
		}

		status(localize('dictation.onboarding.microphoneSelected', "{0} selected.", option.label));
		if (this.preview) {
			void this.preview.listen(option.deviceId).then(() => this.updateHint());
		} else if (this.switchMicrophone) {
			void this.switchMicrophone(option.deviceId)
				.then(analyser => this.refreshMicrophones(analyser))
				.catch(error => this.logService.error(`[chat-stt] failed to switch dictation microphone: ${error}`));
		}
	}

	private updateHint(): void {
		if (!this.preview || !this.hint) {
			return;
		}
		const error = this.preview.error;
		this.domNode.classList.toggle('has-error', error !== undefined);
		this.hint.textContent = error === undefined ? '' : hintForError(error);
	}

	private renderClose(): void {
		this.addDismissAction({
			className: 'dictation-onboarding-close',
			ariaLabel: localize('dictation.onboarding.close', "Close the introduction"),
			onActivate: () => this.dismiss('close'),
		});
	}

	private dismiss(action: 'close' | 'escape'): void {
		this.logAction(action);
		this.waveform.stop();
		this.preview?.releaseMicrophone();
		this.bannerOptions.onDismiss();
	}

	private logAction(action: DictationOnboardingAction): void {
		this.telemetryService.publicLog2<DictationOnboardingActionEvent, DictationOnboardingActionClassification>(
			'dictationOnboarding.action',
			{ action, source: this.bannerOptions.source }
		);
	}
}

function hintForError(error: MicrophonePreviewError): string {
	switch (error) {
		case MicrophonePreviewError.Denied:
			return localize('dictation.onboarding.denied', "No microphone access. Check your system privacy settings.");
		case MicrophonePreviewError.NoDevice:
			return localize('dictation.onboarding.noDevice', "No microphone found.");
		default:
			return localize('dictation.onboarding.unavailable', "Can't read the microphone level.");
	}
}


export const IDictationOnboardingService = createDecorator<IDictationOnboardingService>('dictationOnboardingService');

export interface IDictationOnboardingService {
	readonly _serviceBrand: undefined;
	readonly isVisible: boolean;

	registerHost(options: IChatInputOnboardingHostOptions): IDisposable;

	showIfNeeded(): boolean;

	show(): boolean;

	refreshMicrophones(analyserNode?: AnalyserNode, switchMicrophone?: SwitchMicrophone): void;

	reset(): void;
}

export class DictationOnboardingService extends Disposable implements IDictationOnboardingService {

	declare readonly _serviceBrand: undefined;

	private readonly onboarding: ChatInputOnboarding;
	private currentBanner: DictationOnboardingBanner | undefined;

	get isVisible(): boolean {
		return this.onboarding.isVisible;
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		this.onboarding = this._register(this.instantiationService.createInstance(ChatInputOnboarding, {
			storageKey: DICTATION_INTRO_SHOWN_KEY,
		}));
	}

	registerHost(options: IChatInputOnboardingHostOptions): IDisposable {
		return this.onboarding.registerHost(options);
	}

	showIfNeeded(): boolean {
		return this.onboarding.showIfNeeded(context => this.createBanner(context.container, context.dismiss, 'automatic', false));
	}

	show(): boolean {
		return this.onboarding.show(context => this.createBanner(context.container, context.dismiss, 'manual', true));
	}

	refreshMicrophones(analyserNode?: AnalyserNode, switchMicrophone?: SwitchMicrophone): void {
		if (this.onboarding.isVisible) {
			void this.currentBanner?.refreshMicrophones(analyserNode, switchMicrophone);
		}
	}

	reset(): void {
		this.storageService.remove(DICTATION_INTRO_SHOWN_KEY, StorageScope.APPLICATION);
	}

	private createBanner(container: HTMLElement, dismiss: () => void, source: 'automatic' | 'manual', previewMicrophone: boolean): DictationOnboardingBanner {
		const banner = this.instantiationService.createInstance(DictationOnboardingBanner, {
			container,
			onDismiss: dismiss,
			previewMicrophone,
			source,
		}, dom.getWindow(container).navigator.mediaDevices);
		this.currentBanner = banner;
		return banner;
	}
}

registerSingleton(IDictationOnboardingService, DictationOnboardingService, InstantiationType.Delayed);
