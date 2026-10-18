/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/voiceGlow.css';
import { $ } from '../../../../../base/browser/dom.js';
import { Color } from '../../../../../base/common/color.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { DEFAULT_VOICE_GLOW_COLORS, GlowThemeKind, IVoiceGlowColors, resolveVoiceRimAccent, voiceGlowStateColor, VoiceGlowState, VoiceRimMood } from './voiceGlow.js';

export type { GlowThemeKind };


const FADE = 'opacity .6s cubic-bezier(.4,0,.2,1)';
const FADE_OUT_MS = 650;

const ACTIVE_RIM_STRENGTH = 1.02;

const RIM_LAYER_OPACITY = {
	dark: { ring: 1, inner: 0.44, bloom: 0.66 },
	light: { ring: 1, inner: 0.3, bloom: 0.8 },
} as const;

const RIM_DURATION = 2.3;

type RimMood = VoiceRimMood;

interface IMountedLayer extends IDisposable {
	readonly host: HTMLElement;
	drive(level: number): void;
	driveStatic(level: number): void;
}

export interface IVoiceGlowController extends IDisposable {
	render(state: VoiceGlowState, level: number, reducedMotion: boolean): void;
	clear(): void;
	refreshTheme(): void;
}

interface IOscillator {
	readonly prop: string;
	readonly from: number;
	readonly to: number;
	readonly period: number;
	readonly delay: number;
	readonly unit: '' | 'px';
}

function rimMotionParams(theme: GlowThemeKind, duration: number) {
	const dark = theme === 'dark';
	const scale = duration / RIM_DURATION;
	return {
		spread: 0.28,
		drift: dark ? 33 : 40,
		opacityDepth: dark ? 0.48 : 0.45,
		/** Depth of the global height swell. */
		breathDepth: dark ? 0.34 : 0.22,
		opacityPeriod: (dark ? 1.9 : 2.6) * scale,
		sizePeriod: (dark ? 2.6 : 4.6) * scale,
		/** Period of the global height swell. */
		breathPeriod: (dark ? 2.4 : 5.5) * scale,
	};
}

function rimOscillators(theme: GlowThemeKind, duration: number): IOscillator[] {
	const { spread, drift, opacityDepth, breathDepth, opacityPeriod, sizePeriod, breathPeriod } = rimMotionParams(theme, duration);
	return [
		{ prop: '--vg-w1', from: 1 - spread, to: 1 + spread * 1.1, period: sizePeriod * 0.9, delay: 0, unit: '' },
		{ prop: '--vg-h1', from: 1 + spread * 0.9, to: 1 - spread * 0.85, period: sizePeriod * 1.26, delay: 0, unit: '' },
		{ prop: '--vg-x1', from: -drift, to: drift * 0.9, period: opacityPeriod * 1.6, delay: 0, unit: 'px' },
		{ prop: '--vg-y1', from: drift * 0.55, to: -drift * 0.7, period: opacityPeriod * 1.6, delay: 0, unit: 'px' },
		{ prop: '--vg-w2', from: 1 + spread, to: 1 - spread * 0.85, period: sizePeriod * 1.1, delay: 0, unit: '' },
		{ prop: '--vg-h2', from: 1 - spread * 0.8, to: 1 + spread * 1.05, period: sizePeriod * 0.81, delay: 0, unit: '' },
		{ prop: '--vg-x2', from: drift * 0.8, to: -drift * 0.9, period: opacityPeriod * 1.88, delay: 0, unit: 'px' },
		{ prop: '--vg-y2', from: -drift, to: drift * 0.65, period: opacityPeriod * 1.88, delay: 0, unit: 'px' },
		{ prop: '--vg-w3', from: 1 - spread * 0.6, to: 1 + spread * 1.15, period: sizePeriod * 0.98, delay: 0, unit: '' },
		{ prop: '--vg-h3', from: 1 + spread * 0.75, to: 1 - spread, period: sizePeriod * 1.4, delay: 0, unit: '' },
		{ prop: '--vg-x3', from: -drift * 0.6, to: drift, period: opacityPeriod * 1.45, delay: 0, unit: 'px' },
		{ prop: '--vg-y3', from: -drift * 0.85, to: drift * 0.45, period: opacityPeriod * 1.45, delay: 0, unit: 'px' },
		{ prop: '--vg-breath', from: 1 - breathDepth, to: 1 + breathDepth, period: breathPeriod, delay: 0, unit: '' },
		{ prop: '--vg-op-tl', from: 1 - opacityDepth, to: 1, period: opacityPeriod, delay: 0, unit: '' },
		{ prop: '--vg-op-tr', from: 1 - opacityDepth, to: 1, period: opacityPeriod * 1.32, delay: opacityPeriod * 0.28, unit: '' },
		{ prop: '--vg-op-bl', from: 1 - opacityDepth, to: 1, period: opacityPeriod * 0.84, delay: opacityPeriod * 0.55, unit: '' },
		{ prop: '--vg-op-br', from: 1 - opacityDepth, to: 1, period: opacityPeriod * 1.58, delay: opacityPeriod * 0.83, unit: '' },
	];
}

function applyOscillators(host: HTMLElement, oscillators: readonly IOscillator[], time: number, animate: boolean): void {
	for (const osc of oscillators) {
		const value = animate
			? osc.from + (osc.to - osc.from) * ((1 - Math.cos(2 * Math.PI * ((time - osc.delay) / osc.period))) / 2)
			: (osc.from + osc.to) / 2;
		host.style.setProperty(osc.prop, osc.unit === 'px' ? `${value.toFixed(2)}px` : value.toFixed(4));
	}
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function nowSeconds(el: HTMLElement): number {
	const view = el.ownerDocument.defaultView;
	return (view?.performance ?? performance).now() / 1000;
}

function mountRimLayers(host: HTMLElement, options: {
	readonly theme: GlowThemeKind;
	readonly mood: RimMood;
	readonly hue: number;
	readonly saturation: number;
	readonly lightness: number;
	readonly strength: number;
	readonly duration: number;
	readonly audioGain: number;
	readonly peakGain: number;
	readonly speedGain: number;
	readonly size?: number;
}): IMountedLayer {
	const store = new DisposableStore();

	const moodClass = `voice-glow-rim-${options.mood}`;
	host.classList.add('voice-glow-rim', moodClass);
	store.add(toDisposable(() => host.classList.remove('voice-glow-rim', moodClass)));

	for (const cls of ['voice-glow-rim-corners', 'voice-glow-rim-bloom']) {
		const el = $('div');
		el.className = cls;
		host.appendChild(el);
		store.add(toDisposable(() => el.remove()));
	}

	const layerOpacity = RIM_LAYER_OPACITY[options.theme];
	host.style.setProperty('--vg-sat', `${options.saturation}%`);
	host.style.setProperty('--vg-light', `${options.lightness}%`);
	host.style.setProperty('--vg-ring-opacity', String(layerOpacity.ring));
	host.style.setProperty('--vg-inner-opacity', String(layerOpacity.inner));
	host.style.setProperty('--vg-bloom-opacity', String(layerOpacity.bloom));
	if (options.size !== undefined) {
		host.style.setProperty('--vg-size', options.size.toFixed(3));
	}

	const oscillators = rimOscillators(options.theme, options.duration);
	let time = 0;
	let previousTimestamp: number | undefined;
	let level = 0.2;

	const apply = (input: number, animate: boolean): void => {
		if (animate) {
			const timestamp = nowSeconds(host);
			const delta = previousTimestamp === undefined ? 0 : Math.min(0.05, timestamp - previousTimestamp);
			previousTimestamp = timestamp;
			const target = clamp01(input);
			level += (target - level) * (target > level ? 0.3 : 0.08);
			time += delta * (options.speedGain === 0 ? 0.22 : 0.4 + options.speedGain * level);
		} else {
			level = clamp01(input);
		}
		applyOscillators(host, oscillators, time, animate);
		const peak = level * level;
		host.style.setProperty('--vg-strength', (options.strength * (0.5 + options.audioGain * level + options.peakGain * peak)).toFixed(3));
		host.style.setProperty('--vg-bloom-opacity', (layerOpacity.bloom * (1 + options.peakGain * peak)).toFixed(3));
		const drift = animate ? 14 * Math.sin(time * 0.4) : 0;
		host.style.setProperty('--vg-hue', (options.hue + drift).toFixed(1));
	};

	return {
		host,
		drive: (input: number) => apply(input, true),
		driveStatic: (input: number) => apply(input, false),
		dispose: () => store.dispose(),
	};
}

export function createVoiceGlowController(target: HTMLElement, themeKind?: () => GlowThemeKind, colors?: () => IVoiceGlowColors): IVoiceGlowController {
	return new VoiceGlowController(target, themeKind, colors);
}

export interface IVoiceRimLight extends IDisposable {
	drive(level: number): void;
	driveStatic(level: number): void;
	refresh(accent: Color, theme: GlowThemeKind, background?: Color): void;
}

const RIM_REFERENCE_HEIGHT = 78;

const RIM_SIZE_FLOOR = 0.35;

export function createVoiceRimLight(target: HTMLElement, accent: Color, theme: GlowThemeKind, mood: VoiceRimMood = 'cool', background?: Color): IVoiceRimLight {
	const store = new DisposableStore();

	if (!target.style.position) {
		target.style.position = 'relative';
	}
	const slot = $('.voice-glow-slot.voice-glow-slot-inline');
	target.appendChild(slot);
	store.add(toDisposable(() => slot.remove()));

	const mount = store.add(new MutableDisposable<IMountedLayer>());
	let level = 0.3;

	const remount = (nextAccent: Color, nextTheme: GlowThemeKind, nextBackground?: Color) => {
		const rim = resolveVoiceRimAccent(nextAccent, mood, nextTheme, nextBackground);
		const height = target.getBoundingClientRect().height;
		const proportion = height > 0 ? Math.min(1, height / RIM_REFERENCE_HEIGHT) : 0;
		mount.clear();
		mount.value = mountRimLayers(slot, {
			theme: nextTheme,
			mood,
			hue: rim.hue,
			saturation: rim.saturation,
			lightness: rim.lightness,
			strength: ACTIVE_RIM_STRENGTH,
			duration: RIM_DURATION,
			audioGain: 0.8,
			peakGain: 0.95,
			speedGain: 0.9,
			size: RIM_SIZE_FLOOR + (1 - RIM_SIZE_FLOOR) * proportion,
		});
		mount.value.driveStatic(level);
	};
	remount(accent, theme, background);

	return {
		drive: (input: number) => {
			level = input;
			mount.value?.drive(input);
		},
		driveStatic: (input: number) => {
			level = input;
			mount.value?.driveStatic(input);
		},
		refresh: remount,
		dispose: () => store.dispose(),
	};
}

class VoiceGlowController extends Disposable implements IVoiceGlowController {

	private readonly _slots: readonly HTMLElement[];
	private readonly _mounts = new Map<HTMLElement, MutableDisposable<IMountedLayer>>();

	private _front: IMountedLayer | undefined;
	private _currentState: VoiceGlowState | 'none' = 'none';
	private _currentMood: RimMood | undefined;
	private _clearTimer: ReturnType<typeof setTimeout> | undefined;
	private _colors: IVoiceGlowColors;
	private _reducedMotion = false;
	private _disposed = false;

	constructor(
		private readonly _target: HTMLElement,
		private readonly _themeKind: () => GlowThemeKind = () => 'dark',
		private readonly _colorsProvider: () => IVoiceGlowColors = () => DEFAULT_VOICE_GLOW_COLORS,
	) {
		super();
		try {
			this._colors = this._colorsProvider();
			_target.style.position = _target.style.position || 'relative';

			const createSlot = (): HTMLElement => {
				const el = $('div');
				el.className = 'voice-glow-slot';
				el.style.zIndex = '11';
				_target.appendChild(el);
				this._register(toDisposable(() => el.remove()));
				this._mounts.set(el, this._register(new MutableDisposable<IMountedLayer>()));
				return el;
			};
			this._slots = [createSlot(), createSlot()];

			this._register(toDisposable(() => {
				this._disposed = true;
				if (this._clearTimer !== undefined) {
					clearTimeout(this._clearTimer);
					this._clearTimer = undefined;
				}
			}));
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	override dispose(): void {
		this._disposed = true;
		super.dispose();
	}

	render(state: VoiceGlowState, level: number, reducedMotion: boolean): void {
		if (this._disposed) {
			return;
		}
		const mood = resolveMood(state);
		this._reducedMotion = reducedMotion;
		if (!mood) {
			this.clear();
			return;
		}

		if (mood !== this._currentMood) {
			this._currentMood = mood;
			if (this._clearTimer !== undefined) {
				clearTimeout(this._clearTimer);
				this._clearTimer = undefined;
			}
			this._showLayer(mood, reducedMotion);
		}

		if (state !== this._currentState) {
			this._currentState = state;
			this._target.classList.add('voice-active');
			this._target.classList.toggle('voice-listening', state === 'listening');
			this._target.classList.toggle('voice-processing', state === 'processing');
			this._target.classList.toggle('voice-speaking', state === 'speaking');
			const accent = resolveVoiceRimAccent(voiceGlowStateColor(state, this._colors), mood, this._themeKind(), this._colors.background);
			this._target.style.setProperty('--voice-accent', `hsl(${accent.hue} ${accent.saturation}% ${accent.lightness}%)`);
		}

		if (this._front && !reducedMotion) {
			this._front.drive(level);
		}
	}

	clear(): void {
		if (this._disposed || this._currentState === 'none') {
			return;
		}
		this._currentState = 'none';
		this._currentMood = undefined;
		this._target.classList.remove('voice-active', 'voice-listening', 'voice-processing', 'voice-speaking');
		this._target.style.removeProperty('--voice-accent');
		const previous = this._front;
		this._front = undefined;
		if (previous) {
			this._fadeOut(previous.host);
			this._scheduleTeardown(previous.host);
		}
	}

	private _scheduleTeardown(host: HTMLElement): void {
		if (this._clearTimer !== undefined) {
			clearTimeout(this._clearTimer);
		}
		this._clearTimer = setTimeout(() => {
			this._clearTimer = undefined;
			if (this._front?.host !== host) {
				this._mounts.get(host)?.clear();
			}
		}, FADE_OUT_MS);
	}

	refreshTheme(): void {
		if (this._disposed) {
			return;
		}
		this._colors = this._colorsProvider();
		const state = this._currentState;
		if (this._front && state !== 'none') {
			this._currentState = 'none';
			this._currentMood = undefined;
			this.render(state, 0.3, this._reducedMotion);
		}
	}

	private _showLayer(mood: RimMood, reducedMotion: boolean): void {
		const host = this._slots.find(slot => slot !== this._front?.host) ?? this._slots[0];

		this._mounts.get(host)!.clear();
		const mounted = this._mount(host, mood);
		this._mounts.get(host)!.value = mounted;
		if (reducedMotion) {
			mounted.driveStatic(0.4);
		}

		const fade = reducedMotion ? 'none' : FADE;
		const previous = this._front;
		host.style.transition = 'none';
		host.style.opacity = '0';
		void host.offsetWidth;
		host.style.transition = fade;
		host.style.opacity = '1';
		if (previous && previous.host !== host) {
			this._fadeOut(previous.host, fade);
			this._scheduleTeardown(previous.host);
		}
		this._front = mounted;
	}

	private _fadeOut(host: HTMLElement, fade: string = FADE): void {
		host.style.transition = fade;
		host.style.opacity = '0';
	}

	private _mount(host: HTMLElement, mood: RimMood): IMountedLayer {
		const theme = this._themeKind();
		const accentColor = mood === 'warm' ? this._colors.speaking : this._colors.listening;
		const accent = resolveVoiceRimAccent(accentColor, mood, theme, this._colors.background);
		return mountRimLayers(host, {
			theme,
			mood,
			hue: accent.hue,
			saturation: accent.saturation,
			lightness: accent.lightness,
			strength: ACTIVE_RIM_STRENGTH,
			duration: RIM_DURATION,
			audioGain: 0.8,
			peakGain: 0.95,
			speedGain: 0.9,
		});
	}
}

function resolveMood(state: VoiceGlowState): RimMood | undefined {
	switch (state) {
		case 'listening': return 'cool';
		case 'speaking': return 'warm';
		default: return undefined;
	}
}
