/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GeneratorState } from '../generators/helpers';
import type { ArgumentParserResult } from '../../autocomplete-parser/parseArguments';
import type { Suggestion } from '../../shared/internal';
import type { Command } from '../../shell-parser';
import type { FigState } from '../fig/hooks';

export enum Visibility {
	VISIBLE = 'visible',
	HIDDEN_UNTIL_KEYPRESS = 'hidden_until_keypress',
	HIDDEN_UNTIL_SHOWN = 'hidden_until_shown',
	HIDDEN_BY_INSERTION = 'insertion',
}


export type AutocompleteState = {
	figState: FigState;
	parserResult: ArgumentParserResult;
	generatorStates: GeneratorState[];
	command: Command | null;

	visibleState: Visibility;
	lastInsertedSuggestion: Suggestion | null;
	justInserted: boolean;

	suggestions: Suggestion[];
	selectedIndex: number;
	hasChangedIndex: boolean;

	historyModeEnabled: boolean;
	userFuzzySearchEnabled: boolean;
	fuzzySearchEnabled: boolean;
};

export declare type NamedSetState<T> = {
	(
		name: string,
		partial: Partial<T> | ((s: T) => Partial<T>),
		replace?: boolean,
	): void;
};
