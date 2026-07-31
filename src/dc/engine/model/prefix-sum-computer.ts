export class PrefixSumComputer {
	private readonly _values: number[];
	private readonly _prefixSums: number[];

	constructor(values: number[]) {
		this._values = values.slice();
		this._prefixSums = new Array<number>(this._values.length + 1);
		this._recomputeFrom(0);
	}

	public getTotalValue(): number {
		return this._prefixSums[this._prefixSums.length - 1];
	}

	public getPrefixSum(index: number): number {
		const clamped = Math.max(0, Math.min(index, this._values.length));
		return this._prefixSums[clamped];
	}

	public getIndexOf(sum: number, indexHint: number = 0): number {
		const values = this._values;
		const prefixSums = this._prefixSums;
		if (values.length === 0) {
			return 0;
		}
		if (sum <= 0) {
			return 0;
		}
		const total = prefixSums[values.length];
		if (sum >= total) {
			return values.length - 1;
		}
		const hint = Math.max(0, Math.min(indexHint, values.length - 1));
		const hintPrefix = prefixSums[hint];
		if (hintPrefix > sum) {
			let low = 0;
			let high = hint - 1;
			while (low <= high) {
				const mid = (low + high) >> 1;
				if (prefixSums[mid + 1] > sum) {
					high = mid - 1;
				} else {
					low = mid + 1;
				}
			}
			return low;
		}
		let low = hint;
		let high = values.length - 1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (prefixSums[mid + 1] > sum) {
				high = mid - 1;
			} else {
				low = mid + 1;
			}
		}
		return low;
	}

	public setValue(index: number, value: number): void {
		const clamped = Math.max(0, Math.min(index, this._values.length - 1));
		if (this._values[clamped] === value) {
			return;
		}
		this._values[clamped] = value;
		this._recomputeFrom(clamped);
	}

	public setValues(values: number[]): void {
		this._values.length = 0;
		this._values.push(...values);
		this._prefixSums.length = values.length + 1;
		this._recomputeFrom(0);
	}

	public getValues(): number[] {
		return this._values.slice();
	}

	public getPrefixSums(): number[] {
		return this._prefixSums.slice();
	}

	public getCount(): number {
		return this._values.length;
	}

	public getLastIndexOf(sum: number): number {
		return this.getIndexOf(sum, this._values.length - 1);
	}

	private _recomputeFrom(index: number): void {
		const values = this._values;
		const prefixSums = this._prefixSums;
		let running = index === 0 ? 0 : prefixSums[index];
		prefixSums[index] = running;
		for (let i = index; i < values.length; i++) {
			running += values[i];
			prefixSums[i + 1] = running;
		}
	}
}

export class PrefixSumComputerWithCache {
	private readonly _computer: PrefixSumComputer;
	private _cachedSum: number | null = null;
	private _cachedHint: number = 0;
	private _cachedIndex: number = 0;

	constructor(values: number[]) {
		this._computer = new PrefixSumComputer(values);
	}

	public getTotalValue(): number {
		return this._computer.getTotalValue();
	}

	public getPrefixSum(index: number): number {
		return this._computer.getPrefixSum(index);
	}

	public getIndexOf(sum: number, indexHint: number = 0): number {
		if (this._cachedSum === sum && this._cachedHint === indexHint) {
			return this._cachedIndex;
		}
		const index = this._computer.getIndexOf(sum, indexHint);
		this._cachedSum = sum;
		this._cachedHint = indexHint;
		this._cachedIndex = index;
		return index;
	}

	public setValue(index: number, value: number): void {
		this._computer.setValue(index, value);
		this._cachedSum = null;
	}

	public setValues(values: number[]): void {
		this._computer.setValues(values);
		this._cachedSum = null;
	}

	public getValues(): number[] {
		return this._computer.getValues();
	}

	public getCount(): number {
		return this._computer.getCount();
	}
}
