/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Color, HSLA } from '../../../../../base/common/color.js';
import { inputBackground } from '../../../../../platform/theme/common/colors/inputColors.js';
import { IColorTheme } from '../../../../../platform/theme/common/themeService.js';
import { chatVoiceGlowBaseColor, chatVoiceListeningGlow, chatVoiceSpeakingGlow } from '../../common/widget/chatColors.js';

export type VoiceGlowState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export function isGlowingVoiceState(voiceState: VoiceGlowState): boolean {
	return voiceState === 'listening' || voiceState === 'speaking';
}

export function shouldRenderVoiceInputGlow(connected: boolean, active: boolean, ownsVoice: boolean, voiceState: VoiceGlowState): boolean {
	return connected && active && ownsVoice && isGlowingVoiceState(voiceState);
}

export function readVoiceGlowIntensity(analyser: AnalyserNode | null, dataArray: { value: Uint8Array | undefined }): number {
	if (!analyser) {
		return 0.3;
	}
	if (!dataArray.value || dataArray.value.length !== analyser.frequencyBinCount) {
		dataArray.value = new Uint8Array(analyser.frequencyBinCount);
	}
	analyser.getByteFrequencyData(dataArray.value as Uint8Array<ArrayBuffer>);
	let sum = 0;
	for (let i = 0; i < dataArray.value.length; i++) {
		sum += dataArray.value[i];
	}
	return Math.min(1, (sum / dataArray.value.length) / 80);
}


export interface IVoiceGlowColors {
	readonly listening: Color;
	readonly speaking: Color;
	readonly background: Color;
}

export const VOICE_GLOW_SPEAKING_HUE_SHIFT = 80;

const VOICE_GLOW_FALLBACK = Color.fromHex('#58A6FF');

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function shiftHue(base: Color, degrees: number, saturationMul: number = 1, lightnessAdd: number = 0): Color {
	const hsla = base.hsla;
	return new Color(new HSLA((hsla.h + degrees + 360) % 360, clamp01(hsla.s * saturationMul), clamp01(hsla.l + lightnessAdd), 1));
}

export const DEFAULT_VOICE_GLOW_COLORS: IVoiceGlowColors = {
	listening: VOICE_GLOW_FALLBACK,
	speaking: shiftHue(VOICE_GLOW_FALLBACK, VOICE_GLOW_SPEAKING_HUE_SHIFT),
	background: Color.fromHex('#3C3C3C'),
};

export function resolveVoiceGlowColors(theme: Pick<IColorTheme, 'getColor'>): IVoiceGlowColors {
	const base = theme.getColor(chatVoiceGlowBaseColor) ?? VOICE_GLOW_FALLBACK;
	return {
		listening: theme.getColor(chatVoiceListeningGlow) ?? base,
		speaking: theme.getColor(chatVoiceSpeakingGlow) ?? shiftHue(base, VOICE_GLOW_SPEAKING_HUE_SHIFT),
		background: theme.getColor(inputBackground) ?? DEFAULT_VOICE_GLOW_COLORS.background,
	};
}

export function voiceGlowStateColor(voiceState: VoiceGlowState, colors: IVoiceGlowColors): Color {
	return voiceState === 'speaking' ? colors.speaking : colors.listening;
}


export type VoiceRimMood = 'cool' | 'warm';

export type GlowThemeKind = 'light' | 'dark';

const RIM_SAT_MIN = 70;
const RIM_SAT_MAX = 96;

const RIM_LIGHTNESS = {
	dark: { cool: 56, warm: 72 },
	light: { cool: 72, warm: 72 },
} as const;

const RIM_HUE_SHIFT = { cool: -10, warm: 7 } as const;

export function resolveVoiceRimAccent(accent: Color, mood: VoiceRimMood, theme: GlowThemeKind, background?: Color): IVoiceRimAccent {
	const { h, s } = accent.hsla;
	const tuned = new Color(new HSLA(
		(h + RIM_HUE_SHIFT[mood] + 360) % 360,
		Math.min(RIM_SAT_MAX, Math.max(RIM_SAT_MIN, s * 100)) / 100,
		RIM_LIGHTNESS[theme][mood] / 100,
		1,
	));
	const contrasted = (background ?? (theme === 'light' ? Color.white : DEFAULT_VOICE_GLOW_COLORS.background)).ensureConstrast(tuned, 3);
	return {
		hue: contrasted.hsla.h,
		saturation: Math.round(contrasted.hsla.s * 100),
		lightness: Math.round(contrasted.hsla.l * 100),
	};
}

export interface IVoiceRimAccent {
	readonly hue: number;
	readonly saturation: number;
	readonly lightness: number;
}

export function computeVoiceMicGlowBoxShadow(voiceState: VoiceGlowState, intensity: number, colors: IVoiceGlowColors = DEFAULT_VOICE_GLOW_COLORS): string {
	const { r, g, b } = voiceGlowStateColor(voiceState, colors).rgba;
	const shadowSpread = 3 + intensity * 8;
	const shadowAlpha = 0.2 + intensity * 0.45;
	return `0 0 ${shadowSpread}px rgba(${r},${g},${b},${shadowAlpha})`;
}
