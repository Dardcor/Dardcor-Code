/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface TelemetryConfiguration {
		readonly isUsageEnabled: boolean;
		readonly isErrorsEnabled: boolean;
		readonly isCrashEnabled: boolean;
	}

	export namespace env {
		export const telemetryConfiguration: TelemetryConfiguration;

		export const onDidChangeTelemetryConfiguration: Event<TelemetryConfiguration | undefined>;
	}
}
