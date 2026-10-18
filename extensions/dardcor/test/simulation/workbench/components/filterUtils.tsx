/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { grepStrToRegex } from '../../shared/grepFilter';
import { ISimulationTest } from '../stores/simulationTestsProvider';
import { TestFilterer } from './testFilterer';

export type FilterPredicate = (test: ISimulationTest) => boolean;

export function createFilterer(predicates: FilterPredicate[]): TestFilterer {
	return {
		filter: (tests: readonly ISimulationTest[]) => {
			if (predicates.length === 0 || tests.length === 0) {
				return [...tests];
			}

			return tests.filter(test => predicates.every(predicate => predicate(test)));
		}
	};
}


const suiteSearchPrefix = /^!s:/;

export function createGrepFilter(grep: string): FilterPredicate {
	if (!grep || grep.trim() === '') {
		return () => true;
	}

	let trimmedGrep = grep.trim();
	const isSuiteNameSearch = trimmedGrep.startsWith('!s:');
	if (isSuiteNameSearch) {
		trimmedGrep = trimmedGrep.replace(suiteSearchPrefix, '');
	}
	const grepRegex = grepStrToRegex(trimmedGrep);

	return (test) => isSuiteNameSearch
		? grepRegex.test(test.suiteName)
		: grepRegex.test(test.name);
}

export function createBaselineChangedFilter(): FilterPredicate {
	return (test) => {
		if (test.runnerStatus === undefined || test.baselineJSON === undefined) {
			return false;
		}

		const canCompareWithBaseline = test.runnerStatus.expectedRuns === (
			test.baselineJSON.passCount +
			test.baselineJSON.failCount +
			test.baselineJSON.contentFilterCount
		);

		if (!canCompareWithBaseline) {
			return false;
		}

		const passCount = test.runnerStatus.runs.filter(r => r.pass).length;
		const changedByPassCount = passCount !== test.baselineJSON?.passCount;

		if (changedByPassCount) {
			return true;
		}

		const explicitScoreBasedTest = test.runnerStatus.runs.at(0)?.explicitScore !== undefined;
		if (explicitScoreBasedTest) {
			const expectedScore = test.baselineJSON.score.toFixed(2);
			const actualScore = (
				test.runnerStatus.runs.reduce((acc, run) => acc + (run.explicitScore ?? 0), 0) /
				test.runnerStatus.runs.length
			).toFixed(2);
			return expectedScore !== actualScore;
		}

		return changedByPassCount;
	};
}

export function createFailuresFilter(): FilterPredicate {
	return (test) => {
		return !!test.runnerStatus &&
			test.runnerStatus.runs.filter(r => r.pass).length < test.runnerStatus.expectedRuns;
	};
}

export function createCacheMissesFilter(): FilterPredicate {
	return (test) => !!test.runnerStatus && test.runnerStatus.runs.some(r => r.hasCacheMiss);
}

export function createRanTestsFilter(): FilterPredicate {
	return (test) => !!test.runnerStatus;
}

export function createResultTypeFilter(resultType: string | undefined): FilterPredicate {
	if (!resultType) {
		return () => true;
	}

	return (test) => {
		const passRate = test.runnerStatus?.runs.map<number>(r => r.pass ? 1 : 0).reduce((a, b) => a + b, 0);
		const baselinePassRate = test.baseline?.runs.map<number>(r => r.pass ? 1 : 0).reduce((a, b) => a + b, 0);

		switch (resultType) {
			case 'failures':
				return test.runnerStatus?.runs.some(r => !r.pass) ?? true;
			case 'regressions':
				return baselinePassRate !== undefined &&
					passRate !== undefined &&
					passRate < baselinePassRate;
			case 'improvements':
				return baselinePassRate !== undefined &&
					passRate !== undefined &&
					passRate > baselinePassRate;
			case 'differences':
				return baselinePassRate !== undefined &&
					passRate !== undefined &&
					passRate !== baselinePassRate;
			default:
				return true;
		}
	};
}

export function createLanguageFilter(languageId: string | undefined): FilterPredicate {
	if (!languageId) {
		return () => true;
	}

	return (test) => test.activeEditorLangId !== undefined &&
		test.activeEditorLangId === languageId;
}

export function createAnnotationFilter(selectedAnnotations: Set<string> | undefined): FilterPredicate {
	if (!selectedAnnotations || selectedAnnotations.size === 0) {
		return () => true;
	}

	return (test) => test.runnerStatus?.runs.some(
		r => r.annotations.some(a => selectedAnnotations.has(a.label))
	) === true;
}

export function createTestNameFilter(testName: string | undefined): FilterPredicate {
	return (test) => testName === undefined || test.name.includes(testName);
}
