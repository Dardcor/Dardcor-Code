import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { IPosition, IRange, Range } from './text-model.js';

export type MarkerSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface IMarker {
	readonly lineNumber: number;
	readonly startColumn: number;
	readonly endColumn: number;
	readonly severity: MarkerSeverity;
	readonly message?: string;
	readonly source?: string;
	readonly code?: string;
}

export interface IMarkerDecorationOptions {
	readonly range: Range;
	readonly className: string;
	readonly inlineClassName: string;
	readonly marker: IMarker;
}

export class MarkerDecorations extends Disposable {
	private _markers: IMarker[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	public setMarkers(markers: IMarker[]): void {
		this._markers = markers.slice().sort((a, b) => {
			if (a.lineNumber !== b.lineNumber) {
				return a.lineNumber - b.lineNumber;
			}
			return a.startColumn - b.startColumn;
		});
		this._onDidChange.fire();
	}

	public getMarkers(): IMarker[] {
		return this._markers.slice();
	}

	public getMarkersInRange(range: IRange): IMarker[] {
		return this._markers.filter(marker => {
			const markerRange = new Range(marker.lineNumber, marker.startColumn, marker.lineNumber, marker.endColumn);
			return Range.areIntersecting(markerRange, range);
		});
	}

	public getMarkerAtPosition(position: IPosition): IMarker | undefined {
		let best: IMarker | undefined;
		let bestSize = Number.MAX_SAFE_INTEGER;
		for (const marker of this._markers) {
			if (marker.lineNumber !== position.lineNumber) {
				continue;
			}
			if (position.column < marker.startColumn || position.column > marker.endColumn) {
				continue;
			}
			const size = marker.endColumn - marker.startColumn;
			if (size < bestSize) {
				best = marker;
				bestSize = size;
			}
		}
		return best;
	}

	public getDecorations(): IMarkerDecorationOptions[] {
		return this._markers.map(marker => ({
			range: new Range(marker.lineNumber, marker.startColumn, marker.lineNumber, marker.endColumn),
			className: MarkerDecorations.classNameForSeverity(marker.severity),
			inlineClassName: MarkerDecorations.inlineClassNameForSeverity(marker.severity),
			marker,
		}));
	}

	public getDecorationForMarker(marker: IMarker): IMarkerDecorationOptions {
		return {
			range: new Range(marker.lineNumber, marker.startColumn, marker.lineNumber, marker.endColumn),
			className: MarkerDecorations.classNameForSeverity(marker.severity),
			inlineClassName: MarkerDecorations.inlineClassNameForSeverity(marker.severity),
			marker,
		};
	}

	public getCount(): number {
		return this._markers.length;
	}

	public hasMarkers(): boolean {
		return this._markers.length > 0;
	}

	public clear(): void {
		if (this._markers.length === 0) {
			return;
		}
		this._markers = [];
		this._onDidChange.fire();
	}

	public static classNameForSeverity(severity: MarkerSeverity): string {
		switch (severity) {
			case 'error':
				return 'dc-marker-error';
			case 'warning':
				return 'dc-marker-warning';
			case 'info':
				return 'dc-marker-info';
			case 'hint':
				return 'dc-marker-hint';
		}
	}

	public static inlineClassNameForSeverity(severity: MarkerSeverity): string {
		return MarkerDecorations.classNameForSeverity(severity) + '-inline';
	}

	public static severityFromString(value: string): MarkerSeverity {
		const normalized = value.toLowerCase();
		if (normalized === 'error' || normalized === 'warning' || normalized === 'info' || normalized === 'hint') {
			return normalized;
		}
		return 'info';
	}
}
