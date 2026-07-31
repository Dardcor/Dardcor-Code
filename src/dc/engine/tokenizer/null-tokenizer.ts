/**
 * Dardcor Code - Plain Text Fallback Tokenizer (Task 246)
 * Mirrors: vs/editor/common/languages/nullTokenize.ts
 */

import { LineToken, LineTokens } from '../model/line-tokens';

export interface ITokenizationResult {
	readonly tokens: LineTokens;
	readonly stopRendering: boolean;
}

export interface ITokenProvider {
	tokenize(line: string): LineTokens;
}

export class NullTokenizer {
	public static tokenize(line: string): LineTokens {
		if (line.length === 0) {
			return new LineTokens([], 0);
		}
		return new LineTokens([new LineToken(0, line.length, 0, '')], line.length);
	}

	public static getClassName(metadata: number): string {
		return '';
	}

	public static getForeground(metadata: number): number {
		return 0;
	}

	public static tokenizeLine(line: string): ITokenizationResult {
		return {
			tokens: NullTokenizer.tokenize(line),
			stopRendering: false,
		};
	}
}

export class NullTokenProvider implements ITokenProvider {
	public tokenize(line: string): LineTokens {
		return NullTokenizer.tokenize(line);
	}
}

export function createNullTokenProvider(): ITokenProvider {
	return new NullTokenProvider();
}
