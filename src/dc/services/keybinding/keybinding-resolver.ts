/**
 * Dardcor Code - Keybinding Trie Match Engine (Task 117)
 */

import { StringTrie } from '../../core/collections/trie';
import { ChordKeybinding, IKeybinding } from '../../core/types/keycodes';

export interface IKeybindingRule {
	readonly keybinding: ChordKeybinding;
	readonly command: string;
	readonly when?: string;
	readonly weight?: number;
}

interface IResolvedEntry {
	readonly rule: IKeybindingRule;
}

export interface IKeybindingMatch {
	readonly command: string;
	readonly rule: IKeybindingRule;
	readonly isChord: boolean;
}

export const DEFAULT_KEYBINDING_WEIGHT = 1000;

export function hashKeybindingPart(keybinding: IKeybinding): string {
	const parts: string[] = [];
	if (keybinding.ctrlKey) parts.push('ctrl');
	if (keybinding.shiftKey) parts.push('shift');
	if (keybinding.altKey) parts.push('alt');
	if (keybinding.metaKey) parts.push('meta');
	parts.push(`k${keybinding.keyCode}`);
	return parts.join('+');
}

export function hashChord(chord: ChordKeybinding): string {
	return chord.parts.map((part) => hashKeybindingPart(part)).join('>');
}

const CHORD_SEPARATOR = '>';

export class KeybindingResolver {
	private readonly _trie = new StringTrie<IResolvedEntry[]>();
	private readonly _byCommand = new Map<string, ChordKeybinding>();
	private readonly _chordStarts = new Set<string>();
	private _pending: { key: string; rule: IKeybindingRule } | null = null;

	constructor(rules: IKeybindingRule[]) {
		for (const rule of rules) {
			this._insert(rule);
		}
	}

	private _insert(rule: IKeybindingRule): void {
		const hash = hashChord(rule.keybinding);
		const entries = this._trie.find(hash) ?? [];
		const existingIndex = entries.findIndex((e) => e.rule.command === rule.command);
		const entry: IResolvedEntry = { rule };
		if (existingIndex >= 0) {
			entries[existingIndex] = entry;
		} else {
			entries.push(entry);
		}
		entries.sort((a, b) => (b.rule.weight ?? DEFAULT_KEYBINDING_WEIGHT) - (a.rule.weight ?? DEFAULT_KEYBINDING_WEIGHT));
		this._trie.insert(hash, entries);

		if (hash.includes(CHORD_SEPARATOR)) {
			this._chordStarts.add(hash.substring(0, hash.indexOf(CHORD_SEPARATOR)));
		}

		const existing = this._byCommand.get(rule.command);
		if (!existing || (rule.weight ?? DEFAULT_KEYBINDING_WEIGHT) > 0) {
			this._byCommand.set(rule.command, rule.keybinding);
		}
	}

	public lookupKeybinding(commandId: string): ChordKeybinding | undefined {
		return this._byCommand.get(commandId);
	}

	public getCommandIds(): string[] {
		return [...this._byCommand.keys()];
	}

	public hasPendingChord(): boolean {
		return this._pending !== null;
	}

	public clearPendingChord(): void {
		this._pending = null;
	}

	public resolve(
		contextMatches: (when: string | undefined) => boolean,
		keybinding: IKeybinding
	): IKeybindingMatch | null {
		const key = hashKeybindingPart(keybinding);

		if (this._pending) {
			const chordKey = this._pending.key + CHORD_SEPARATOR + key;
			const chordEntries = this._trie.find(chordKey);
			this._pending = null;
			const chordEntry = chordEntries?.find((e) => contextMatches(e.rule.when));
			if (chordEntry) {
				return { command: chordEntry.rule.command, rule: chordEntry.rule, isChord: true };
			}
			return null;
		}

		const entries = this._trie.find(key);
		if (!entries || entries.length === 0) {
			return null;
		}

		let best: IResolvedEntry | undefined;
		for (const entry of entries) {
			if (contextMatches(entry.rule.when)) {
				if (!best || (entry.rule.weight ?? DEFAULT_KEYBINDING_WEIGHT) > (best.rule.weight ?? DEFAULT_KEYBINDING_WEIGHT)) {
					best = entry;
				}
			}
		}
		if (!best) {
			return null;
		}

		const hasContinuation = this._chordStarts.has(key);
		if (hasContinuation) {
			this._pending = { key, rule: best.rule };
		}
		return { command: best.rule.command, rule: best.rule, isChord: hasContinuation };
	}
}
