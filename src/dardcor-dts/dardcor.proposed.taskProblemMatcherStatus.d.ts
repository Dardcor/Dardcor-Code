/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


declare module 'vscode' {


	export interface TaskProblemMatcherStartedEvent {
		readonly execution: TaskExecution;
	}

	export interface TaskProblemMatcherEndedEvent {
		readonly execution: TaskExecution;

		readonly hasErrors: boolean;
	}

	export namespace tasks {

		export const onDidStartTaskProblemMatchers: Event<TaskProblemMatcherStartedEvent>;

		export const onDidEndTaskProblemMatchers: Event<TaskProblemMatcherEndedEvent>;
	}

}
