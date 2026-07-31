/**
 * Dardcor Code - Bit Vector (Task 92)
 */

export class BitVector {
	private _data: Uint32Array;
	private _length: number;

	constructor(length: number) {
		this._length = length;
		this._data = new Uint32Array(Math.ceil(length / 32));
	}

	get length(): number { return this._length; }

	get(index: number): boolean {
		const word = (index / 32) | 0;
		const bit = index % 32;
		return (this._data[word] & (1 << bit)) !== 0;
	}

	set(index: number, value: boolean): void {
		const word = (index / 32) | 0;
		const bit = index % 32;
		if (value) { this._data[word] |= (1 << bit); }
		else { this._data[word] &= ~(1 << bit); }
	}

	toggle(index: number): void { this.set(index, !this.get(index)); }
	clear(): void { this._data.fill(0); }
	count(): number {
		let c = 0;
		for (let i = 0; i < this._data.length; i++) {
			let v = this._data[i];
			v = v - ((v >> 1) & 0x55555555);
			v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
			c += ((v + (v >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
		}
		return c;
	}
}
