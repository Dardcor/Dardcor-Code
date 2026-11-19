/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExperimentationTelemetryReporter } from '../experimentTelemetryReporter';

export interface TelemetryProperties {
	readonly [prop: string]: string | number | boolean | undefined;
}

export interface TelemetryReporter {
	logTelemetry(eventName: string, properties?: TelemetryProperties): void;
	logTraceEvent(tracePoint: string, correlationId: string, command?: string): void;
}

export class VSCodeTelemetryReporter implements TelemetryReporter {
	constructor(
		private readonly reporter: IExperimentationTelemetryReporter | undefined,
		private readonly clientVersionDelegate: () => string
	) { }

	public logTelemetry(eventName: string, properties: { [prop: string]: string } = {}) {
		const reporter = this.reporter;
		if (!reporter) {
			return;
		}

		properties['version'] = this.clientVersionDelegate();

		reporter.postEventObj(eventName, properties);
	}

	public logTraceEvent(point: string, traceId: string, data?: string): void {
		const event: { point: string; traceId: string; data?: string | undefined } = {
			point,
			traceId
		};
		if (data) {
			event.data = data;
		}

		this.logTelemetry('typeScriptExtension.trace', event);
	}
}
