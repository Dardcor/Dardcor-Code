/**
 * Dardcor Code - PieceTree Text Model Engine Data Structure
 */

class Piece {
	constructor(
		public readonly bufferIndex: number,
		public readonly start: number,
		public readonly length: number,
		public readonly lineFeedCnt: number
	) {}
}

export class PieceTree {
	private _buffers: string[] = [];
	private _pieces: Piece[] = [];

	constructor(initialText: string) {
		this._buffers.push(initialText);
		const lineFeeds = (initialText.match(/\n/g) || []).length;
		this._pieces.push(new Piece(0, 0, initialText.length, lineFeeds));
	}

	public getContent(): string {
		let result = '';
		for (const p of this._pieces) {
			result += this._buffers[p.bufferIndex].substring(p.start, p.start + p.length);
		}
		return result;
	}

	public insert(offset: number, text: string): void {
		if (!text) return;
		const bufferIdx = this._buffers.length;
		this._buffers.push(text);
		const lineFeeds = (text.match(/\n/g) || []).length;
		const newPiece = new Piece(bufferIdx, 0, text.length, lineFeeds);

		if (offset === 0) {
			this._pieces.unshift(newPiece);
			return;
		}

		let currOffset = 0;
		for (let i = 0; i < this._pieces.length; i++) {
			const p = this._pieces[i];
			if (currOffset + p.length >= offset) {
				const splitAt = offset - currOffset;
				const p1 = new Piece(p.bufferIndex, p.start, splitAt, (this._buffers[p.bufferIndex].substring(p.start, p.start + splitAt).match(/\n/g) || []).length);
				const p2 = new Piece(p.bufferIndex, p.start + splitAt, p.length - splitAt, p.lineFeedCnt - p1.lineFeedCnt);

				this._pieces.splice(i, 1, p1, newPiece, p2);
				return;
			}
			currOffset += p.length;
		}

		this._pieces.push(newPiece);
	}

	public getLineCount(): number {
		let lines = 1;
		for (const p of this._pieces) {
			lines += p.lineFeedCnt;
		}
		return lines;
	}
}
