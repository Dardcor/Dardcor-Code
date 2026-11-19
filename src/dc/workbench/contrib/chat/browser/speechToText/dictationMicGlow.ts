/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/dictationMicGlow.css';
import { getWindow } from '../../../../../base/browser/dom.js';
import { Color } from '../../../../../base/common/color.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, IObservable } from '../../../../../base/common/observable.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { IColorTheme, IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { isDark } from '../../../../../platform/theme/common/theme.js';
import { inputBackground } from '../../../../../platform/theme/common/colors/inputColors.js';
import { chatDictationActiveMicGlow } from '../../common/widget/chatColors.js';
import { readVoiceGlowIntensity } from '../voiceClient/voiceGlow.js';
import { createVoiceRimLight, IVoiceRimLight } from '../voiceClient/voiceGlowController.js';
import { ChatSpeechToTextState, IChatSpeechToTextService, isDictationActiveOnSurface } from './chatSpeechToTextService.js';

export type DictationMicGlowPhase = 'off' | 'live' | 'settling';

export function getDictationMicGlowPhase(state: ChatSpeechToTextState, isPreparingModel: boolean): DictationMicGlowPhase {
	if (isPreparingModel || state === ChatSpeechToTextState.Idle) {
		return 'off';
	}
	return state === ChatSpeechToTextState.Recording ? 'live' : 'settling';
}

export function easeDictationMicLevel(current: number, target: number): number {
	return current + (target - current) * (target > current ? 0.1 : 0.035);
}

export function shapeDictationMicLevel(level: number): number {
	return Math.min(1, Math.pow(Math.min(1, Math.max(0, level)), 0.7) * 1.15);
}

const RESTING_LEVEL = 0.12;

const REDUCED_MOTION_LEVEL = 0.45;

export function resolveDictationMicAccent(theme: IColorTheme): Color | undefined {
	return theme.getColor(chatDictationActiveMicGlow);
}

export function setupDictationMicGlow(
	target: HTMLElement,
	service: IChatSpeechToTextService,
	accessibilityService: IAccessibilityService,
	isActive?: IObservable<boolean>,
	themeService?: IThemeService,
): IDisposable {
	const store = new DisposableStore();
	const window = getWindow(target);
	const dataArray = { value: undefined as Uint8Array | undefined };
	const rim = store.add(new MutableDisposable<IVoiceRimLight>());
	let animationFrame: number | undefined;
	let level = 0;

	const setLevel = (value: number, animate: boolean) => {
		level = value;
		target.style.setProperty('--dictation-mic-level', value.toFixed(3));
		if (animate) {
			rim.value?.drive(value);
		} else {
			rim.value?.driveStatic(value);
		}
	};

	const stopAnimation = () => {
		if (animationFrame !== undefined) {
			window.cancelAnimationFrame(animationFrame);
			animationFrame = undefined;
		}
	};

	const animate = () => {
		animationFrame = window.requestAnimationFrame(animate);
		const measured = service.state === ChatSpeechToTextState.Recording && service.analyserNode
			? readVoiceGlowIntensity(service.analyserNode, dataArray)
			: RESTING_LEVEL;
		setLevel(easeDictationMicLevel(level, shapeDictationMicLevel(measured)), true);
	};

	const syncRim = (lit: boolean) => {
		if (!themeService) {
			return;
		}
		if (!lit) {
			rim.clear();
			return;
		}
		const theme = themeService.getColorTheme();
		const accent = resolveDictationMicAccent(theme);
		if (!accent) {
			rim.clear();
			return;
		}
		const kind = isDark(theme.type) ? 'dark' : 'light';
		const background = theme.getColor(inputBackground);
		if (rim.value) {
			rim.value.refresh(accent, kind, background);
		} else {
			rim.value = createVoiceRimLight(target, accent, kind, 'cool', background);
		}
	};

	const update = (active = isActive?.get() !== false) => {
		active = active && isDictationActiveOnSurface(service, 'chat');
		const phase = active ? getDictationMicGlowPhase(service.state, service.isPreparingModel) : 'off';
		target.classList.toggle('dictation-mic-active', phase !== 'off');
		target.classList.toggle('dictation-mic-settling', phase === 'settling');
		syncRim(phase !== 'off');

		if (phase === 'off' || accessibilityService.isMotionReduced()) {
			stopAnimation();
			setLevel(phase === 'off' ? 0 : REDUCED_MOTION_LEVEL, false);
			return;
		}
		if (animationFrame === undefined) {
			animationFrame = window.requestAnimationFrame(animate);
		}
	};

	store.add(Event.any<unknown>(service.onDidChangeState, service.onDidChangePreparingModel)(() => update()));
	store.add(accessibilityService.onDidChangeReducedMotion(() => update()));
	if (themeService) {
		store.add(themeService.onDidColorThemeChange(() => update()));
	}
	if (isActive) {
		store.add(autorun(reader => {
			update(isActive.read(reader));
		}));
	}
	store.add(toDisposable(() => {
		stopAnimation();
		target.classList.remove('dictation-mic-active', 'dictation-mic-settling');
		target.style.removeProperty('--dictation-mic-level');
	}));
	update();

	return store;
}
