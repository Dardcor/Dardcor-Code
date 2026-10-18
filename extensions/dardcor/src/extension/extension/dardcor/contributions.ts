/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NesActivationTelemetryContribution } from '../../../platform/inlineEdits/common/nesActivationStatusTelemetry.contribution';
import { asContributionFactory, IExtensionContributionFactory } from '../../common/contributions';
import * as contextContribution from '../../context/dardcor/context.contribution';
import { LifecycleTelemetryContrib } from '../../telemetry/common/lifecycleTelemetryContrib';
import { GithubTelemetryForwardingContrib } from '../../telemetry/dardcor/githubTelemetryForwardingContrib';


const vscodeContributions: IExtensionContributionFactory[] = [
	asContributionFactory(LifecycleTelemetryContrib),
	asContributionFactory(NesActivationTelemetryContribution),
	asContributionFactory(GithubTelemetryForwardingContrib),
	contextContribution,
];

export default vscodeContributions;
