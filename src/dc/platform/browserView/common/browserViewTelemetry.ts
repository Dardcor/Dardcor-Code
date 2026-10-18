/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryService } from '../../telemetry/common/telemetry.js';

export type IntegratedBrowserOpenSource =
	| 'cdpCreated'
	| 'chatTool'
	| 'commandWithoutUrl'
	| 'commandWithUrl'
	| 'quickOpenWithoutUrl'
	| 'quickOpenWithUrl'
	| 'newTabCommand'
	| 'localhostLinkOpener'
	| 'browserLinkForeground'
	| 'browserLinkBackground'
	| 'browserLinkNewWindow'
	| 'copyToNewWindow'
	| 'openFileCommand';

type IntegratedBrowserOpenEvent = {
	source: IntegratedBrowserOpenSource;
};

type IntegratedBrowserOpenClassification = {
	source: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'How the Integrated Browser was opened' };
	owner: 'jruales';
	comment: 'Tracks how users open the Integrated Browser';
};

export function logBrowserOpen(telemetryService: ITelemetryService, source: IntegratedBrowserOpenSource): void {
	telemetryService.publicLog2<IntegratedBrowserOpenEvent, IntegratedBrowserOpenClassification>(
		'integratedBrowser.open',
		{ source }
	);
}
