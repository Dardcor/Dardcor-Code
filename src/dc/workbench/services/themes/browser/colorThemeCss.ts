/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IColorTheme, ICssStyleCollector, IThemingParticipant } from '../../../../platform/theme/common/themeService.js';
import { asCssVariableName, getColorRegistry } from '../../../../platform/theme/common/colorRegistry.js';
import { asCssVariableName as asSizeCssVariableName, getSizeRegistry, sizeValueToCss } from '../../../../platform/theme/common/sizeRegistry.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';

export function generateColorThemeCSS(
	theme: IColorTheme,
	scopeSelector: string,
	themingParticipants?: readonly IThemingParticipant[],
	environmentService?: IEnvironmentService
): CSSValue {
	const cssRules = new Set<string>();
	const ruleCollector: ICssStyleCollector = {
		addRule: (rule: string) => {
			if (!cssRules.has(rule)) {
				cssRules.add(rule);
			}
		}
	};

	ruleCollector.addRule(`${scopeSelector} { forced-color-adjust: none; }`);

	if (themingParticipants && environmentService) {
		for (const participant of themingParticipants) {
			participant(theme, ruleCollector, environmentService);
		}
	}

	const variables: string[] = [];
	for (const item of getColorRegistry().getColors()) {
		const color = theme.getColor(item.id, true);
		if (color) {
			variables.push(`${asCssVariableName(item.id)}: ${color.toString()};`);
		}
	}

	for (const item of getSizeRegistry().getSizes()) {
		const sizeValue = getSizeRegistry().resolveDefaultSize(item.id, theme);
		if (sizeValue) {
			variables.push(`${asSizeCssVariableName(item.id)}: ${sizeValueToCss(sizeValue)};`);
		}
	}

	ruleCollector.addRule(`${scopeSelector} { ${variables.join('\n')} }`);

	return new CSSValue([...cssRules].join('\n'));
}

export class CSSValue {
	constructor(readonly code: string) { }
}
