/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { isGpt55 } from '../../../platform/endpoint/common/chatModelCapabilities';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { DardcorChatAttr, emitToolCallEvent, GenAiAttr, GenAiMetrics, GenAiOperationName, GenAiToolType, StdAttr, truncateForOTel } from '../../../platform/otel/common/index';
import { IOTelService, SpanKind, SpanStatusCode } from '../../../platform/otel/common/otelService';
import { extractToolParameters } from '../../../platform/otel/node/extractToolParameters';
import { getCurrentCapturingToken } from '../../../platform/requestLogger/node/requestLogger';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { equals as arraysEqual } from '../../../util/dardcor/base/common/arrays';
import { Iterable } from '../../../util/dardcor/base/common/iterator';
import { Lazy } from '../../../util/dardcor/base/common/lazy';
import { isDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { autorunIterableDelta } from '../../../util/dardcor/base/common/observableInternal';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { getContributedToolName, getToolName, mapContributedToolNamesInSchema, mapContributedToolNamesInString, ToolName } from '../common/toolNames';
import { IAgentTool, IAgentToolExtension, modelSpecificToolApplies, ToolRegistry } from '../common/toolsRegistry';
import { BaseToolsService } from '../common/toolsService';

export class ToolsService extends BaseToolsService {
	declare _serviceBrand: undefined;

	private readonly _dardcorTools: Lazy<Map<ToolName, IAgentTool<unknown>>>;

	private readonly _toolExtensions: Lazy<Map<ToolName, IAgentToolExtension<unknown>>>;

	private _connectedModelSpecificTools = false;

	override get modelSpecificTools() {
		this.getModelSpecificTools();
		return super.modelSpecificTools;
	}

	private readonly _contributedToolCache: {
		input: readonly vscode.LanguageModelToolInformation[];
		output: readonly vscode.LanguageModelToolInformation[];
	} = { input: [], output: [] };

	get tools(): ReadonlyArray<vscode.LanguageModelToolInformation> {
		const tools = vscode.lm.tools;
		if (arraysEqual(this._contributedToolCache.input, tools)) {
			return this._contributedToolCache.output;
		}
		const input = [...tools];
		const contributedTools = [...input]
			.sort((a, b) => {
				const aIsBuiltin = a.name.startsWith('vscode_') || a.name.startsWith('dardcor_');
				const bIsBuiltin = b.name.startsWith('vscode_') || b.name.startsWith('dardcor_');
				if (aIsBuiltin && bIsBuiltin) {
					return a.name.localeCompare(b.name);
				} else if (!aIsBuiltin && !bIsBuiltin) {
					return a.name.localeCompare(b.name);
				}

				return aIsBuiltin ? -1 : 1;
			})
			.map(tool => {
				const owned = this.getAgentTool(getToolName(tool.name));
				return owned?.alternativeDefinition?.(tool) ?? tool;
			});

		const result: vscode.LanguageModelToolInformation[] = contributedTools.map(tool => {
			return {
				...tool,
				name: getToolName(tool.name),
				description: mapContributedToolNamesInString(tool.description),
				inputSchema: tool.inputSchema && mapContributedToolNamesInSchema(tool.inputSchema),
			};
		});

		this._contributedToolCache.input = input;
		this._contributedToolCache.output = result;

		return result;
	}

	public get dardcorTools() {
		return this._dardcorTools.value;
	}

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService logService: ILogService,
		@IOTelService private readonly _otelService: IOTelService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExperimentationService private readonly _experimentationService: IExperimentationService,
	) {
		super(logService);
		this._dardcorTools = new Lazy(() => new Map(ToolRegistry.getTools().map(t => [t.toolName, _instantiationService.createInstance(t)] as const)));
		this._toolExtensions = new Lazy(() => new Map(ToolRegistry.getToolExtensions().map(t => [t.toolName, _instantiationService.createInstance(t)] as const)));
	}

	private getModelSpecificTools() {
		if (!this._connectedModelSpecificTools) {
			this._register(autorunIterableDelta(
				reader => ToolRegistry.modelSpecificTools.read(reader),
				({ addedValues, removedValues }) => {
					for (const { definition } of removedValues) {
						const prev = this._modelSpecificTools.get(definition.name);
						if (isDisposable(prev)) {
							prev.dispose();
						}
						this._modelSpecificTools.delete(definition.name);
					}
					for (const { definition, tool } of addedValues) {
						const instance = this._instantiationService.createInstance(tool);
						this._modelSpecificTools.set(definition.name, { definition, tool: instance });
					}
				},
				v => v.definition,
			));
			this._connectedModelSpecificTools = true;
		}

		return this._modelSpecificTools;
	}

	invokeTool(name: string | ToolName, options: vscode.LanguageModelToolInvocationOptions<Object>, token: vscode.CancellationToken): Thenable<vscode.LanguageModelToolResult | vscode.LanguageModelToolResult2> {
		this._onWillInvokeTool.fire({ toolName: name });

		const isMcpTool = String(name).includes('mcp_');
		const toolInfo = this.tools.find(t => t.name === String(name));
		const chatSessionId = getCurrentCapturingToken()?.chatSessionId;
		const parentChatSessionId = getCurrentCapturingToken()?.parentChatSessionId;
		const debugLogLabel = getCurrentCapturingToken()?.debugLogLabel;
		const parentTraceContext = (options as { parentTraceContext?: { traceId: string; spanId: string } }).parentTraceContext;
		const span = this._otelService.startSpan(`execute_tool ${name}`, {
			kind: SpanKind.INTERNAL,
			parentTraceContext,
			attributes: {
				[GenAiAttr.OPERATION_NAME]: GenAiOperationName.EXECUTE_TOOL,
				...(chatSessionId ? { [GenAiAttr.CONVERSATION_ID]: chatSessionId } : {}),
				[GenAiAttr.TOOL_NAME]: String(name),
				[GenAiAttr.TOOL_TYPE]: isMcpTool ? GenAiToolType.EXTENSION : GenAiToolType.FUNCTION,
				[GenAiAttr.TOOL_CALL_ID]: (options as { chatStreamToolCallId?: string }).chatStreamToolCallId ?? '',
				...(toolInfo?.description ? { [GenAiAttr.TOOL_DESCRIPTION]: toolInfo.description } : {}),
				...(chatSessionId ? { [DardcorChatAttr.SESSION_ID]: chatSessionId } : {}),
				...(chatSessionId ? { [DardcorChatAttr.CHAT_SESSION_ID]: chatSessionId } : {}),
				...(parentChatSessionId ? { [DardcorChatAttr.PARENT_CHAT_SESSION_ID]: parentChatSessionId } : {}),
				...(debugLogLabel ? { [DardcorChatAttr.DEBUG_LOG_LABEL]: debugLogLabel } : {}),
			},
		});
		if (options.input !== undefined) {
			try {
				span.setAttribute(GenAiAttr.TOOL_CALL_ARGUMENTS, truncateForOTel(JSON.stringify(options.input), this._otelService.config.maxAttributeSizeChars));
			} catch { }
		}

		try {
			const { attrs: paramAttrs, gatedAttrs: gatedParamAttrs } = extractToolParameters(String(name), options.input);
			for (const [k, v] of Object.entries(paramAttrs)) {
				span.setAttribute(k, v);
			}
			if (this._otelService.config.captureContent) {
				for (const [k, v] of Object.entries(gatedParamAttrs)) {
					span.setAttribute(k, v);
				}
			}
		} catch { }

		const chatStreamToolCallId = (options as { chatStreamToolCallId?: string }).chatStreamToolCallId;
		const chatRequestId = (options as { chatRequestId?: string }).chatRequestId;
		const subAgentInvocationId = (options as { subAgentInvocationId?: string }).subAgentInvocationId;
		if (String(name) === 'runSubagent') {
			const traceCtx = span.getSpanContext();
			if (traceCtx) {
				if (chatStreamToolCallId) {
					this._otelService.storeTraceContext(`subagent:toolcall:${chatStreamToolCallId}`, traceCtx);
					this._otelService.storeTraceContext(`subagent:invocation:${chatStreamToolCallId}`, traceCtx);
				}
				if (subAgentInvocationId) {
					this._otelService.storeTraceContext(`subagent:invocation:${subAgentInvocationId}`, traceCtx);
				}
				if (chatRequestId) {
					this._otelService.storeTraceContext(`subagent:request:${chatRequestId}`, traceCtx);
				}
			}
		}

		const startTime = Date.now();

		const optionsWithTrace = options as vscode.LanguageModelToolInvocationOptions<Object> & { traceparent?: string; tracestate?: string };
		const ctx = span.getSpanContext();
		if (ctx) {
			if (!optionsWithTrace.traceparent) {
				const flags = (ctx.traceFlags ?? 0x01).toString(16).padStart(2, '0');
				optionsWithTrace.traceparent = `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
			}
			if (!optionsWithTrace.tracestate && ctx.traceState) {
				optionsWithTrace.tracestate = ctx.traceState;
			}
		}

		return vscode.lm.invokeTool(getContributedToolName(name), options, token).then(
			result => {
				span.setStatus(SpanStatusCode.OK);
				try {
					const parts: string[] = [];
					for (const p of result.content) {
						if (p instanceof vscode.LanguageModelTextPart) {
							parts.push(p.value);
						} else if (p instanceof vscode.LanguageModelPromptTsxPart) {
							parts.push(JSON.stringify(p.value));
						} else if (p instanceof vscode.LanguageModelDataPart) {
							parts.push(`[${p.mimeType}: ${p.data.byteLength} bytes]`);
						}
					}
					if (parts.length > 0) {
						span.setAttribute(GenAiAttr.TOOL_CALL_RESULT, truncateForOTel(parts.join(''), this._otelService.config.maxAttributeSizeChars));
					}
				} catch { }
				span.end();
				const durationMs = Date.now() - startTime;
				GenAiMetrics.recordToolCallCount(this._otelService, String(name), true);
				GenAiMetrics.recordToolCallDuration(this._otelService, String(name), durationMs);
				emitToolCallEvent(this._otelService, String(name), durationMs, true);
				return result;
			},
			err => {
				span.setStatus(SpanStatusCode.ERROR, err instanceof Error ? err.message : String(err));
				span.setAttribute(StdAttr.ERROR_TYPE, err instanceof Error ? err.constructor.name : 'Error');
				span.setAttribute(GenAiAttr.TOOL_CALL_RESULT, truncateForOTel(`ERROR: ${err instanceof Error ? err.message : String(err)}`, this._otelService.config.maxAttributeSizeChars));
				span.recordException(err);
				span.end();
				const durationMs = Date.now() - startTime;
				GenAiMetrics.recordToolCallCount(this._otelService, String(name), false);
				GenAiMetrics.recordToolCallDuration(this._otelService, String(name), durationMs);
				emitToolCallEvent(this._otelService, String(name), durationMs, false, err instanceof Error ? err.constructor.name : 'Error');
				throw err;
			},
		);
	}

	override invokeToolWithEndpoint(name: string, options: vscode.LanguageModelToolInvocationOptions<Object>, endpoint: IChatEndpoint | undefined, token: vscode.CancellationToken): Thenable<vscode.LanguageModelToolResult2> {
		if (endpoint) {
			const toolName = getToolName(name);
			for (const [overridesTool] of this.getToolOverridesForEndpoint(endpoint)) {
				if (overridesTool === toolName) {
					return this.invokeTool(toolName, options, token);
				}
			}
		}

		return this.invokeTool(name, options, token);
	}

	override getAgentTool(name: string): IAgentTool<unknown> | undefined {
		return this._dardcorTools.value.get(name as ToolName) || this.getModelSpecificTools().get(name)?.tool;
	}

	getTool(name: string | ToolName): vscode.LanguageModelToolInformation | undefined {
		return this.tools.find(tool => tool.name === name);
	}

	getToolByToolReferenceName(name: string): vscode.LanguageModelToolInformation | undefined {
		throw new Error('This method for tests only');
	}

	getEnabledTools(request: vscode.ChatRequest, endpoint: IChatEndpoint, filter?: (tool: vscode.LanguageModelToolInformation) => boolean | undefined): vscode.LanguageModelToolInformation[] {
		const tools = this.tools;
		const toolMap = new Map(tools.map(t => [t.name, t]));
		const requestToolsByName = new Map(Iterable.map(request.tools, ([t, enabled]) => [typeof t === 'string' ? t : t.name, enabled]));

		const modelSpecificOverrides = new Map(this.getToolOverridesForEndpoint(endpoint, tools));
		const modelSpecificTools = this.getModelSpecificTools();

		return tools
			.filter(tool => {
				if (modelSpecificTools.get(tool.name)?.tool.overridesTool) {
					return false;
				}

				if (
					tool.name === ToolName.GetScmChanges
					&& isGpt55(endpoint)
					&& !this._configurationService.getExperimentBasedConfig(ConfigKey.EnableGpt55GetChangedFilesTool, this._experimentationService)
				) {
					return false;
				}

				if (
					tool.name === ToolName.GetScmChanges
					&& endpoint.family.toLowerCase().includes('gemini-3')
					&& !this._configurationService.getExperimentBasedConfig(ConfigKey.EnableGemini3GetChangedFilesTool, this._experimentationService)
				) {
					return false;
				}

				if (
					tool.name === ToolName.ReadFile
					&& isGpt55(endpoint)
					&& !this._configurationService.getExperimentBasedConfig(ConfigKey.EnableGpt55ReadFileTool, this._experimentationService)
				) {
					return false;
				}

				if (
					tool.name === ToolName.Codebase
					&& this._configurationService.getExperimentBasedConfig(ConfigKey.DisableSemanticSearchTool, this._experimentationService)
				) {
					return false;
				}

				const toolPickerSelection = requestToolsByName.get(getContributedToolName(tool.name));
				if (toolPickerSelection === false) {
					return false;
				}

				const explicit = filter?.(tool);
				if (explicit !== undefined) {
					return explicit;
				}

				for (const ref of request.toolReferences) {
					const usedTool = toolMap.get(ref.name);
					if (usedTool?.tags.includes(`enable_other_tool_${tool.name}`)) {
						return true;
					}
				}

				if (toolPickerSelection === true) {
					return true;
				}

				return false;
			})
			.map(tool => {
				const toolName = getToolName(tool.name) as ToolName;
				const override = modelSpecificOverrides.get(toolName);
				let resultTool = tool;
				if (override?.tool) {
					resultTool = { ...override.info, name: resultTool.name };
				}

				const owned = override?.tool || this.getAgentTool(toolName);
				if (owned?.alternativeDefinition) {
					resultTool = owned.alternativeDefinition(resultTool, endpoint);
				}

				const extension = this._toolExtensions.value.get(toolName);
				if (extension?.alternativeDefinition) {
					resultTool = extension.alternativeDefinition(resultTool, endpoint);
				}

				return resultTool;
			});
	}

	private *getToolOverridesForEndpoint(endpoint: IChatEndpoint, tools = this.tools) {
		for (const tool of tools) {
			const modelSpecificTool = this.getModelSpecificTools().get(tool.name);
			if (!modelSpecificTool) {
				continue;
			}
			if (!modelSpecificToolApplies(modelSpecificTool.definition, endpoint)) {
				continue;
			}

			if (modelSpecificTool.tool.overridesTool) {
				yield [modelSpecificTool.tool.overridesTool, { info: tool, tool: modelSpecificTool.tool }] as const;
			}
		}
	}
}
