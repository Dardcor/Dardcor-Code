export interface ITextSnapshot {
	read(): string | null;
}

export class Snapshot implements ITextSnapshot {
	private _index = 0;
	private readonly _lines: string[];

	constructor(lines: string[]) {
		this._lines = lines.slice();
	}

	public read(): string | null {
		if (this._index >= this._lines.length) {
			return null;
		}
		const line = this._lines[this._index];
		this._index++;
		return line;
	}

	public peek(): string | null {
		if (this._index >= this._lines.length) {
			return null;
		}
		return this._lines[this._index];
	}

	public getPosition(): number {
		return this._index;
	}

	public getLineCount(): number {
		return this._lines.length;
	}

	public getRemainingLineCount(): number {
		return this._lines.length - this._index;
	}

	public rewind(): void {
		this._index = 0;
	}

	public toArray(): string[] {
		return this._lines.slice(this._index);
	}
}

export function createSnapshot(lineStrings: string[]): ITextSnapshot {
	return new Snapshot(lineStrings);
}

export function snapshotToLines(snapshot: ITextSnapshot): string[] {
	const lines: string[] = [];
	let chunk: string | null;
	while ((chunk = snapshot.read()) !== null) {
		lines.push(chunk);
	}
	return lines;
}

export function snapshotToText(snapshot: ITextSnapshot): string {
	return snapshotToLines(snapshot).join('\n');
}

export function snapshotFromText(text: string): ITextSnapshot {
	if (text.length === 0) {
		return new Snapshot([]);
	}
	return new Snapshot(text.split(/\r?\n/));
}
