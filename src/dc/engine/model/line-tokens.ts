/**
 * Dardcor Code - Line Syntax Tokens (Task 204)
 * Mirrors: vs/editor/common/tokens/lineTokens.ts
 */

export class LineToken {
	constructor(
		public readonly startOffset: number,
		public readonly endOffset: number,
		public readonly metadata: number,
		public readonly type: string
	) {}
}

export class LineTokens {
	constructor(
		private readonly _tokens: LineToken[],
		private readonly _textLength: number
	) {}

	getCount(): number {
		return this._tokens.length;
	}

	getToken(index: number): LineToken | undefined {
		return this._tokens[index];
	}

	findTokenIndexAtOffset(offset: number): number {
		let low = 0;
		let high = this._tokens.length - 1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			const token = this._tokens[mid];
			if (offset < token.startOffset) {
				high = mid - 1;
			} else if (offset >= token.endOffset) {
				low = mid + 1;
			} else {
				return mid;
			}
		}
		return Math.max(0, low - 1);
	}
}
