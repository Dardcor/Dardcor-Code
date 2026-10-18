/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../../../util/dardcor/base/common/lifecycle';
import { ServicesAccessor } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { IExperimentationService } from '../../../../../../platform/telemetry/common/nullExperimentationService';
import { BuildInfo, BuildType } from '../config';
import { Filter, Release } from './filters';

export function setupCompletionsExperimentationService(accessor: ServicesAccessor): IDisposable {
	updateCompletionsFilters(accessor);
	return { dispose() { } };
}

function getPluginRelease(): Release {
	return BuildInfo.getBuildType() === BuildType.NIGHTLY ? Release.Nightly : Release.Stable;
}

function updateCompletionsFilters(accessor: ServicesAccessor): void {
	accessor.get(IExperimentationService).setCompletionsFilters(createCompletionsFilters());
}

export function createCompletionsFilters(): Map<Filter, string> {
	const filters = new Map<Filter, string>();
	filters.set(Filter.ExtensionRelease, getPluginRelease());
	return filters;
}
