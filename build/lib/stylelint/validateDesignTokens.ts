/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


const RE_FONT_SIZE_PX = /font-size\s*:\s*([\d.]+)px/i;
const RE_CODICON_SELECTOR = /codicon/i;

const ALLOWED_CODICON_PX = new Set([16, 12]);

export interface IDesignTokenViolation {
	readonly line: number;
	readonly message: string;
}

function isNearMiss(px: number): boolean {
	return px > 12 && px < 16;
}

const STANDARD_CODICON_SIZES = 'var(--vscode-codiconFontSize) [16] or var(--vscode-codiconFontSize-compact) [12]';

function formatCodiconMessage(px: string, nearMiss: boolean): string {
	const note = nearMiss ? '' : ' (large/small glyph - may be intentional)';
	return `${px}px -> ${STANDARD_CODICON_SIZES}${note}`;
}

function blankComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
}

function forEachDeclaration(text: string, callback: (line: number, selector: string, declaration: string) => void): void {
	const source = blankComments(text);
	const selectorStack: string[] = [];
	let pending = '';
	let line = 1;

	for (let i = 0; i < source.length; i++) {
		const ch = source[i];
		if (ch === '\n') {
			line++;
		}
		switch (ch) {
			case '{':
				selectorStack.push(pending.trim());
				pending = '';
				break;
			case '}':
				selectorStack.pop();
				pending = '';
				break;
			case ';':
				callback(line, selectorStack[selectorStack.length - 1] ?? '', pending);
				pending = '';
				break;
			default:
				pending += ch;
		}
	}
}

export function validateCodiconFontSizes(text: string): IDesignTokenViolation[] {
	const violations: IDesignTokenViolation[] = [];

	forEachDeclaration(text, (line, selector, declaration) => {
		if (!RE_CODICON_SELECTOR.test(selector)) {
			return;
		}
		const match = RE_FONT_SIZE_PX.exec(declaration);
		if (!match) {
			return;
		}
		const px = parseFloat(match[1]);
		if (ALLOWED_CODICON_PX.has(px)) {
			return;
		}
		const nearMiss = isNearMiss(px);
		violations.push({ line, message: formatCodiconMessage(match[1], nearMiss) });
	});

	return violations;
}


const FONT_SIZE_RAMP: ReadonlyMap<number, string> = new Map([
	[26, 'var(--vscode-fontSize-heading1)'],
	[18, 'var(--vscode-fontSize-heading2)'],
	[13, 'var(--vscode-fontSize-body1) or var(--vscode-fontSize-heading3)'],
	[12, 'var(--vscode-fontSize-label1)'],
	[11, 'var(--vscode-fontSize-body2) or var(--vscode-fontSize-label2)'],
	[10, 'var(--vscode-fontSize-label3)'],
]);

export function validateFontSizeTokens(text: string): IDesignTokenViolation[] {
	const violations: IDesignTokenViolation[] = [];

	forEachDeclaration(text, (line, selector, declaration) => {
		if (RE_CODICON_SELECTOR.test(selector)) {
			return;
		}
		const match = RE_FONT_SIZE_PX.exec(declaration);
		if (!match) {
			return;
		}
		const px = parseFloat(match[1]);
		const suggestion = FONT_SIZE_RAMP.get(px);
		if (suggestion === undefined) {
			return;
		}
		violations.push({
			line,
			message: `${match[1]}px -> ${suggestion}`
		});
	});

	return violations;
}


const RE_BORDER_RADIUS = /border-radius\s*:\s*([^;{}]+)/i;
const RE_FIRST_PX = /(\d+(?:\.\d+)?)px/;

interface ICornerRadiusToken {
	readonly px: number;
	readonly name: string;
}

const CORNER_RADIUS_TOKENS: readonly ICornerRadiusToken[] = [
	{ px: 2, name: 'xSmall' },
	{ px: 4, name: 'small' },
	{ px: 6, name: 'medium' },
	{ px: 8, name: 'large' },
	{ px: 12, name: 'xLarge' },
];

const CIRCLE_THRESHOLD_PX = 100;

function snapCornerRadius(px: number): ICornerRadiusToken {
	if (px >= CIRCLE_THRESHOLD_PX) {
		return { px: 9999, name: 'circle' };
	}
	let best = CORNER_RADIUS_TOKENS[0];
	let bestDistance = Math.abs(best.px - px);
	for (const token of CORNER_RADIUS_TOKENS) {
		const distance = Math.abs(token.px - px);
		if (distance <= bestDistance) {
			best = token;
			bestDistance = distance;
		}
	}
	return best;
}

export function validateCornerRadiusTokens(text: string): IDesignTokenViolation[] {
	const violations: IDesignTokenViolation[] = [];

	forEachDeclaration(text, (line, _selector, declaration) => {
		const decl = RE_BORDER_RADIUS.exec(declaration);
		if (!decl) {
			return;
		}
		const value = decl[1];
		if (/var\(|calc\(/i.test(value)) {
			return;
		}
		const pxMatch = RE_FIRST_PX.exec(value);
		if (!pxMatch) {
			return;
		}
		const px = parseFloat(pxMatch[1]);
		if (px === 0) {
			return;
		}
		const token = snapCornerRadius(px);
		const exact = token.px === px;
		const note = exact ? '' : ` (off-scale, ${token.px}px)`;
		violations.push({
			line,
			message: `${pxMatch[1]}px -> var(--vscode-cornerRadius-${token.name})${note}`
		});
	});

	return violations;
}


const RE_FONT_WEIGHT = /font-weight\s*:\s*([^;{}]+)/i;

interface IFontWeightToken {
	readonly weight: number;
	readonly name: string;
}

const FONT_WEIGHT_TOKENS: readonly IFontWeightToken[] = [
	{ weight: 400, name: 'regular' },
	{ weight: 600, name: 'semiBold' },
];

function parseFontWeight(value: string): number | undefined {
	const trimmed = value.trim().toLowerCase();
	if (trimmed === 'normal') {
		return 400;
	}
	if (trimmed === 'bold') {
		return 700;
	}
	const numeric = /^(\d{3})$/.exec(trimmed);
	return numeric ? parseInt(numeric[1], 10) : undefined;
}

function snapFontWeight(weight: number): IFontWeightToken {
	let best = FONT_WEIGHT_TOKENS[0];
	let bestDistance = Math.abs(best.weight - weight);
	for (const token of FONT_WEIGHT_TOKENS) {
		const distance = Math.abs(token.weight - weight);
		if (distance <= bestDistance) {
			best = token;
			bestDistance = distance;
		}
	}
	return best;
}

export function validateFontWeightTokens(text: string): IDesignTokenViolation[] {
	const violations: IDesignTokenViolation[] = [];

	forEachDeclaration(text, (line, _selector, declaration) => {
		const decl = RE_FONT_WEIGHT.exec(declaration);
		if (!decl) {
			return;
		}
		const value = decl[1];
		if (/var\(|calc\(/i.test(value)) {
			return;
		}
		const weight = parseFontWeight(value);
		if (weight === undefined) {
			return;
		}
		const token = snapFontWeight(weight);
		const exact = token.weight === weight;
		const shown = value.trim();
		const note = exact ? '' : ' (off-ramp, 400/600 only)';
		violations.push({
			line,
			message: `${shown} -> var(--vscode-fontWeight-${token.name})${note}`
		});
	});

	return violations;
}


const RE_SPACING_PROP = /(?:^|[\s;])(padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?\s*:\s*([^;{}]+)/i;

const SPACING_SCALE: readonly number[] = [2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 36, 40];

function snapSpacing(px: number): number {
	let best = SPACING_SCALE[0];
	let bestDistance = Math.abs(best - px);
	for (const value of SPACING_SCALE) {
		const distance = Math.abs(value - px);
		if (distance <= bestDistance) {
			best = value;
			bestDistance = distance;
		}
	}
	return best;
}

function spacingVar(px: number): string {
	return px === 0 ? 'var(--vscode-spacing-sizeNone)' : `var(--vscode-spacing-size${px * 10})`;
}

export function validateSpacingTokens(text: string): IDesignTokenViolation[] {
	const violations: IDesignTokenViolation[] = [];
	const scale = new Set(SPACING_SCALE);

	forEachDeclaration(text, (line, _selector, declaration) => {
		const decl = RE_SPACING_PROP.exec(declaration);
		if (!decl) {
			return;
		}
		const value = decl[2].trim();
		if (/var\(|calc\(|auto|%|\b\d+(?:\.\d+)?(?:r?em|vh|vw|ch|fr)\b/i.test(value)) {
			return;
		}
		const parts = value.split(/\s+/);
		const snapped: string[] = [];
		const vars: string[] = [];
		let hasOffScale = false;
		let ok = true;
		for (const part of parts) {
			if (part === '0' || part === '0px') {
				snapped.push(part);
				vars.push(spacingVar(0));
				continue;
			}
			const pxMatch = /^(\d+(?:\.\d+)?)px$/i.exec(part);
			if (!pxMatch) {
				ok = false;
				break;
			}
			const px = parseFloat(pxMatch[1]);
			if (scale.has(px)) {
				snapped.push(part);
				vars.push(spacingVar(px));
				continue;
			}
			hasOffScale = true;
			const nearest = snapSpacing(px);
			snapped.push(`${nearest}px`);
			vars.push(spacingVar(nearest));
		}
		if (!ok || !hasOffScale) {
			return;
		}
		violations.push({
			line,
			message: `${value} is off the spacing scale -> nearest: ${snapped.join(' ')} (${vars.join(' ')})`
		});
	});

	return violations;
}


const RE_STROKE_PROP = /(?:^|[\s;])(border(?:-(?:top|right|bottom|left))?(?:-width)?|outline(?:-width)?)\s*:\s*([^;{}]+)/i;

export function validateStrokeTokens(text: string): IDesignTokenViolation[] {
	const violations: IDesignTokenViolation[] = [];

	forEachDeclaration(text, (line, _selector, declaration) => {
		const decl = RE_STROKE_PROP.exec(declaration);
		if (!decl) {
			return;
		}
		const value = decl[2];
		if (/var\(|calc\(/i.test(value)) {
			return;
		}
		const pxMatch = RE_FIRST_PX.exec(value);
		if (!pxMatch || parseFloat(pxMatch[1]) !== 1) {
			return;
		}
		violations.push({
			line,
			message: `${decl[1].trim()}: ${value.trim()} -> use var(--vscode-strokeThickness) for the 1px width`
		});
	});

	return violations;
}


interface IDeprecatedToken {
	readonly deprecated: string;
	readonly replacement: string;
}

const DEPRECATED_TOKENS: readonly IDeprecatedToken[] = [
	{ deprecated: '--vscode-bodyFontSize', replacement: '--vscode-fontSize-body1' },
	{ deprecated: '--vscode-bodyFontSize-small', replacement: '--vscode-fontSize-label1' },
	{ deprecated: '--vscode-bodyFontSize-xSmall', replacement: '--vscode-fontSize-body2' },
];

const DEPRECATED_TOKENS_SORTED = [...DEPRECATED_TOKENS].sort((a, b) => b.deprecated.length - a.deprecated.length);

export function validateDeprecatedTokens(text: string): IDesignTokenViolation[] {
	const violations: IDesignTokenViolation[] = [];

	forEachDeclaration(text, (line, _selector, declaration) => {
		for (const { deprecated, replacement } of DEPRECATED_TOKENS_SORTED) {
			for (let idx = declaration.indexOf(deprecated); idx !== -1; idx = declaration.indexOf(deprecated, idx + deprecated.length)) {
				const nextChar = declaration[idx + deprecated.length] ?? '';
				if (/[\w-]/.test(nextChar)) {
					continue;
				}
				violations.push({
					line,
					message: `${deprecated} -> ${replacement} (deprecated)`
				});
			}
		}
	});

	return violations;
}
