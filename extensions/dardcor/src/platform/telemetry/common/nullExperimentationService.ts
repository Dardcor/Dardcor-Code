/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createServiceIdentifier } from '../../../util/common/services';
import { Emitter, Event } from '../../../util/dardcor/base/common/event';


export interface TreatmentsChangeEvent {

	affectedTreatmentVariables: string[];
}

export interface IExperimentationService {
	readonly _serviceBrand: undefined;

	onDidTreatmentsChange: Event<TreatmentsChangeEvent>;


	hasTreatments(): Promise<void>;

	getTreatmentVariable<T extends boolean | number | string>(name: string): T | undefined;

	setCompletionsFilters(filters: Map<string, string>): void;
}

export const IExperimentationService = createServiceIdentifier<IExperimentationService>('IExperimentationService');


export class NullExperimentationService implements IExperimentationService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidTreatmentsChange = new Emitter<TreatmentsChangeEvent>();
	readonly onDidTreatmentsChange = this._onDidTreatmentsChange.event;

	async hasTreatments(): Promise<void> { return Promise.resolve(); }
	async hasAccountBasedTreatments(): Promise<void> { return Promise.resolve(); }
	getTreatmentVariable<T extends boolean | number | string>(_name: string): T | undefined {
		return undefined;
	}

	async setCompletionsFilters(filters: Map<string, string>): Promise<void> { }
}
