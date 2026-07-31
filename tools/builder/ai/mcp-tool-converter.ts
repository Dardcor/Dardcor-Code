/**
 * Dardcor Code - MCP Tool Schema to AI Function Conversion (Task 935)
 *
 * Converts MCP tool definitions (JSON Schema `inputSchema`) into internal
 * AI function-call descriptors used by the agent loop, and back again for
 * invoking tools via the MCP client. Type mapping follows the JSON Schema
 * subset commonly produced by MCP servers.
 */

export interface JsonSchemaType {
	readonly type?: string | readonly string[];
	readonly description?: string;
	readonly enum?: readonly (string | number | boolean)[];
	readonly items?: JsonSchemaType;
	readonly properties?: Readonly<Record<string, JsonSchemaType>>;
	readonly required?: readonly string[];
	readonly anyOf?: readonly JsonSchemaType[];
}

export interface McpToolSchema {
	readonly name: string;
	readonly description?: string;
	readonly inputSchema?: JsonSchemaType;
}

export interface AiFunctionParameter {
	type: 'string' | 'number' | 'boolean' | 'array' | 'object';
	description?: string;
	enum?: readonly (string | number | boolean)[];
	items?: AiFunctionParameter;
	properties?: Readonly<Record<string, AiFunctionParameter>>;
}

export interface AiFunctionDefinition {
	readonly name: string;
	readonly description: string;
	readonly parameters: {
		readonly type: 'object';
		readonly properties: Readonly<Record<string, AiFunctionParameter>>;
		readonly required: readonly string[];
	};
}

export interface AiFunctionCall {
	readonly name: string;
	readonly arguments: Readonly<Record<string, unknown>>;
}

function mapType(schema: JsonSchemaType): AiFunctionParameter {
	const type = Array.isArray(schema.type) ? schema.type[0] : schema.type ?? 'string';
	const mapped: AiFunctionParameter = {
		type: type === 'integer' ? 'number' : type === 'null' ? 'string' : (type as AiFunctionParameter['type']),
	};
	if (schema.description) mapped.description = schema.description;
	if (schema.enum) mapped.enum = schema.enum;
	if (schema.items) mapped.items = mapType(schema.items);
	if (schema.properties) {
		const properties: Record<string, AiFunctionParameter> = {};
		for (const [key, value] of Object.entries(schema.properties)) {
			properties[key] = mapType(value);
		}
		mapped.properties = properties;
	}
	return mapped;
}

/** MCP tool definition -> AI function call descriptor. */
export function convertMcpTool(tool: McpToolSchema): AiFunctionDefinition {
	const properties: Record<string, AiFunctionParameter> = {};
	const required: string[] = [];
	for (const [key, schema] of Object.entries(tool.inputSchema?.properties ?? {})) {
		properties[key] = mapType(schema);
	}
	if (Array.isArray(tool.inputSchema?.required)) {
		required.push(...tool.inputSchema!.required!.filter((r): r is string => typeof r === 'string'));
	}
	return {
		name: tool.name,
		description: tool.description ?? tool.name,
		parameters: { type: 'object', properties, required },
	};
}

export function convertMcpTools(tools: readonly McpToolSchema[]): AiFunctionDefinition[] {
	return tools.map(convertMcpTool);
}

/** Wraps a bare argument map into the MCP `{ arguments: ... }` call shape. */
export function aiCallToMcpCall(toolName: string, args: Readonly<Record<string, unknown>>): { name: string; arguments: Readonly<Record<string, unknown>> } {
	return { name: toolName, arguments: args };
}

/** Decomposes an AI function call result into MCP tool output (content blocks). */
export function mcpResultToAiText(result: { content?: ReadonlyArray<{ type?: string; text?: string }> }): string {
	return (result.content ?? [])
		.filter(block => block.type === 'text' || typeof block.text === 'string')
		.map(block => block.text ?? '')
		.join('\n');
}

export function convertAiFunctionBack(def: AiFunctionDefinition): McpToolSchema {
	const properties: Record<string, JsonSchemaType> = {};
	for (const [key, param] of Object.entries(def.parameters.properties)) {
		const schema: JsonSchemaType = {
			type: param.type,
			...(param.description ? { description: param.description } : {}),
			...(param.enum ? { enum: param.enum } : {}),
			...(param.items ? { items: { type: param.items.type } } : {}),
		};
		properties[key] = schema;
	}
	return {
		name: def.name,
		description: def.description,
		inputSchema: {
			type: 'object',
			properties,
			required: def.parameters.required as string[],
		},
	};
}
