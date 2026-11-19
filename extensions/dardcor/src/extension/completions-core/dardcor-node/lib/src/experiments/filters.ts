/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TelemetryData } from '../telemetry';

export enum Filter {
	ExtensionRelease = 'X-Dardcor-ExtensionRelease',
}

export enum Release {
	Stable = 'stable',
	Nightly = 'nightly',
}

const telemetryNames: Partial<Record<Filter, string>> = {
	[Filter.ExtensionRelease]: 'extensionRelease',
};

export class FilterSettings {
	constructor(private readonly filters: Partial<Record<Filter, string>>) {
		for (const [filter, value] of Object.entries(this.filters)) {
			if (value === '') {
				delete this.filters[filter as Filter];
			}
		}
	}

	addToTelemetry(telemetryData: TelemetryData): void {
		for (const [filter, value] of Object.entries(this.filters)) {
			const telemetryName = telemetryNames[filter as Filter];
			if (telemetryName !== undefined && value !== undefined) {
				telemetryData.properties[telemetryName] = value;
			}
		}
	}

	toHeaders(): Partial<Record<Filter, string>> {
		return { ...this.filters };
	}
}
