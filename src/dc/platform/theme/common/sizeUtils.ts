/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { IJSONSchema } from '../../../base/common/jsonSchema.js';
import { IJSONContributionRegistry, Extensions as JSONExtensions } from '../../jsonschemas/common/jsonContributionRegistry.js';
import * as platform from '../../registry/common/platform.js';
import { IColorTheme } from './themeService.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../base/common/async.js';


export type SizeIdentifier = string;

export type SizeUnit = 'px' | 'rem' | 'em' | '%' | '';

export interface SizeValue {
	readonly value: number;
	readonly unit: SizeUnit;
}

export interface SizeContribution {
	readonly id: SizeIdentifier;
	readonly description: string;
	readonly defaults: SizeDefaults | SizeValue | null;
	readonly deprecationMessage: string | undefined;
}

export function asCssVariableName(sizeIdent: SizeIdentifier): string {
	return `--vscode-${sizeIdent.replace(/\./g, '-')}`;
}

export function asCssVariable(size: SizeIdentifier): string {
	return `var(${asCssVariableName(size)})`;
}

export function asCssVariableWithDefault(size: SizeIdentifier, defaultCssValue: string): string {
	return `var(${asCssVariableName(size)}, ${defaultCssValue})`;
}

export interface SizeDefaults {
	light: SizeValue | null;
	dark: SizeValue | null;
	hcDark: SizeValue | null;
	hcLight: SizeValue | null;
}

export function isSizeDefaults(value: unknown): value is SizeDefaults {
	return value !== null && typeof value === 'object' && 'light' in value && 'dark' in value;
}

export function size(value: number, unit: SizeUnit = 'px'): SizeValue {
	return { value, unit };
}

export function sizeForAllThemes(value: number, unit: SizeUnit = 'px'): SizeDefaults {
	const sizeValue = size(value, unit);
	return {
		light: sizeValue,
		dark: sizeValue,
		hcDark: sizeValue,
		hcLight: sizeValue
	};
}

export function sizeValueToCss(sizeValue: SizeValue): string {
	return sizeValue.unit === '' ? `${sizeValue.value}` : `${sizeValue.value}${sizeValue.unit}`;
}

export const Extensions = {
	SizeContribution: 'base.contributions.sizes'
};

export const DEFAULT_SIZE_CONFIG_VALUE = 'default';

export interface ISizeRegistry {

	readonly onDidChangeSchema: Event<void>;

	registerSize(id: string, defaults: SizeDefaults | SizeValue | null, description: string): SizeIdentifier;

	deregisterSize(id: string): void;

	getSizes(): SizeContribution[];

	resolveDefaultSize(id: SizeIdentifier, theme: IColorTheme): SizeValue | undefined;

	getSizeSchema(): IJSONSchema;

	getSizeReferenceSchema(): IJSONSchema;

	notifyThemeUpdate(theme: IColorTheme): void;

}

type IJSONSchemaForSizes = IJSONSchema & { properties: { [name: string]: IJSONSchema } };

class SizeRegistry extends Disposable implements ISizeRegistry {

	private readonly _onDidChangeSchema = this._register(new Emitter<void>());
	readonly onDidChangeSchema: Event<void> = this._onDidChangeSchema.event;

	private sizesById: { [key: string]: SizeContribution };
	private sizeSchema: IJSONSchemaForSizes = { type: 'object', properties: {} };
	private sizeReferenceSchema: IJSONSchema & { enum: string[]; enumDescriptions: string[] } = { type: 'string', enum: [], enumDescriptions: [] };

	constructor() {
		super();
		this.sizesById = {};
	}

	public notifyThemeUpdate(theme: IColorTheme) {
		for (const key of Object.keys(this.sizesById)) {
			const sizeVal = this.resolveDefaultSize(key, theme);
			if (sizeVal) {
				this.sizeSchema.properties[key].default = sizeValueToCss(sizeVal);
			}
		}
		this._onDidChangeSchema.fire();
	}

	public registerSize(id: string, defaults: SizeDefaults | SizeValue | null, description: string, deprecationMessage?: string): SizeIdentifier {
		const sizeContribution: SizeContribution = { id, description, defaults, deprecationMessage };
		this.sizesById[id] = sizeContribution;

		const isUnitless = (() => {
			if (!defaults) { return false; }
			if (isSizeDefaults(defaults)) {
				const sample = defaults.dark ?? defaults.light ?? defaults.hcDark ?? defaults.hcLight;
				return sample?.unit === '';
			}
			return defaults.unit === '';
		})();

		const propertySchema: IJSONSchema = isUnitless
			? {
				type: 'string',
				pattern: '^(?:\\d+|default)$',
				patternErrorMessage: 'Value must be an integer (e.g., "400") or "default"'
			}
			: {
				type: 'string',
				pattern: '^(?:\\d+(\\.\\d+)?(px|rem|em|%)|default)$',
				patternErrorMessage: 'Size must be a number followed by px, rem, em, or % (e.g., "12px", "1.5rem") or "default"'
			};

		if (deprecationMessage) {
			propertySchema.deprecationMessage = deprecationMessage;
		}

		this.sizeSchema.properties[id] = {
			description,
			...propertySchema
		};

		this.sizeReferenceSchema.enum.push(id);
		this.sizeReferenceSchema.enumDescriptions.push(description);

		this._onDidChangeSchema.fire();
		return id;
	}

	public deregisterSize(id: string): void {
		delete this.sizesById[id];
		delete this.sizeSchema.properties[id];
		const index = this.sizeReferenceSchema.enum.indexOf(id);
		if (index !== -1) {
			this.sizeReferenceSchema.enum.splice(index, 1);
			this.sizeReferenceSchema.enumDescriptions.splice(index, 1);
		}
		this._onDidChangeSchema.fire();
	}

	public getSizes(): SizeContribution[] {
		return Object.keys(this.sizesById).map(id => this.sizesById[id]);
	}

	public resolveDefaultSize(id: SizeIdentifier, theme: IColorTheme): SizeValue | undefined {
		const sizeDesc = this.sizesById[id];
		if (sizeDesc?.defaults) {
			const sizeValue = isSizeDefaults(sizeDesc.defaults) ? sizeDesc.defaults[theme.type] : sizeDesc.defaults;
			return sizeValue ?? undefined;
		}
		return undefined;
	}

	public getSizeSchema(): IJSONSchema {
		return this.sizeSchema;
	}

	public getSizeReferenceSchema(): IJSONSchema {
		return this.sizeReferenceSchema;
	}

	public override toString() {
		const sorter = (a: string, b: string) => {
			const cat1 = a.indexOf('.') === -1 ? 0 : 1;
			const cat2 = b.indexOf('.') === -1 ? 0 : 1;
			if (cat1 !== cat2) {
				return cat1 - cat2;
			}
			return a.localeCompare(b);
		};

		return Object.keys(this.sizesById).sort(sorter).map(k => `- \`${k}\`: ${this.sizesById[k].description}`).join('\n');
	}

}

const sizeRegistry = new SizeRegistry();
platform.Registry.add(Extensions.SizeContribution, sizeRegistry);

export function registerSize(id: string, defaults: SizeDefaults | SizeValue | null, description: string, deprecationMessage?: string): SizeIdentifier {
	return sizeRegistry.registerSize(id, defaults, description, deprecationMessage);
}

export function getSizeRegistry(): ISizeRegistry {
	return sizeRegistry;
}

export const workbenchSizesSchemaId = 'vscode://schemas/workbench-sizes';

const schemaRegistry = platform.Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
schemaRegistry.registerSchema(workbenchSizesSchemaId, sizeRegistry.getSizeSchema());

const delayer = new RunOnceScheduler(() => schemaRegistry.notifySchemaChanged(workbenchSizesSchemaId), 200);

sizeRegistry.onDidChangeSchema(() => {
	if (!delayer.isScheduled()) {
		delayer.schedule();
	}
});
