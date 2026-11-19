/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hashTelemetryValue } from '../../../util/node/crypto';
import {
	EditOperationType,
	FILE_TOOL_NAMES,
	DardcorAttr,
	SHELL_TOOL_NAMES,
	TOOL_PARAM_COMMAND_MAX_LEN,
} from '../common/genAiAttributes';

export interface ToolParameterAttributes {
	attrs: Record<string, string>;
	gatedAttrs: Record<string, string>;
}

export function extractToolParameters(toolName: string, input: unknown): ToolParameterAttributes {
	const attrs: Record<string, string> = {};
	const gatedAttrs: Record<string, string> = {};

	if (typeof input !== 'object' || input === null) {
		return { attrs, gatedAttrs };
	}
	const obj = input as Record<string, unknown>;

	if (SHELL_TOOL_NAMES.has(toolName)) {
		const command = pickFirstString(obj, ['command', 'cmd', 'commandLine']);
		if (command) {
			gatedAttrs[DardcorAttr.TOOL_PARAM_COMMAND] =
				command.length > TOOL_PARAM_COMMAND_MAX_LEN
					? command.slice(0, TOOL_PARAM_COMMAND_MAX_LEN)
					: command;
		}
	}

	if (FILE_TOOL_NAMES.has(toolName)) {
		const filePath = pickFirstString(obj, ['file_path', 'filePath', 'path', 'uri']);
		if (filePath) {
			gatedAttrs[DardcorAttr.TOOL_PARAM_FILE_PATH] = filePath;
		}
		const editType = classifyEditType(toolName, obj);
		if (editType) {
			attrs[DardcorAttr.TOOL_PARAM_EDIT_TYPE] = editType;
		}
	}

	const skillName = pickFirstString(obj, ['skill_name', 'skillName', 'skill']);
	if (skillName) {
		attrs[DardcorAttr.TOOL_PARAM_SKILL_NAME] = skillName;
	}

	if (toolName.startsWith('mcp__')) {
		const rest = toolName.slice('mcp__'.length);
		const sep = rest.indexOf('__');
		if (sep > 0) {
			const serverName = rest.slice(0, sep);
			const mcpToolName = rest.slice(sep + 2);
			attrs[DardcorAttr.TOOL_PARAM_MCP_SERVER_NAME_HASH] = hashTelemetryValue(serverName);
			attrs[DardcorAttr.TOOL_PARAM_MCP_TOOL_NAME] = mcpToolName;
			gatedAttrs[DardcorAttr.TOOL_PARAM_MCP_SERVER_NAME] = serverName;
		}
	} else if (toolName.startsWith('mcp_')) {
		const rest = toolName.slice('mcp_'.length);
		const underscore = rest.indexOf('_');
		if (underscore > 0) {
			const serverName = rest.slice(0, underscore);
			const mcpToolName = rest.slice(underscore + 1);
			attrs[DardcorAttr.TOOL_PARAM_MCP_SERVER_NAME_HASH] = hashTelemetryValue(serverName);
			attrs[DardcorAttr.TOOL_PARAM_MCP_TOOL_NAME] = mcpToolName;
			gatedAttrs[DardcorAttr.TOOL_PARAM_MCP_SERVER_NAME] = serverName;
		}
	}

	return { attrs, gatedAttrs };
}

function pickFirstString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const k of keys) {
		const v = obj[k];
		if (typeof v === 'string' && v.length > 0) {
			return v;
		}
	}
	return undefined;
}

function classifyEditType(toolName: string, obj: Record<string, unknown>): EditOperationType | undefined {
	if (toolName === 'create' || toolName === 'createFile' || toolName === 'create_file' || toolName === 'Write') {
		return 'create';
	}
	if (toolName === 'insert') {
		return 'insert';
	}
	if (
		toolName === 'str_replace' ||
		toolName === 'str_replace_editor' ||
		toolName === 'replaceString' ||
		toolName === 'replace_string_in_file' ||
		toolName === 'multi_replace_string_in_file' ||
		toolName === 'Edit' ||
		toolName === 'MultiEdit'
	) {
		return 'str_replace';
	}
	if (
		toolName === 'edit' ||
		toolName === 'applyPatch' ||
		toolName === 'apply_patch' ||
		toolName === 'insert_edit_into_file' ||
		toolName === 'edit_notebook_file' ||
		toolName === 'NotebookEdit'
	) {
		return 'update';
	}
	if (toolName === 'view' || toolName === 'readFile' || toolName === 'read_file' || toolName === 'Read') {
		return undefined;
	}
	if (typeof obj.old_str === 'string' || typeof obj.oldString === 'string') {
		return 'str_replace';
	}
	if (typeof obj.content === 'string' && typeof obj.file_text === 'undefined') {
		return 'update';
	}
	return undefined;
}
