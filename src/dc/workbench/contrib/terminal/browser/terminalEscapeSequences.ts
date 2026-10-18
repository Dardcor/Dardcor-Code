/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const enum ShellIntegrationOscPs {
	FinalTerm = 133,
	VSCode = 633,
	ITerm = 1337
}

export const enum VSCodeOscPt {
	PromptStart = 'A',

	CommandStart = 'B',

	CommandExecuted = 'C',

	CommandFinished = 'D',

	CommandLine = 'E',

	ContinuationStart = 'F',

	ContinuationEnd = 'G',

	RightPromptStart = 'H',

	RightPromptEnd = 'I',

	Property = 'P'
}

export const enum VSCodeOscProperty {
	Task = 'Task',
	Cwd = 'Cwd',
	HasRichCommandDetection = 'HasRichCommandDetection',
}

export const enum ITermOscPt {
	SetMark = 'SetMark'
}

export function VSCodeSequence(osc: VSCodeOscPt, data?: string | VSCodeOscProperty): string {
	return oscSequence(ShellIntegrationOscPs.VSCode, osc, data);
}

export function ITermSequence(osc: ITermOscPt, data?: string): string {
	return oscSequence(ShellIntegrationOscPs.ITerm, osc, data);
}

function oscSequence(ps: number, pt: string, data?: string): string {
	let result = `\x1b]${ps};${pt}`;
	if (data) {
		result += `;${data}`;
	}
	result += `\x07`;
	return result;

}
