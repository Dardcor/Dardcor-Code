import { Disposable } from '../../core/lifecycle/disposable';

export interface IViewZone {
	readonly afterLineNumber: number;
	readonly heightInLines: number;
	readonly domNode: HTMLElement;
	readonly minWidthInPx?: number;
	readonly maxWidthInPx?: number;
	readonly suppressMouseDown?: boolean;
}

export interface IViewZoneInfo {
	readonly id: string;
	readonly zone: IViewZone;
	readonly top: number;
	readonly heightInPx: number;
}

export class ViewZones extends Disposable {
	private readonly _zones = new Map<string, IViewZone>();
	private readonly _offsets = new Map<string, number>();
	private _lineHeight = 19;
	private _maxAfterLineNumber = 0;

	public setLineHeight(lineHeight: number): void {
		this._lineHeight = Math.max(1, lineHeight);
		this.layoutChanged();
	}

	public getLineHeight(): number {
		return this._lineHeight;
	}

	public addZone(id: string, zone: IViewZone): void {
		this._zones.set(id, zone);
		this._maxAfterLineNumber = Math.max(this._maxAfterLineNumber, zone.afterLineNumber);
		this.layoutChanged();
	}

	public removeZone(id: string): boolean {
		const zone = this._zones.get(id);
		if (!zone) {
			return false;
		}
		zone.domNode.remove();
		this._zones.delete(id);
		this._offsets.delete(id);
		this._recomputeMaxAfterLineNumber();
		this.layoutChanged();
		return true;
	}

	public hasZone(id: string): boolean {
		return this._zones.has(id);
	}

	public getZone(id: string): IViewZone | undefined {
		return this._zones.get(id);
	}

	public getZones(): IViewZone[] {
		return Array.from(this._zones.values());
	}

	public getZoneIds(): string[] {
		return Array.from(this._zones.keys());
	}

	public getZoneCount(): number {
		return this._zones.size;
	}

	public layoutChanged(): void {
		this._offsets.clear();
		const sorted = Array.from(this._zones.entries())
			.sort((a, b) => a[1].afterLineNumber - b[1].afterLineNumber);
		let offset = 0;
		let currentLine = 1;
		for (const [id, zone] of sorted) {
			if (zone.afterLineNumber >= currentLine) {
				offset += (zone.afterLineNumber - currentLine + 1) * this._lineHeight;
				currentLine = zone.afterLineNumber + 1;
			}
			this._offsets.set(id, offset);
			offset += zone.heightInLines * this._lineHeight;
		}
	}

	public getZoneTop(id: string): number {
		return this._offsets.get(id) ?? 0;
	}

	public getZoneInfo(id: string): IViewZoneInfo | undefined {
		const zone = this._zones.get(id);
		if (!zone) {
			return undefined;
		}
		return {
			id,
			zone,
			top: this.getZoneTop(id),
			heightInPx: zone.heightInLines * this._lineHeight,
		};
	}

	public getTotalHeight(): number {
		let total = 0;
		for (const zone of this._zones.values()) {
			total += zone.heightInLines * this._lineHeight;
		}
		return total;
	}

	public getVerticalOffsetForLineNumber(lineNumber: number): number {
		let offset = (Math.max(1, lineNumber) - 1) * this._lineHeight;
		for (const [id, zone] of this._zones.entries()) {
			if (zone.afterLineNumber < lineNumber) {
				offset += zone.heightInLines * this._lineHeight;
			}
		}
		return offset;
	}

	public getLineNumberAtVerticalOffset(verticalOffset: number): number {
		const sorted = Array.from(this._zones.values())
			.sort((a, b) => a.afterLineNumber - b.afterLineNumber);
		let currentLine = 1;
		let remaining = Math.max(0, verticalOffset);
		for (const zone of sorted) {
			const linesBefore = zone.afterLineNumber - currentLine + 1;
			const heightBefore = linesBefore * this._lineHeight;
			if (remaining < heightBefore) {
				return currentLine + Math.floor(remaining / this._lineHeight);
			}
			remaining -= heightBefore;
			const zoneHeight = zone.heightInLines * this._lineHeight;
			if (remaining < zoneHeight) {
				return zone.afterLineNumber;
			}
			remaining -= zoneHeight;
			currentLine = zone.afterLineNumber + 1;
		}
		return currentLine + Math.floor(remaining / this._lineHeight);
	}

	public clear(): void {
		for (const zone of this._zones.values()) {
			zone.domNode.remove();
		}
		this._zones.clear();
		this._offsets.clear();
		this._maxAfterLineNumber = 0;
	}

	private _recomputeMaxAfterLineNumber(): void {
		let max = 0;
		for (const zone of this._zones.values()) {
			max = Math.max(max, zone.afterLineNumber);
		}
		this._maxAfterLineNumber = max;
	}
}
