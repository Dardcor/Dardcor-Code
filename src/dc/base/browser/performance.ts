/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { observableValue } from '../common/observable.js';

export namespace inputLatency {

	interface ICumulativeMeasurement {
		total: number;
		min: number;
		max: number;
	}
	const totalKeydownTime: ICumulativeMeasurement = { total: 0, min: Number.MAX_VALUE, max: 0 };
	const totalInputTime: ICumulativeMeasurement = { ...totalKeydownTime };
	const totalRenderTime: ICumulativeMeasurement = { ...totalKeydownTime };
	const totalInputLatencyTime: ICumulativeMeasurement = { ...totalKeydownTime };
	let measurementsCount = 0;



	export const sampleCount = observableValue('inputLatency.sampleCount', 0);

	const enum EventPhase {
		Before = 0,
		InProgress = 1,
		Finished = 2
	}
	const state = {
		keydown: EventPhase.Before,
		input: EventPhase.Before,
		render: EventPhase.Before,
	};

	export function onKeyDown() {
		recordIfFinished();
		performance.mark('inputlatency/start');
		performance.mark('keydown/start');
		state.keydown = EventPhase.InProgress;
		queueMicrotask(markKeyDownEnd);
	}

	function markKeyDownEnd() {
		if (state.keydown === EventPhase.InProgress) {
			performance.mark('keydown/end');
			state.keydown = EventPhase.Finished;
		}
	}

	export function onBeforeInput() {
		performance.mark('input/start');
		state.input = EventPhase.InProgress;
		scheduleRecordIfFinishedTask();
	}

	export function onInput() {
		if (state.input === EventPhase.Before) {
			onBeforeInput();
		}
		queueMicrotask(markInputEnd);
	}

	function markInputEnd() {
		if (state.input === EventPhase.InProgress) {
			performance.mark('input/end');
			state.input = EventPhase.Finished;
		}
	}

	export function onKeyUp() {
		recordIfFinished();
	}

	export function onSelectionChange() {
		recordIfFinished();
	}

	export function onRenderStart() {
		if (state.keydown === EventPhase.Finished && state.input === EventPhase.Finished && state.render === EventPhase.Before) {
			performance.mark('render/start');
			state.render = EventPhase.InProgress;
			queueMicrotask(markRenderEnd);
			scheduleRecordIfFinishedTask();
		}
	}

	function markRenderEnd() {
		if (state.render === EventPhase.InProgress) {
			performance.mark('render/end');
			state.render = EventPhase.Finished;
		}
	}

	function scheduleRecordIfFinishedTask() {
		setTimeout(recordIfFinished);
	}

	function recordIfFinished() {
		if (state.keydown === EventPhase.Finished && state.input === EventPhase.Finished && state.render === EventPhase.Finished) {
			performance.mark('inputlatency/end');

			performance.measure('keydown', 'keydown/start', 'keydown/end');
			performance.measure('input', 'input/start', 'input/end');
			performance.measure('render', 'render/start', 'render/end');
			performance.measure('inputlatency', 'inputlatency/start', 'inputlatency/end');

			addMeasure('keydown', totalKeydownTime);
			addMeasure('input', totalInputTime);
			addMeasure('render', totalRenderTime);
			addMeasure('inputlatency', totalInputLatencyTime);


			measurementsCount++;
			sampleCount.set(sampleCount.get() + 1, undefined);

			reset();
		}
	}

	function addMeasure(entryName: string, cumulativeMeasurement: ICumulativeMeasurement): void {
		const duration = performance.getEntriesByName(entryName)[0].duration;
		cumulativeMeasurement.total += duration;
		cumulativeMeasurement.min = Math.min(cumulativeMeasurement.min, duration);
		cumulativeMeasurement.max = Math.max(cumulativeMeasurement.max, duration);
	}

	function reset() {
		performance.clearMarks('keydown/start');
		performance.clearMarks('keydown/end');
		performance.clearMarks('input/start');
		performance.clearMarks('input/end');
		performance.clearMarks('render/start');
		performance.clearMarks('render/end');
		performance.clearMarks('inputlatency/start');
		performance.clearMarks('inputlatency/end');

		performance.clearMeasures('keydown');
		performance.clearMeasures('input');
		performance.clearMeasures('render');
		performance.clearMeasures('inputlatency');

		state.keydown = EventPhase.Before;
		state.input = EventPhase.Before;
		state.render = EventPhase.Before;
	}

	export interface IInputLatencyMeasurements {
		keydown: IInputLatencySingleMeasurement;
		input: IInputLatencySingleMeasurement;
		render: IInputLatencySingleMeasurement;
		total: IInputLatencySingleMeasurement;
		sampleCount: number;
	}

	export interface IInputLatencySingleMeasurement {
		average: number;
		min: number;
		max: number;
	}

	export function getAndClearMeasurements(): IInputLatencyMeasurements | undefined {
		if (measurementsCount === 0) {
			return undefined;
		}

		const result = {
			keydown: cumulativeToFinalMeasurement(totalKeydownTime),
			input: cumulativeToFinalMeasurement(totalInputTime),
			render: cumulativeToFinalMeasurement(totalRenderTime),
			total: cumulativeToFinalMeasurement(totalInputLatencyTime),
			sampleCount: measurementsCount
		};

		clearCumulativeMeasurement(totalKeydownTime);
		clearCumulativeMeasurement(totalInputTime);
		clearCumulativeMeasurement(totalRenderTime);
		clearCumulativeMeasurement(totalInputLatencyTime);
		measurementsCount = 0;

		return result;
	}

	function cumulativeToFinalMeasurement(cumulative: ICumulativeMeasurement): IInputLatencySingleMeasurement {
		return {
			average: cumulative.total / measurementsCount,
			max: cumulative.max,
			min: cumulative.min,
		};
	}

	function clearCumulativeMeasurement(cumulative: ICumulativeMeasurement): void {
		cumulative.total = 0;
		cumulative.min = Number.MAX_VALUE;
		cumulative.max = 0;
	}

}
