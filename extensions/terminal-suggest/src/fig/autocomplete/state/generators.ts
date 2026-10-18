/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getScriptSuggestions } from '../generators/scriptSuggestionsGenerator';
import { AutocompleteState } from './types';
import { GeneratorState, GeneratorContext } from '../generators/helpers';
import { sleep } from '../../shared/utils';
import type { ArgumentParserResult } from '../../autocomplete-parser/parseArguments';
import { getCustomSuggestions } from '../generators/customSuggestionsGenerator';
import { IFigExecuteExternals } from '../../execute';

export const shellContextSelector = ({
	figState,
}: AutocompleteState): Fig.ShellContext => ({
	currentWorkingDirectory: figState.cwd || '',
	currentProcess: figState.processUserIsIn || '',
	environmentVariables: figState.environmentVariables,
	sshPrefix: '',
});

const getGeneratorContext = (state: AutocompleteState): GeneratorContext => {
	const { command, parserResult } = state;
	const { currentArg, searchTerm, annotations, commandIndex } = parserResult;
	const tokens = command?.tokens ?? [];
	return {
		...shellContextSelector(state),
		annotations: annotations.slice(commandIndex),
		tokenArray: tokens.slice(commandIndex).map((token: any) => token.text),
		isDangerous: Boolean(currentArg?.isDangerous),
		searchTerm,
	};
};

export const createGeneratorState = (
	state: AutocompleteState,
	executeExternals?: IFigExecuteExternals
): {
	triggerGenerators: (result: ArgumentParserResult, executeExternals: IFigExecuteExternals) => GeneratorState[];
} => {


	const triggerGenerator = (currentState: GeneratorState, executeExternals: IFigExecuteExternals) => {
		const { generator, context } = currentState;
		let request: Promise<Fig.Suggestion[] | undefined>;

		if (generator.template) {
			request = Promise.resolve(undefined);
		}
		else if (generator.script) {
			request = getScriptSuggestions(
				generator,
				context,
				undefined,
				executeExternals
			);
		}
		else {
			request = getCustomSuggestions(generator, context, executeExternals);
		}
		return { ...currentState, loading: true, request };
	};

	const triggerGenerators = (
		parserResult: ArgumentParserResult,
		executeExternals: IFigExecuteExternals,
	): GeneratorState[] => {
		const {
			parserResult: { currentArg: previousArg, searchTerm: previousSearchTerm },
		} = state;
		const { currentArg, searchTerm } = parserResult;
		const generators = currentArg?.generators ?? [];
		const context = getGeneratorContext({ ...state, parserResult });

		return generators.map((generator: Fig.Generator, index: number) => {
			const { trigger } = generator;
			const previousGeneratorState = state.generatorStates[index];
			let shouldTrigger = false;
			if (!previousGeneratorState || currentArg !== previousArg) {
				shouldTrigger = true;
			} else if (trigger === undefined) {
				shouldTrigger = Boolean(currentArg?.debounce);
			} else {
				let triggerFn: (a: string, b: string) => boolean;
				if (typeof trigger === 'string') {
					triggerFn = (a, b) =>
						a.lastIndexOf(trigger) !== b.lastIndexOf(trigger);
				} else if (typeof trigger === 'function') {
					triggerFn = trigger;
				} else {
					switch (trigger.on) {
						case 'threshold': {
							triggerFn = (a, b) =>
								a.length > trigger.length && !(b.length > trigger.length);
							break;
						}
						case 'match': {
							const strings =
								typeof trigger.string === 'string'
									? [trigger.string]
									: trigger.string;
							triggerFn = (a, b) =>
								strings.findIndex((x) => x === a) !==
								strings.findIndex((x) => x === b);
							break;
						}
						case 'change':
						default: {
							triggerFn = (a, b) => a !== b;
							break;
						}
					}
				}
				try {
					shouldTrigger = triggerFn(searchTerm, previousSearchTerm);
				} catch (_err) {
					shouldTrigger = true;
				}
			}

			if (!shouldTrigger) {
				return previousGeneratorState;
			}

			const result = previousGeneratorState?.result || [];
			const generatorState = { generator, context, result, loading: true };

			const getTriggeredState = () => triggerGenerator(generatorState, executeExternals);
			if (currentArg?.debounce) {
				sleep(
					typeof currentArg.debounce === 'number' && currentArg.debounce > 0
						? currentArg.debounce
						: 200,
				);
				return generatorState;
			}
			return getTriggeredState();
		});
	};
	return { triggerGenerators };
};
