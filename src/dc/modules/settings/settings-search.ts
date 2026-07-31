/**
 * Dardcor Code - Settings Property Name & Description Fuzzy Filter
 */

import { fuzzyMatch, startsWith } from '../../core/types/strings.js';
import type { ISettingDescriptor } from './settings-editor.js';

export interface ISearchScore {
	readonly setting: ISettingDescriptor;
	readonly score: number;
	readonly matchedOn: string;
}

export class SettingsSearch {
	private static readonly MAX_RESULTS = 50;

	public filter(query: string, settings: ISettingDescriptor[]): ISettingDescriptor[] {
		const trimmed = query.trim();
		if (!trimmed) {
			return settings;
		}
		const scored = settings
			.map(setting => this._score(trimmed, setting))
			.filter((entry): entry is ISearchScore => !!entry)
			.sort((a, b) => b.score - a.score);
		return scored.slice(0, SettingsSearch.MAX_RESULTS).map(entry => entry.setting);
	}

	public matches(query: string, setting: ISettingDescriptor): boolean {
		return this._score(query, setting) !== undefined;
	}

	public score(query: string, setting: ISettingDescriptor): number {
		return this._score(query.trim(), setting)?.score ?? 0;
	}

	private _score(query: string, setting: ISettingDescriptor): ISearchScore | undefined {
		const keyLower = setting.key.toLowerCase();
		const titleLower = setting.title.toLowerCase();
		const descriptionLower = setting.description.toLowerCase();
		const categoryLower = setting.category.toLowerCase();

		if (keyLower === query) {
			return { setting, score: 1000, matchedOn: setting.key };
		}
		if (startsWith(keyLower, query)) {
			return { setting, score: 800 + query.length, matchedOn: setting.key };
		}
		if (keyLower.includes(query)) {
			return { setting, score: 600 + query.length, matchedOn: setting.key };
		}
		if (titleLower === query) {
			return { setting, score: 500, matchedOn: setting.title };
		}
		if (startsWith(titleLower, query)) {
			return { setting, score: 350 + query.length, matchedOn: setting.title };
		}
		if (titleLower.includes(query)) {
			return { setting, score: 250 + query.length, matchedOn: setting.title };
		}
		if (descriptionLower.includes(query)) {
			return { setting, score: 150 + query.length, matchedOn: setting.description };
		}
		if (categoryLower.includes(query)) {
			return { setting, score: 100 + query.length, matchedOn: setting.category };
		}
		if (fuzzyMatch(query, keyLower)) {
			return { setting, score: 90, matchedOn: setting.key };
		}
		if (fuzzyMatch(query, titleLower)) {
			return { setting, score: 60, matchedOn: setting.title };
		}
		if (fuzzyMatch(query, descriptionLower)) {
			return { setting, score: 30, matchedOn: setting.description };
		}
		return undefined;
	}
}
