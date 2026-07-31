/**
 * Dardcor Code - Keybinding Action & Shortcut Combination Fuzzy Search
 */

import { fuzzyMatch } from '../../core/types/strings';
import type { IKeybindingEntry } from './keybindings-editor';

export interface IKeybindingSearchScore {
	readonly entry: IKeybindingEntry;
	readonly score: number;
	readonly matchedField: 'command' | 'keybinding' | 'when';
}

export class KeybindingsSearch {
	public static search(query: string, entries: readonly IKeybindingEntry[], limit = 100): IKeybindingSearchScore[] {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) {
			return entries.slice(0, limit).map(entry => ({ entry, score: 0, matchedField: 'command' }));
		}

		const scores: IKeybindingSearchScore[] = [];
		for (const entry of entries) {
			const score = KeybindingsSearch.score(trimmed, entry);
			if (score) {
				scores.push(score);
			}
		}
		return scores.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	public static score(query: string, entry: IKeybindingEntry): IKeybindingSearchScore | undefined {
		const q = query.trim().toLowerCase();
		if (!q) {
			return undefined;
		}

		const command = entry.commandId.toLowerCase();
		const title = entry.title.toLowerCase();
		const keybinding = entry.keybinding.toLowerCase();
		const when = (entry.when ?? '').toLowerCase();
		const combined = `${command} ${title}`;

		if (command === q || title === q) {
			return { entry, score: 1000, matchedField: 'command' };
		}
		if (keybinding === q) {
			return { entry, score: 900, matchedField: 'keybinding' };
		}
		if (command.startsWith(q) || title.startsWith(q)) {
			return { entry, score: 700 + q.length, matchedField: 'command' };
		}
		if (keybinding.startsWith(q)) {
			return { entry, score: 600 + q.length, matchedField: 'keybinding' };
		}
		if (combined.includes(q)) {
			return { entry, score: 400 + q.length, matchedField: 'command' };
		}
		if (keybinding.includes(q)) {
			return { entry, score: 300 + q.length, matchedField: 'keybinding' };
		}
		if (when.includes(q)) {
			return { entry, score: 200 + q.length, matchedField: 'when' };
		}
		if (fuzzyMatch(q, command) || fuzzyMatch(q, title)) {
			return { entry, score: 100, matchedField: 'command' };
		}
		if (fuzzyMatch(q, keybinding)) {
			return { entry, score: 80, matchedField: 'keybinding' };
		}
		return undefined;
	}

	public static hasAnyMatch(query: string, entry: IKeybindingEntry): boolean {
		return KeybindingsSearch.score(query, entry) !== undefined;
	}
}
