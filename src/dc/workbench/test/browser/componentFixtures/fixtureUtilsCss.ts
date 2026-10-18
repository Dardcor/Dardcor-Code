/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { getIconsStyleSheet } from '../../../../platform/theme/browser/iconsStyleSheet.js';
import { IThemingParticipant, IThemingRegistry, Extensions as ThemingExtensions } from '../../../../platform/theme/common/themeService.js';
import { generateColorThemeCSS } from '../../../services/themes/browser/colorThemeCss.js';
import { ColorThemeData } from '../../../services/themes/common/colorThemeData.js';

const themingRegistry = Registry.as<IThemingRegistry>(ThemingExtensions.ThemingContribution);
const mockEnvironmentService: IEnvironmentService = Object.create(null);

let overlaySheet: CSSStyleSheet | undefined;
let baseStylesInstalledPromise: Promise<void> | undefined;
let bundlePromise: Promise<Bundle> | undefined;
let bundle: Bundle | undefined;
const activeOverrides: {
	readonly option: Exclude<ReverseStylesheetsOption, false>;
	readonly overlay: CSSStyleSheet;
	readonly bundle: Bundle;
}[] = [];
let originalDisabledStates: readonly boolean[] | undefined;
let iconsStyleSheetCache: CSSStyleSheet | undefined;
const themeStyleSheetCache = new WeakMap<ColorThemeData, CSSStyleSheet>();
const installedThemes = new WeakSet<ColorThemeData>();

export type ReverseStylesheetsOption = boolean | { readonly fromIndex: number; readonly toIndex: number };

const CSS_SOURCE_MARKER_REGEX = /\/\*\s*@css-source:\s*(\S+)\s*\*\//g;

interface StylesheetDocument {
	readonly file: string;
	readonly text: string;
}

function parseStylesheetDocuments(cssText: string): { readonly preamble: string; readonly documents: readonly StylesheetDocument[] } {
	const markers = Array.from(cssText.matchAll(CSS_SOURCE_MARKER_REGEX));
	if (markers.length === 0) {
		return { preamble: cssText, documents: [] };
	}
	const preamble = cssText.slice(0, markers[0].index);
	const documents = markers.map((marker, i) => {
		const start = marker.index;
		const end = i + 1 < markers.length ? markers[i + 1].index : cssText.length;
		return { file: marker[1], text: cssText.slice(start, end) };
	});
	return { preamble, documents };
}

function reverseDocuments(cssText: string, option: Exclude<ReverseStylesheetsOption, false>): string {
	const { preamble, documents } = parseStylesheetDocuments(cssText);
	if (documents.length < 2) {
		return cssText;
	}
	const from = option === true ? 0 : Math.max(0, Math.min(documents.length, option.fromIndex));
	const to = option === true ? documents.length : Math.max(from, Math.min(documents.length, option.toIndex));
	const reordered = [
		...documents.slice(0, from),
		...documents.slice(from, to).reverse(),
		...documents.slice(to),
	];
	return preamble + reordered.map(doc => doc.text).join('');
}

async function readStyleSheetSource(sheet: CSSStyleSheet): Promise<string> {
	const owner = sheet.ownerNode;
	if (owner instanceof HTMLStyleElement) {
		return owner.textContent ?? '';
	}
	if (sheet.href) {
		try {
			return await (await fetch(sheet.href)).text();
		} catch {
		}
	}
	try {
		return Array.from(sheet.cssRules, rule => rule.cssText).join('\n');
	} catch {
		return '';
	}
}

interface Bundle {
	readonly sheets: readonly CSSStyleSheet[];
	readonly rawSources: string;
}

function readBundle(): Promise<Bundle> {
	return bundlePromise ??= (async () => {
		const sheets = Array.from(document.styleSheets);
		const sources = await Promise.all(sheets.map(readStyleSheetSource));
		const bundled = sheets
			.map((sheet, i) => ({ sheet, source: sources[i] }))
			.filter(entry => /\/\*\s*@css-source:/.test(entry.source));
		return bundle = {
			sheets: bundled.map(entry => entry.sheet),
			rawSources: bundled.map(entry => entry.source).join('\n'),
		};
	})();
}

export async function getStylesheetDocumentFiles(): Promise<string[]> {
	const { rawSources } = await readBundle();
	return parseStylesheetDocuments(rawSources).documents.map(doc => doc.file);
}

function getIconsStyleSheetCached(): CSSStyleSheet {
	if (!iconsStyleSheetCache) {
		iconsStyleSheetCache = new CSSStyleSheet();
		const iconsSheet = getIconsStyleSheet(undefined);
		iconsStyleSheetCache.replaceSync(iconsSheet.getCSS() as string);
		iconsSheet.dispose();
	}
	return iconsStyleSheetCache;
}

function createScopedThemingParticipant(scopeSelector: string, scopeRootSelector: string, participants: readonly IThemingParticipant[]): IThemingParticipant {
	return (theme, collector, environment) => {
		const rules = new Set<string>();
		const scopedCollector = { addRule: (rule: string) => rules.add(rule) };
		participants.forEach(participant => participant(theme, scopedCollector, environment));
		const scopedRules = [...rules].map(rule => rule
			.replace(/^(\s*):root(?=\s*\{)/, '$1:scope')
			.replaceAll(scopeRootSelector, ':scope'));
		collector.addRule(`@scope (${scopeSelector}) {\n${scopedRules.join('\n')}\n}`);
	};
}

function getThemeStyleSheet(theme: ColorThemeData, scopeThemingParticipants: boolean): CSSStyleSheet {
	const cachedStyleSheet = themeStyleSheetCache.get(theme);
	if (cachedStyleSheet) {
		return cachedStyleSheet;
	}

	const scopeSelector = '.' + theme.classNames[0];
	const themingParticipants = themingRegistry.getThemingParticipants();
	const sheet = new CSSStyleSheet();
	const css = generateColorThemeCSS(
		theme,
		scopeSelector,
		scopeThemingParticipants ? [createScopedThemingParticipant(scopeSelector, '.monaco-workbench', themingParticipants)] : themingParticipants,
		mockEnvironmentService
	);
	sheet.replaceSync(css.code);

	themeStyleSheetCache.set(theme, sheet);
	return sheet;
}

/**
 * Installs shared global styles once and appends a scoped stylesheet for each newly requested theme.
 * The reversal overlay keeps a stable identity and position for {@link overrideStylesheetOrder}.
 */
export async function ensureGlobalStylesInstalled(theme: ColorThemeData, scopeThemingParticipants: boolean): Promise<void> {
	baseStylesInstalledPromise ??= (async () => {
		await readBundle();
		const overlay = overlaySheet = new CSSStyleSheet();
		document.adoptedStyleSheets = [
			...document.adoptedStyleSheets,
			overlay,
			getIconsStyleSheetCached(),
		];
	})();
	await baseStylesInstalledPromise;

	if (installedThemes.has(theme)) {
		return;
	}
	document.adoptedStyleSheets = [
		...document.adoptedStyleSheets,
		getThemeStyleSheet(theme, scopeThemingParticipants),
	];
	installedThemes.add(theme);
}

export function overrideStylesheetOrder(option: Exclude<ReverseStylesheetsOption, false>): IDisposable {
	if (!overlaySheet || !bundle) {
		throw new Error('ensureGlobalStylesInstalled() must resolve before overriding the stylesheet order.');
	}
	const override = { option, overlay: overlaySheet, bundle };
	if (activeOverrides.length === 0) {
		originalDisabledStates = bundle.sheets.map(sheet => sheet.disabled);
		for (const sheet of bundle.sheets) {
			sheet.disabled = true;
		}
	}
	overlaySheet.replaceSync(reverseDocuments(bundle.rawSources, option));
	activeOverrides.push(override);

	return toDisposable(() => {
		const index = activeOverrides.indexOf(override);
		if (index === -1) {
			return;
		}
		activeOverrides.splice(index, 1);
		const activeOverride = activeOverrides.at(-1);
		if (activeOverride) {
			activeOverride.overlay.replaceSync(reverseDocuments(activeOverride.bundle.rawSources, activeOverride.option));
			return;
		}
		override.overlay.replaceSync('');
		override.bundle.sheets.forEach((sheet, i) => { sheet.disabled = originalDisabledStates![i]; });
		originalDisabledStates = undefined;
	});
}
