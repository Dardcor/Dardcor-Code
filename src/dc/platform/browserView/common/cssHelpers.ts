/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface ICSSStyle {
	cssText?: string;
	cssProperties: Array<{ name: string; value: string; disabled?: boolean }>;
}

interface ISelectorList {
	selectors: Array<{ text: string }>;
}

interface ICSSRule {
	selectorList: ISelectorList;
	origin: string;
	style: ICSSStyle;
}

interface IRuleMatch {
	rule: ICSSRule;
}

interface IInheritedStyleEntry {
	inlineStyle?: ICSSStyle;
	matchedCSSRules: IRuleMatch[];
}

interface IPseudoElementMatches {
	pseudoType: string;
	matches: IRuleMatch[];
}

export interface IMatchedStyles {
	inlineStyle?: ICSSStyle;
	matchedCSSRules?: IRuleMatch[];
	inherited?: IInheritedStyleEntry[];
	pseudoElements?: IPseudoElementMatches[];
}

export interface IFormattedStyles {
	rulesText: string;
	referencedVars: Set<string>;
	authorPropertyNames: Set<string>;
	userAgentPropertyNames: Set<string>;
}


const inheritableCSSProperties = new Set([
	'color', 'cursor', 'direction', 'font', 'font-family', 'font-feature-settings',
	'font-kerning', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style',
	'font-variant', 'font-weight', 'letter-spacing', 'line-height', 'list-style',
	'list-style-image', 'list-style-position', 'list-style-type', 'orphans',
	'overflow-wrap', 'quotes', 'tab-size', 'text-align', 'text-align-last',
	'text-indent', 'text-transform', 'visibility', 'white-space', 'widows',
	'word-break', 'word-spacing', 'writing-mode',
]);

const varReferenceRegex = /var\(\s*(--[a-zA-Z0-9_-]+)/g;

export const keyComputedProperties = new Set([
	'display', 'position', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
	'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
	'font-size', 'font-family', 'color', 'background-color',
]);

const alwaysResolvedProperties = new Set(['display', 'height', 'width']);


function collectVarReferences(value: string, into: Set<string>): void {
	for (const m of value.matchAll(varReferenceRegex)) {
		into.add(m[1]);
	}
}

function collectPropertyNames(cssProperties: Array<{ name: string; value: string; disabled?: boolean }>, into: Set<string>, inheritableOnly?: boolean): void {
	for (const prop of cssProperties) {
		if (!prop.name || !prop.value || prop.disabled || prop.name.startsWith('--')) {
			continue;
		}
		if (inheritableOnly && !inheritableCSSProperties.has(prop.name)) {
			continue;
		}
		into.add(prop.name);
	}
}

export function filterInheritableDeclarations(cssText: string): string | undefined {
	const declarations = cssText.split(';').map(d => d.trim()).filter(Boolean);
	const filtered = declarations.filter(decl => {
		const colonIdx = decl.indexOf(':');
		if (colonIdx === -1) {
			return false;
		}
		const propName = decl.substring(0, colonIdx).trim();
		return inheritableCSSProperties.has(propName);
	});
	return filtered.length > 0 ? filtered.join('; ') : undefined;
}

export function formatMatchedStyles(matched: IMatchedStyles): IFormattedStyles {
	const referencedVars = new Set<string>();
	const authorPropertyNames = new Set<string>();
	const userAgentPropertyNames = new Set<string>();
	const seenCssTexts = new Set<string>();
	const lines: string[] = [];

	if (matched.inlineStyle?.cssText?.trim()) {
		const cssText = matched.inlineStyle.cssText.trim();
		collectVarReferences(cssText, referencedVars);
		collectPropertyNames(matched.inlineStyle.cssProperties, authorPropertyNames);
		lines.push(`element { ${cssText} }`);
	}

	for (const ruleEntry of matched.matchedCSSRules ?? []) {
		if (ruleEntry.rule.origin === 'user-agent') {
			collectPropertyNames(ruleEntry.rule.style.cssProperties, userAgentPropertyNames);
			continue;
		}
		const cssText = ruleEntry.rule.style.cssText?.trim();
		if (!cssText || seenCssTexts.has(cssText)) {
			continue;
		}
		seenCssTexts.add(cssText);
		collectVarReferences(cssText, referencedVars);
		collectPropertyNames(ruleEntry.rule.style.cssProperties, authorPropertyNames);
		const selectors = ruleEntry.rule.selectorList.selectors.map(s => s.text).join(', ');
		lines.push(`${selectors} { ${cssText} }`);
	}

	if (matched.pseudoElements?.length) {
		const pseudoLines: string[] = [];
		for (const pseudo of matched.pseudoElements) {
			for (const ruleEntry of pseudo.matches ?? []) {
				if (ruleEntry.rule.origin === 'user-agent') {
					collectPropertyNames(ruleEntry.rule.style.cssProperties, userAgentPropertyNames);
					continue;
				}
				const cssText = ruleEntry.rule.style.cssText?.trim();
				if (!cssText || seenCssTexts.has(cssText)) {
					continue;
				}
				seenCssTexts.add(cssText);
				collectVarReferences(cssText, referencedVars);
				collectPropertyNames(ruleEntry.rule.style.cssProperties, authorPropertyNames);
				const selectors = ruleEntry.rule.selectorList.selectors.map(s => s.text).join(', ');
				pseudoLines.push(`${selectors} { ${cssText} }`);
			}
		}
		if (pseudoLines.length > 0) {
			lines.push('');
			lines.push('/* Pseudo-elements */');
			lines.push(...pseudoLines);
		}
	}

	const inheritedLines: string[] = [];
	for (const entry of matched.inherited ?? []) {
		for (const ruleEntry of entry.matchedCSSRules ?? []) {
			if (ruleEntry.rule.origin === 'user-agent') {
				collectPropertyNames(ruleEntry.rule.style.cssProperties, userAgentPropertyNames, true);
				continue;
			}
			const cssText = ruleEntry.rule.style.cssText?.trim();
			if (!cssText) {
				continue;
			}
			const filtered = filterInheritableDeclarations(cssText);
			if (!filtered || seenCssTexts.has(filtered)) {
				continue;
			}
			seenCssTexts.add(filtered);
			collectVarReferences(filtered, referencedVars);
			collectPropertyNames(ruleEntry.rule.style.cssProperties, authorPropertyNames, true);
			const selectors = ruleEntry.rule.selectorList.selectors.map(s => s.text).join(', ');
			inheritedLines.push(`${selectors} { ${filtered} }`);
		}
	}

	if (inheritedLines.length > 0) {
		lines.push('');
		lines.push('/* Inherited */');
		lines.push(...inheritedLines);
	}

	for (const prop of alwaysResolvedProperties) {
		authorPropertyNames.add(prop);
	}

	return { rulesText: lines.join('\n'), referencedVars, authorPropertyNames, userAgentPropertyNames };
}



interface IBoxShorthand {
	shorthand: string;
	sides: [string, string, string, string];
}

const boxShorthands: IBoxShorthand[] = [
	{ shorthand: 'margin', sides: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] },
	{ shorthand: 'padding', sides: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] },
	{ shorthand: 'border-radius', sides: ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] },
];


const borderSideGroups: IBoxShorthand[] = [
	{ shorthand: 'border-width', sides: ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'] },
	{ shorthand: 'border-style', sides: ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'] },
	{ shorthand: 'border-color', sides: ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'] },
];


interface IDefaultsGroup {
	longhands: Record<string, string>;
}

const dropWhenAllDefault: IDefaultsGroup[] = [
	{
		longhands: {
			'border-image-source': 'none',
			'border-image-slice': '100%',
			'border-image-width': '1',
			'border-image-outset': '0',
			'border-image-repeat': 'stretch',
		},
	},
	{
		longhands: {
			'animation-range-start': 'normal',
			'animation-range-end': 'normal',
		},
	},
];


interface IBackgroundCollapseGroup {
	colorLonghand: string;
	otherLonghands: Record<string, string>;
}

const backgroundCollapse: IBackgroundCollapseGroup = {
	colorLonghand: 'background-color',
	otherLonghands: {
		'background-image': 'none',
		'background-position-x': '0px',
		'background-position-y': '0px',
		'background-size': 'auto',
		'background-repeat': 'repeat',
		'background-attachment': 'scroll',
		'background-origin': 'padding-box',
		'background-clip': 'border-box',
	},
};


interface ISimpleShorthand {
	shorthand: string;
	longhands: Array<{ name: string; initial: string }>;
}

const simpleShorthands: ISimpleShorthand[] = [
	{
		shorthand: 'text-decoration',
		longhands: [
			{ name: 'text-decoration-line', initial: 'none' },
			{ name: 'text-decoration-style', initial: 'solid' },
			{ name: 'text-decoration-color', initial: 'currentcolor' },
			{ name: 'text-decoration-thickness', initial: 'auto' },
		],
	},
];


const whiteSpaceKeywords: Array<{ collapse: string; wrap: string; keyword: string }> = [
	{ collapse: 'collapse', wrap: 'wrap', keyword: 'normal' },
	{ collapse: 'collapse', wrap: 'nowrap', keyword: 'nowrap' },
	{ collapse: 'preserve', wrap: 'nowrap', keyword: 'pre' },
	{ collapse: 'preserve', wrap: 'wrap', keyword: 'pre-wrap' },
	{ collapse: 'preserve-breaks', wrap: 'wrap', keyword: 'pre-line' },
	{ collapse: 'break-spaces', wrap: 'wrap', keyword: 'break-spaces' },
];


interface IListShorthand {
	shorthand: string;
	longhands: Array<{ name: string; initial: string }>;
}

const listShorthands: IListShorthand[] = [
	{
		shorthand: 'transition',
		longhands: [
			{ name: 'transition-property', initial: 'all' },
			{ name: 'transition-duration', initial: '0s' },
			{ name: 'transition-timing-function', initial: 'ease' },
			{ name: 'transition-delay', initial: '0s' },
			{ name: 'transition-behavior', initial: 'normal' },
		],
	},
	{
		shorthand: 'animation',
		longhands: [
			{ name: 'animation-name', initial: 'none' },
			{ name: 'animation-duration', initial: '0s' },
			{ name: 'animation-timing-function', initial: 'ease' },
			{ name: 'animation-delay', initial: '0s' },
			{ name: 'animation-iteration-count', initial: '1' },
			{ name: 'animation-direction', initial: 'normal' },
			{ name: 'animation-fill-mode', initial: 'none' },
			{ name: 'animation-play-state', initial: 'running' },
			{ name: 'animation-timeline', initial: 'auto' },
		],
	},
];


function collapseBoxValues(entries: Map<string, string>, sides: [string, string, string, string]): string | undefined {
	const [topKey, rightKey, bottomKey, leftKey] = sides;
	const top = entries.get(topKey);
	const right = entries.get(rightKey);
	const bottom = entries.get(bottomKey);
	const left = entries.get(leftKey);

	if (top === undefined || right === undefined || bottom === undefined || left === undefined) {
		return undefined;
	}

	entries.delete(topKey);
	entries.delete(rightKey);
	entries.delete(bottomKey);
	entries.delete(leftKey);

	if (top === right && right === bottom && bottom === left) {
		return top;
	}
	if (top === bottom && right === left) {
		return `${top} ${right}`;
	}
	if (right === left) {
		return `${top} ${right} ${bottom}`;
	}
	return `${top} ${right} ${bottom} ${left}`;
}

function splitCSSList(value: string): string[] {
	const items: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === '(') {
			depth++;
		} else if (ch === ')') {
			depth--;
		} else if (ch === ',' && depth === 0) {
			items.push(value.substring(start, i).trim());
			start = i + 1;
		}
	}
	items.push(value.substring(start).trim());
	return items;
}

function collapseListShorthand(
	entries: Map<string, string>,
	output: string[],
	shorthand: string,
	longhands: Array<{ name: string; initial: string }>,
): void {
	const values = longhands.map(({ name }) => entries.get(name));
	if (!values.every(v => v !== undefined)) {
		return;
	}

	const lists = values.map(v => splitCSSList(v as string));
	const itemCount = lists[0].length;
	if (!lists.every(l => l.length === itemCount)) {
		return;
	}

	for (const { name } of longhands) {
		entries.delete(name);
	}

	const items: string[] = [];
	for (let i = 0; i < itemCount; i++) {
		const parts: string[] = [];
		for (let j = 0; j < longhands.length; j++) {
			const val = lists[j][i];
			if (val !== longhands[j].initial) {
				parts.push(val);
			}
		}
		items.push(parts.length > 0 ? parts.join(' ') : longhands[0].initial);
	}

	output.push(`${shorthand}: ${items.join(', ')};`);
}


export function collapseToShorthands(entries: Map<string, string>): string[] {
	const shorthandLines: string[] = [];

	for (const { shorthand, sides } of boxShorthands) {
		const collapsed = collapseBoxValues(entries, sides);
		if (collapsed !== undefined) {
			shorthandLines.push(`${shorthand}: ${collapsed};`);
		}
	}

	const borderVals = borderSideGroups.map(g => g.sides.map(s => entries.get(s)));
	const hasAllBorderProps = borderVals.every(group => group.every(v => v !== undefined));
	if (hasAllBorderProps) {
		const allUniform = borderVals.every(group => group.every(v => v === group[0]));
		if (allUniform) {
			for (const group of borderSideGroups) {
				for (const side of group.sides) {
					entries.delete(side);
				}
			}
			shorthandLines.push(`border: ${borderVals[0][0]} ${borderVals[1][0]} ${borderVals[2][0]};`);
		} else {
			for (const group of borderSideGroups) {
				const collapsed = collapseBoxValues(entries, group.sides);
				if (collapsed !== undefined) {
					shorthandLines.push(`${group.shorthand}: ${collapsed};`);
				}
			}
		}
	}

	for (const { longhands } of dropWhenAllDefault) {
		const allDefault = Object.entries(longhands).every(([k, v]) => entries.get(k) === v);
		if (allDefault && Object.keys(longhands).some(k => entries.has(k))) {
			for (const key of Object.keys(longhands)) {
				entries.delete(key);
			}
		}
	}

	{
		const { colorLonghand, otherLonghands } = backgroundCollapse;
		const bgColor = entries.get(colorLonghand);
		const allOthersDefault = Object.entries(otherLonghands).every(([k, v]) => entries.get(k) === v);
		if (allOthersDefault && bgColor !== undefined) {
			entries.delete(colorLonghand);
			for (const key of Object.keys(otherLonghands)) {
				entries.delete(key);
			}
			shorthandLines.push(`background: ${bgColor};`);
		}
	}

	for (const { shorthand, longhands } of simpleShorthands) {
		const first = entries.get(longhands[0].name);
		if (first === undefined) {
			continue;
		}
		const values = longhands.map(({ name }) => entries.get(name));
		for (const { name } of longhands) {
			entries.delete(name);
		}
		const parts: string[] = [];
		for (let i = 0; i < longhands.length; i++) {
			const val = values[i] ?? longhands[i].initial;
			if (val !== longhands[i].initial) {
				parts.push(val);
			}
		}
		shorthandLines.push(`${shorthand}: ${parts.length > 0 ? parts.join(' ') : longhands[0].initial};`);
	}

	{
		const wsCollapse = entries.get('white-space-collapse');
		const textWrap = entries.get('text-wrap-mode');
		if (wsCollapse !== undefined && textWrap !== undefined) {
			entries.delete('white-space-collapse');
			entries.delete('text-wrap-mode');
			const match = whiteSpaceKeywords.find(k => k.collapse === wsCollapse && k.wrap === textWrap);
			shorthandLines.push(`white-space: ${match ? match.keyword : `${wsCollapse} ${textWrap}`};`);
		}
	}

	for (const { shorthand, longhands } of listShorthands) {
		collapseListShorthand(entries, shorthandLines, shorthand, longhands);
	}

	const remainingLines: string[] = [];
	for (const [name, value] of Array.from(entries.entries()).sort(([a], [b]) => a.localeCompare(b))) {
		remainingLines.push(`${name}: ${value};`);
	}

	return [...shorthandLines, ...remainingLines];
}
