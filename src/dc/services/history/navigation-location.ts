/**
 * Dardcor Code - Navigation Location Marker (Task 195)
 * Mirrors: vs/workbench/services/history/common/history.ts navigation marker
 */

import { URI } from '../../core/types/uri';

export interface INavigationLocation {
	readonly resource: URI;
	readonly lineNumber: number;
	readonly column: number;
	readonly label?: string;
}

export function createNavigationLocation(resource: URI, lineNumber = 1, column = 1, label?: string): INavigationLocation {
	return { resource, lineNumber, column, label };
}

export function areSameLocation(a: INavigationLocation, b: INavigationLocation): boolean {
	return a.resource.toString() === b.resource.toString() &&
		a.lineNumber === b.lineNumber &&
		a.column === b.column;
}
