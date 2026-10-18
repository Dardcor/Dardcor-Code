/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DardcorTelemetryReporter } from '../telemetry';

export class NoopDardcorTelemetryReporter implements DardcorTelemetryReporter {
	sendTelemetryEvent(): void {
	}
	sendTelemetryErrorEvent(): void {
	}
	dispose(): Promise<void> {
		return Promise.resolve();
	}
}
