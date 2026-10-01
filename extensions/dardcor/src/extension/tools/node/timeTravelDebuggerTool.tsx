/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { LanguageModelTextPart, LanguageModelToolResult, MarkdownString } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

export interface ITimeTravelDebuggerParams {
	action: 'inspect_session' | 'evaluate_expression' | 'set_probe' | 'clear_probes';
	expression?: string;
	filePath?: string;
	lineNumber?: number;
	condition?: string;
	frameId?: number;
	description: string;
}

export class TimeTravelDebuggerTool implements ICopilotTool<ITimeTravelDebuggerParams> {
	public static toolName = ToolName.TimeTravelDebugger;

	private static activeProbes: vscode.Breakpoint[] = [];

	constructor(
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ITimeTravelDebuggerParams>, token: vscode.CancellationToken) {
		const { action, expression, filePath, lineNumber, condition, frameId } = options.input;
		const activeSession = vscode.debug.activeDebugSession;

		switch (action) {
			case 'inspect_session': {
				if (!activeSession) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart(
							`[Neuro-Trace Time-Travel Debugger: Idle]\nNo active debug session found.\n` +
							`Active Breakpoints/Probes: ${TimeTravelDebuggerTool.activeProbes.length}\n` +
							`Tip: Launch the debug configuration or npm run dev via launch.json to attach runtime memory inspection.`
						)
					]);
				}

				try {
					// DAP request to get threads
					const threadsResponse = await activeSession.customRequest('threads');
					const threads = threadsResponse?.threads ?? [];
					const sessionInfo = {
						sessionName: activeSession.name,
						sessionType: activeSession.type,
						threadCount: threads.length,
						threads: threads.slice(0, 5)
					};

					return new LanguageModelToolResult([
						new LanguageModelTextPart(
							`[Neuro-Trace Time-Travel Debugger: Active Session]\n` +
							JSON.stringify(sessionInfo, null, 2)
						)
					]);
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					return new LanguageModelToolResult([
						new LanguageModelTextPart(
							`[Neuro-Trace Time-Travel Debugger]\nActive Session: ${activeSession.name} (${activeSession.type})\nDAP Thread Inspection Note: ${message}`
						)
					]);
				}
			}

			case 'evaluate_expression': {
				if (!activeSession) {
					throw new Error(`Cannot evaluate expression: No active debug session attached.`);
				}
				if (!expression) {
					throw new Error(`Expression parameter is required for action 'evaluate_expression'.`);
				}

				try {
					const evalResult = await activeSession.customRequest('evaluate', {
						expression,
						frameId,
						context: 'hover'
					});

					return new LanguageModelToolResult([
						new LanguageModelTextPart(
							`[Neuro-Trace Memory Evaluation Result]\n` +
							`Expression: ${expression}\n` +
							`Type: ${evalResult?.type ?? 'unknown'}\n` +
							`Value: ${evalResult?.result ?? 'undefined'}\n` +
							`Variables Reference: ${evalResult?.variablesReference ?? 0}`
						)
					]);
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`[Neuro-Trace Memory Evaluation Failed]\nError: ${message}`)
					]);
				}
			}

			case 'set_probe': {
				if (!filePath || lineNumber === undefined) {
					throw new Error(`filePath and lineNumber are required to set a runtime probe.`);
				}
				const uri = this.promptPathRepresentationService.resolveFilePath(filePath);
				if (!uri) {
					throw new Error(`Invalid file path for probe: ${filePath}`);
				}

				const location = new vscode.Location(uri, new vscode.Position(lineNumber - 1, 0));
				const probeBreakpoint = new vscode.SourceBreakpoint(
					location,
					true,
					condition,
					undefined,
					`[Neuro-Probe] ${expression ?? 'Tick Log'}`
				);

				vscode.debug.addBreakpoints([probeBreakpoint]);
				TimeTravelDebuggerTool.activeProbes.push(probeBreakpoint);

				return new LanguageModelToolResult([
					new LanguageModelTextPart(
						`[Neuro-Trace Probe Injected]\nFile: ${this.promptPathRepresentationService.getFilePath(uri)}:${lineNumber}\nCondition: ${condition ?? 'Unconditional'}\nTotal Active Probes: ${TimeTravelDebuggerTool.activeProbes.length}`
					)
				]);
			}

			case 'clear_probes': {
				if (TimeTravelDebuggerTool.activeProbes.length > 0) {
					vscode.debug.removeBreakpoints(TimeTravelDebuggerTool.activeProbes);
					const count = TimeTravelDebuggerTool.activeProbes.length;
					TimeTravelDebuggerTool.activeProbes = [];
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`Cleared ${count} active memory probes.`)
					]);
				}
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`No active memory probes to clear.`)
				]);
			}
		}
	}

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ITimeTravelDebuggerParams>, token: vscode.CancellationToken): Promise<vscode.PreparedToolInvocation> {
		return {
			presentation: undefined,
			invocationMessage: new MarkdownString(`Executing Neuro-Trace Debugger: **${options.input.action}**`),
			pastTenseMessage: new MarkdownString(`Executed Neuro-Trace Debugger: **${options.input.action}**`)
		};
	}
}

ToolRegistry.registerTool(TimeTravelDebuggerTool);
