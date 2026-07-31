/**
 * Dardcor Code - Slash Command Intent Parser for Chat Input
 */

export type ChatIntentKind = 'explain' | 'fix' | 'tests' | 'ask' | 'refactor' | 'review' | 'unknown';

export interface IChatIntent {
	readonly kind: ChatIntentKind;
	readonly command: string;
	readonly args: string;
	readonly raw: string;
	readonly target: string | undefined;
	readonly mentions: string[];
}

export interface IChatIntentDescriptor {
	readonly command: string;
	readonly kind: ChatIntentKind;
	readonly description: string;
}

export const CHAT_INTENTS: IChatIntentDescriptor[] = [
	{ command: '/explain', kind: 'explain', description: 'Jelaskan kode yang dipilih atau file target' },
	{ command: '/fix', kind: 'fix', description: 'Sarankan perbaikan bug pada kode' },
	{ command: '/tests', kind: 'tests', description: 'Tulis rencana atau implementasi unit test' },
	{ command: '/refactor', kind: 'refactor', description: 'Usulkan refactor kode' },
	{ command: '/review', kind: 'review', description: 'Lakukan code review' }
];

export class ChatIntentParser {
	public static parse(input: string): IChatIntent {
		const raw = input.trim();
		const mentions = ChatIntentParser.extractMentions(raw);
		const withoutMentions = raw.replace(/@[\w\-./\\]+/g, '').trim();

		const match = /^\/([a-zA-Z]+)(?:\s+(.*))?$/.exec(withoutMentions);
		if (!match) {
			return {
				kind: 'ask',
				command: '',
				args: raw,
				raw,
				target: undefined,
				mentions
			};
		}

		const command = `/${match[1].toLowerCase()}`;
		const args = (match[2] ?? '').trim();
		const descriptor = CHAT_INTENTS.find(d => d.command === command);

		return {
			kind: descriptor?.kind ?? 'unknown',
			command,
			args,
			raw,
			target: ChatIntentParser.extractTarget(args),
			mentions
		};
	}

	public static isCommand(input: string): boolean {
		return /^\/([a-zA-Z]+)/.test(input.trim());
	}

	public static extractMentions(input: string): string[] {
		const mentions: string[] = [];
		const regex = /@([\w\-./\\]+)/g;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(input)) !== null) {
			mentions.push(match[1]);
		}
		return mentions;
	}

	public static extractTarget(args: string): string | undefined {
		const fileMatch = /^(?:file\s*:\s*)?([\w\-./\\]+\.\w+)/.exec(args);
		if (fileMatch) {
			return fileMatch[1];
		}
		return undefined;
	}

	public static getSuggestion(query: string): IChatIntentDescriptor | undefined {
		const q = query.trim().toLowerCase();
		if (!q) {
			return undefined;
		}
		let best: IChatIntentDescriptor | undefined;
		let bestScore = 0;
		for (const intent of CHAT_INTENTS) {
			let score = 0;
			if (intent.command.startsWith(q)) {
				score = 100 + q.length;
			} else if (intent.command.includes(q)) {
				score = 50 + q.length;
			} else if (intent.description.toLowerCase().includes(q)) {
				score = 20;
			}
			if (score > bestScore) {
				bestScore = score;
				best = intent;
			}
		}
		return best;
	}

	public static complete(input: string): IChatIntentDescriptor[] {
		const q = input.trim().toLowerCase();
		if (!q) {
			return CHAT_INTENTS;
		}
		return CHAT_INTENTS.filter(intent => intent.command.startsWith(q) || intent.command.includes(q));
	}
}
