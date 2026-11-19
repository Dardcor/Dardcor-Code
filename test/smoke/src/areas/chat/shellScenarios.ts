/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export function shellEchoScenario(reply: string): unknown {
	return {
		type: 'multi-turn',
		turns: [
			{
				kind: 'tool-calls',
				toolCalls: [
					{
						toolNamePattern: /^(bash|pwsh|powershell)$/i,
						arguments: { command: `echo ${reply}` },
					},
				],
			},
			{ kind: 'echo-last-message' },
		],
	};
}

export function runInTerminalScenario(reply: string): unknown {
	return {
		type: 'multi-turn',
		turns: [
			{
				kind: 'tool-calls',
				toolCalls: [
					{
						toolNamePattern: /^run_in_terminal$/,
						arguments: {
							command: `echo ${reply}`,
							explanation: 'Smoke test echo to verify run_in_terminal',
							goal: 'Echo a marker to verify terminal execution',
							mode: 'sync',
						},
					},
				],
			},
			{ kind: 'echo-last-message' },
		],
	};
}

export function shellEchoResponseMatcher(reply: string): RegExp {
	return new RegExp(`(?:"|\\n|\\\\n)${reply}`);
}
