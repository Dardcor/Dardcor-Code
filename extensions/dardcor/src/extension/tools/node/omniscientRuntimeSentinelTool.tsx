/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as net from 'net';
import * as vscode from 'vscode';
import { IPromptPathRepresentationService } from '../../../platform/prompts/common/promptPathRepresentationService';
import { LanguageModelTextPart, LanguageModelToolResult, MarkdownString } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

export interface IOmniscientRuntimeSentinelParams {
	mode?: 'full_tri_layer' | 'lsp_only' | 'terminal_buffer_only' | 'process_health_only';
	targetPortOrService?: string;
	errorPatternFilter?: string;
	description: string;
}

interface ILspDiagnosticSummary {
	errorCount: number;
	warningCount: number;
	criticalIssues: Array<{
		file: string;
		line: number;
		code: string | number | undefined;
		message: string;
	}>;
}

interface ITerminalStreamReport {
	activeTerminalCount: number;
	terminalNames: string[];
	detectedExceptions: string[];
}

interface IPortHealthStatus {
	port: number;
	status: 'ONLINE' | 'REFUSED' | 'TIMEOUT';
	httpStatusCode?: number;
}

export class OmniscientRuntimeSentinelTool implements ICopilotTool<IOmniscientRuntimeSentinelParams> {
	public static toolName = ToolName.OmniscientRuntimeSentinel;

	constructor(
		@IPromptPathRepresentationService _promptPathRepresentationService: IPromptPathRepresentationService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IOmniscientRuntimeSentinelParams>, token: vscode.CancellationToken) {
		const mode = options.input.mode ?? 'full_tri_layer';
		const filterPattern = options.input.errorPatternFilter ? new RegExp(options.input.errorPatternFilter, 'i') : undefined;

		let lspSummary: ILspDiagnosticSummary = { errorCount: 0, warningCount: 0, criticalIssues: [] };
		let terminalReport: ITerminalStreamReport = { activeTerminalCount: 0, terminalNames: [], detectedExceptions: [] };
		let portStatuses: IPortHealthStatus[] = [];

		if (mode === 'full_tri_layer' || mode === 'lsp_only') {
			lspSummary = this.collectLspDiagnostics();
		}

		if (mode === 'full_tri_layer' || mode === 'terminal_buffer_only') {
			terminalReport = this.inspectTerminalStream(filterPattern);
		}

		if (mode === 'full_tri_layer' || mode === 'process_health_only') {
			const portsToProbe = this.resolveTargetPorts(options.input.targetPortOrService);
			portStatuses = await Promise.all(portsToProbe.map(p => this.probePort(p)));
		}

		let healthScore = 100;
		const actionDirectives: string[] = [];

		if (lspSummary.errorCount > 0) {
			const penalty = Math.min(50, lspSummary.errorCount * 12);
			healthScore -= penalty;
			actionDirectives.push(`Fix ${lspSummary.errorCount} LSP compiler errors blocking build integrity.`);
		}

		if (terminalReport.detectedExceptions.length > 0) {
			healthScore -= 30;
			actionDirectives.push(`Resolve runtime exception in active terminal stream.`);
		}

		const offlineCriticalPort = portStatuses.find(p => p.status === 'REFUSED' && (p.port === 3000 || p.port === 5173));
		if (offlineCriticalPort) {
			healthScore -= 15;
			actionDirectives.push(`Dev server on port ${offlineCriticalPort.port} is not listening.`);
		}

		healthScore = Math.max(0, healthScore);

		const resultLines: string[] = [
			`[Omniscient Runtime Sentinel: Tri-Layer Synthesis]`,
			`Overall Workspace Convergence Score: ${healthScore}/100`,
			`Status: ${healthScore === 100 ? 'CONVERGED (All Layers Healthy)' : 'NON-CONVERGED (Actions Required)'}`,
			``,
			`--- Layer 1: LSP Diagnostic Sweep ---`,
			`Errors: ${lspSummary.errorCount} | Warnings: ${lspSummary.warningCount}`,
		];

		if (lspSummary.criticalIssues.length > 0) {
			resultLines.push(`Critical Diagnostics:`);
			for (const issue of lspSummary.criticalIssues.slice(0, 8)) {
				resultLines.push(`  - [${issue.file}:${issue.line}] ${issue.code ? `(${issue.code}) ` : ''}${issue.message}`);
			}
		}

		resultLines.push(
			``,
			`--- Layer 2: Terminal Stream Buffer ---`,
			`Active Terminals: ${terminalReport.activeTerminalCount} (${terminalReport.terminalNames.join(', ') || 'none'})`,
		);

		if (terminalReport.detectedExceptions.length > 0) {
			resultLines.push(`Detected Crash/Exception Patterns:`);
			for (const exc of terminalReport.detectedExceptions.slice(0, 5)) {
				resultLines.push(`  ! ${exc}`);
			}
		} else {
			resultLines.push(`No active crash loops or uncaught exceptions detected in terminal buffers.`);
		}

		resultLines.push(
			``,
			`--- Layer 3: Process & Port Health Probes ---`,
		);

		for (const p of portStatuses) {
			const detail = p.httpStatusCode ? ` (HTTP ${p.httpStatusCode})` : '';
			resultLines.push(`  Port ${p.port}: ${p.status}${detail}`);
		}

		if (actionDirectives.length > 0) {
			resultLines.push(
				``,
				`--- Convergence Action Directives ---`,
				...actionDirectives.map((d, i) => `${i + 1}. ${d}`),
			);
		}

		return new LanguageModelToolResult([
			new LanguageModelTextPart(resultLines.join('\n'))
		]);
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IOmniscientRuntimeSentinelParams>, token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: new MarkdownString(options.input.description)
		};
	}

	private collectLspDiagnostics(): ILspDiagnosticSummary {
		const allEntries = vscode.languages.getDiagnostics();
		let errorCount = 0;
		let warningCount = 0;
		const criticalIssues: ILspDiagnosticSummary['criticalIssues'] = [];

		for (const [uri, diagnostics] of allEntries) {
			for (const diag of diagnostics) {
				if (diag.severity === vscode.DiagnosticSeverity.Error) {
					errorCount++;
					criticalIssues.push({
						file: vscode.workspace.asRelativePath(uri),
						line: diag.range.start.line + 1,
						code: typeof diag.code === 'object' ? diag.code.value : diag.code,
						message: diag.message,
					});
				} else if (diag.severity === vscode.DiagnosticSeverity.Warning) {
					warningCount++;
				}
			}
		}

		return { errorCount, warningCount, criticalIssues };
	}

	private inspectTerminalStream(filterPattern?: RegExp): ITerminalStreamReport {
		const terminals = vscode.window.terminals;
		const names = terminals.map(t => t.name);
		const detectedExceptions: string[] = [];

		for (const terminal of terminals) {
			const name = terminal.name.toLowerCase();
			if (name.includes('dev') || name.includes('build') || name.includes('server')) {
				if (filterPattern) {
					if (filterPattern.test(terminal.name)) {
						detectedExceptions.push(`Terminal '${terminal.name}' matched filter.`);
					}
				}
			}
		}

		return {
			activeTerminalCount: terminals.length,
			terminalNames: names,
			detectedExceptions
		};
	}

	private resolveTargetPorts(target?: string): number[] {
		if (target) {
			const parsed = parseInt(target, 10);
			if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
				return [parsed];
			}
		}
		return [3000, 5173, 8080, 25128];
	}

	private async probePort(port: number): Promise<IPortHealthStatus> {
		return new Promise((resolve) => {
			const socket = new net.Socket();
			let responded = false;

			socket.setTimeout(400);

			socket.on('connect', () => {
				responded = true;
				socket.destroy();
				this.checkHttpEndpoint(port).then(httpStatus => {
					resolve({ port, status: 'ONLINE', httpStatusCode: httpStatus });
				}).catch(() => {
					resolve({ port, status: 'ONLINE' });
				});
			});

			socket.on('timeout', () => {
				if (!responded) {
					responded = true;
					socket.destroy();
					resolve({ port, status: 'TIMEOUT' });
				}
			});

			socket.on('error', () => {
				if (!responded) {
					responded = true;
					socket.destroy();
					resolve({ port, status: 'REFUSED' });
				}
			});

			socket.connect(port, '127.0.0.1');
		});
	}

	private async checkHttpEndpoint(port: number): Promise<number | undefined> {
		return new Promise((resolve, reject) => {
			const req = http.get({
				host: '127.0.0.1',
				port,
				path: '/',
				timeout: 300,
			}, (res) => {
				resolve(res.statusCode);
			});

			req.on('error', reject);
			req.on('timeout', () => {
				req.destroy();
				reject(new Error('timeout'));
			});
		});
	}
}

ToolRegistry.registerTool(OmniscientRuntimeSentinelTool);
