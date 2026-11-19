export class LineRange {

}

export class RangeMapping {

}




export class LineRangeMapping {



	public readonly originalRange: LineRange;




	public readonly modifiedRange: LineRange;







	public readonly innerChanges: RangeMapping[];

	constructor(
		originalRange: LineRange,
		modifiedRange: LineRange,
		innerChanges: RangeMapping[] | undefined,
	) {
		this.originalRange = originalRange;
		this.modifiedRange = modifiedRange;
		this.innerChanges = innerChanges;
	}

	public toString(): string {
		return `{${this.originalRange.toString()}->${this.modifiedRange.toString()}}`;
	}
}
