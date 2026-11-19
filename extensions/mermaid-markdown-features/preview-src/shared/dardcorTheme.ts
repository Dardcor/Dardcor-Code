/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MermaidConfig } from 'mermaid';
import { MermaidExtensionConfig } from './config';
import { IDisposable } from './disposable';

export const vsCodeMermaidTheme = 'vscode';

function isDarkVsCodeTheme(): boolean {
	return document.body.classList.contains('vscode-dark')
		|| (document.body.classList.contains('vscode-high-contrast') && !document.body.classList.contains('vscode-high-contrast-light'));
}

function resolveCssColor(cssValue: string): string | undefined {
	const probe = document.createElement('span');
	probe.style.display = 'none';
	probe.style.color = cssValue;
	document.body.appendChild(probe);
	try {
		return rgbStringToHex(getComputedStyle(probe).color);
	} finally {
		probe.remove();
	}
}

function rgbStringToHex(value: string): string | undefined {
	const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
	if (!match) {
		return undefined;
	}
	const r = parseInt(match[1], 10);
	const g = parseInt(match[2], 10);
	const b = parseInt(match[3], 10);
	const a = match[4] !== undefined ? Math.round(parseFloat(match[4]) * 255) : 255;
	const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
	return a < 255
		? `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`
		: `#${hex(r)}${hex(g)}${hex(b)}`;
}

function pickColor(...varNames: string[]): string | undefined {
	for (const name of varNames) {
		if (!readCssVar(name)) {
			continue;
		}

		const hex = resolveCssColor(`var(${name})`);
		if (hex) {
			return hex;
		}
	}
	return undefined;
}

function readCssVar(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export interface VsCodeMermaidThemeVariables {
	readonly variables: Record<string, string | boolean>;
	readonly fingerprint: string;
}

export class VsCodeMermaidThemeTracker {

	private _value: VsCodeMermaidThemeVariables | undefined;
	private readonly _listeners = new Set<() => void>();

	get value(): VsCodeMermaidThemeVariables {
		return this._value ??= computeVsCodeMermaidThemeVariables();
	}

	refresh(): boolean {
		const next = computeVsCodeMermaidThemeVariables();
		if (next.fingerprint === this._value?.fingerprint) {
			return false;
		}

		this._value = next;
		for (const listener of this._listeners) {
			listener();
		}
		return true;
	}

	invalidate(): void {
		this._value = undefined;
	}

	onDidChange(listener: () => void): IDisposable {
		this._listeners.add(listener);
		return { dispose: () => this._listeners.delete(listener) };
	}

	resolveMermaidTheme(extensionConfig: MermaidExtensionConfig): Pick<MermaidConfig, 'theme' | 'themeVariables'> {
		const themeName = isDarkVsCodeTheme()
			? extensionConfig.darkModeTheme
			: extensionConfig.lightModeTheme;

		if (themeName === vsCodeMermaidTheme) {
			return {
				theme: 'base',
				themeVariables: this.value.variables,
			};
		}

		return {
			theme: themeName as MermaidConfig['theme'],
			themeVariables: {},
		};
	}

	observeDomChanges(): IDisposable {
		const observer = new MutationObserver(() => this.refresh());
		observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-id', 'data-vscode-theme-kind'] });
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
		return { dispose: () => observer.disconnect() };
	}
}

function computeVsCodeMermaidThemeVariables(): VsCodeMermaidThemeVariables {
	const variables: Record<string, string | boolean> = {
		darkMode: isDarkVsCodeTheme(),
	};

	const set = (key: string, ...varNames: string[]) => {
		const color = pickColor(...varNames);
		if (color) {
			variables[key] = color;
		}
	};

	set('background', '--vscode-editor-background');
	set('textColor', '--vscode-charts-foreground', '--vscode-editor-foreground', '--vscode-foreground');
	set('lineColor', '--vscode-chart-line', '--vscode-charts-lines', '--vscode-editor-foreground', '--vscode-foreground');

	set('primaryColor', '--vscode-editorWidget-background');
	set('primaryTextColor', '--vscode-charts-foreground', '--vscode-editor-foreground', '--vscode-foreground');
	set('primaryBorderColor', '--vscode-chart-line', '--vscode-editorWidget-border', '--vscode-focusBorder');
	set('mainBkg', '--vscode-editorWidget-background');
	set('nodeBorder', '--vscode-chart-line', '--vscode-editorWidget-border', '--vscode-focusBorder');

	set('secondaryColor', '--vscode-input-background', '--vscode-editorWidget-background');
	set('secondaryTextColor', '--vscode-input-foreground', '--vscode-foreground');
	set('secondaryBorderColor', '--vscode-input-border', '--vscode-editorWidget-border');

	set('tertiaryColor', '--vscode-textBlockQuote-background', '--vscode-input-background');
	set('tertiaryTextColor', '--vscode-foreground');
	set('tertiaryBorderColor', '--vscode-textBlockQuote-border', '--vscode-editorWidget-border');
	set('clusterBkg', '--vscode-textBlockQuote-background', '--vscode-input-background');
	set('clusterBorder', '--vscode-textBlockQuote-border', '--vscode-editorWidget-border');

	set('noteBkgColor', '--vscode-textBlockQuote-background', '--vscode-editorWidget-background');
	set('noteTextColor', '--vscode-foreground');
	set('noteBorderColor', '--vscode-textBlockQuote-border', '--vscode-editorWidget-border');

	set('errorBkgColor', '--vscode-inputValidation-errorBackground', '--vscode-editorError-background');
	set('errorTextColor', '--vscode-editorError-foreground', '--vscode-foreground');

	set('titleColor', '--vscode-charts-foreground', '--vscode-editor-foreground', '--vscode-foreground');
	set('edgeLabelBackground', '--vscode-editor-background');

	const chartPalette = [
		'--vscode-charts-blue',
		'--vscode-charts-green',
		'--vscode-charts-orange',
		'--vscode-charts-red',
		'--vscode-charts-purple',
		'--vscode-charts-yellow',
	];
	for (let i = 0; i < chartPalette.length; i++) {
		set(`pie${i + 1}`, chartPalette[i]);
		set(`cScale${i}`, chartPalette[i]);
	}

	const fontFamily = readCssVar('--vscode-font-family');
	if (fontFamily) {
		variables.fontFamily = fontFamily;
	}

	const fontSize = readCssVar('--vscode-font-size');
	if (fontSize) {
		variables.fontSize = fontSize;
	}

	return {
		variables,
		fingerprint: JSON.stringify(variables),
	};
}
