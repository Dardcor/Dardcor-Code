/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const AGENT_TOOL_RUNTIME_VERSION = 1 as const;

export type AgentToolExecutionStatus = 'running' | 'succeeded' | 'failed' | 'denied' | 'cancelled' | 'timedOut' | 'unknown' | 'rejected';
export type AgentToolRisk = 'read' | 'write' | 'command' | 'network' | 'browser' | 'unknown';
export type AgentToolSource = 'router' | 'builtin' | 'extension' | 'mcp' | 'user' | 'agent-host';

export interface IAgentToolDescriptor {
	readonly name: string;
	readonly aliases?: readonly string[];
	readonly inputSchema: unknown;
	readonly source: AgentToolSource;
	readonly risk: AgentToolRisk;
	readonly driver: string;
}

export interface IAgentToolExecutionRequest {
	readonly version: typeof AGENT_TOOL_RUNTIME_VERSION;
	readonly callId: string;
	readonly toolName: string;
	readonly arguments: unknown;
	readonly context?: unknown;
}

export interface IAgentToolExecutionResult {
	readonly version: typeof AGENT_TOOL_RUNTIME_VERSION;
	readonly callId: string;
	readonly toolName: string;
	readonly status: AgentToolExecutionStatus;
	readonly output: string;
	readonly exitCode?: number;
	readonly evidence: readonly string[];
	readonly retrySafe: boolean;
	readonly details?: unknown;
}

export interface IAgentToolHandlerResult {
	readonly output: string;
	readonly status?: AgentToolExecutionStatus;
	readonly exitCode?: number;
	readonly evidence?: readonly string[];
	readonly retrySafe?: boolean;
	readonly details?: unknown;
}

export type AgentToolHandler = (args: Record<string, unknown>, request: IAgentToolExecutionRequest) => IAgentToolHandlerResult | string | Promise<IAgentToolHandlerResult | string>;

export function isAgentToolExecutionStatus(value: unknown): value is AgentToolExecutionStatus {
	return value === 'running' || value === 'succeeded' || value === 'failed' || value === 'denied'
		|| value === 'cancelled' || value === 'timedOut' || value === 'unknown' || value === 'rejected';
}

function extractOrigin(stack: string | undefined): string | undefined {
	if (!stack || typeof stack !== 'string') {
		return undefined;
	}
	const lines = stack.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('at ')) {
			return trimmed.replace(/^at\s+/, '');
		}
	}
	return undefined;
}

export function formatAgentToolError(error: unknown): string {
	const seen = new Set<object>();
	const render = (value: unknown, depth: number): string => {
		if (value === null) {
			return 'null';
		}
		if (value === undefined) {
			return 'undefined';
		}
		if (typeof value === 'string') {
			return value.trim() || '(empty error message)';
		}
		if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
			return String(value);
		}
		if (typeof value !== 'object') {
			return String(value);
		}
		if (seen.has(value)) {
			return '[circular error detail]';
		}
		if (depth >= 4) {
			return '[nested error detail omitted]';
		}
		seen.add(value);

		if (Array.isArray(value)) {
			return value.slice(0, 5).map(item => render(item, depth + 1)).join('; ') || '(empty error details)';
		}

		const record = value as Record<string, unknown>;

		// Extract constructor name (e.g. DOMException, CustomError, TimeoutError)
		const ctor = (value as { constructor?: { name?: string } }).constructor;
		const ctorName = ctor && typeof ctor.name === 'string' && ctor.name !== 'Object' ? ctor.name : undefined;

		// 1. Resolve error name / classification
		let name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : undefined;
		if (!name && ctorName && ctorName !== 'Error') {
			name = ctorName;
		}

		// 2. Resolve error message from common candidate keys
		let message: string | undefined;
		for (const key of ['message', 'errorMessage', 'reason', 'description', 'detail', 'msg', 'title', 'statusText', 'error_description']) {
			const candidate = record[key];
			if (typeof candidate === 'string' && candidate.trim().length > 0) {
				message = candidate.trim();
				break;
			}
		}

		// CDP / Playwright exceptionDetails support
		if (!message && record.exceptionDetails && isRecord(record.exceptionDetails)) {
			const ed = record.exceptionDetails as Record<string, unknown>;
			const exceptionObj = isRecord(ed.exception) ? ed.exception : undefined;
			const desc = (typeof exceptionObj?.description === 'string' && exceptionObj.description)
				|| (typeof ed.text === 'string' && ed.text)
				|| (typeof ed.message === 'string' && ed.message);
			if (desc && desc.trim()) {
				message = desc.trim();
			}
		}

		// Fallback to top line of stack if message is missing
		const rawStack = record.stack || (record as { stacktrace?: string }).stacktrace;
		const stack = typeof rawStack === 'string' && rawStack.trim() ? rawStack.trim() : undefined;
		if (!message && stack) {
			const firstLine = stack.split(/\r?\n/)[0]?.trim();
			if (firstLine && firstLine !== name) {
				message = name && firstLine.startsWith(`${name}: `) ? firstLine.slice(name.length + 2).trim() : firstLine;
			}
		}

		// 3. Resolve code / status
		const rawCode = record.code !== undefined ? record.code : (record.status !== undefined ? record.status : record.statusCode);
		const code = (typeof rawCode === 'string' || typeof rawCode === 'number') && String(rawCode).trim() ? String(rawCode).trim() : undefined;

		// 4. Resolve structured details and causes
		const details: string[] = [];
		const detailKeys = ['cause', 'error', 'reason', 'details', 'data', 'errors', 'target', 'response'];
		for (const key of detailKeys) {
			const detail = record[key];
			if (detail === undefined || detail === null) {
				continue;
			}
			if (key === 'error' && (detail === message || detail === value)) {
				continue;
			}
			if (key === 'reason' && detail === message) {
				continue;
			}

			if (key === 'target' && isRecord(detail)) {
				const tag = (typeof detail.nodeName === 'string' && detail.nodeName)
					|| (detail.constructor && typeof detail.constructor.name === 'string' && detail.constructor.name);
				if (tag) {
					details.push(`target: <${tag.toLowerCase()}>`);
					continue;
				}
			}

			details.push(`${key}: ${render(detail, depth + 1)}`);
		}

		if (record.message !== undefined && typeof record.message !== 'string' && record.message !== null) {
			details.push(`message: ${render(record.message, depth + 1)}`);
		}

		if (typeof record.type === 'string') {
			if (!name && (record.type === 'error' || record.type.includes('error'))) {
				name = ctorName || 'ErrorEvent';
			}
			if (record.filename !== undefined || record.lineno !== undefined) {
				const loc = [record.filename, record.lineno, record.colno].filter(v => v !== undefined).join(':');
				if (loc) {
					details.push(`location: ${loc}`);
				}
			}
		}

		if (depth === 0 && stack) {
			const origin = extractOrigin(stack);
			if (origin) {
				details.push(`origin: ${origin}`);
			}
		}

		// 5. Construct label
		const label = [name && message ? `${name}: ${message}` : name ?? message, code ? `code ${code}` : undefined].filter(Boolean).join(' (')
			+ (code && (name || message) ? ')' : '');

		if (label || details.length > 0) {
			return [label || 'Structured error', ...details].join('; ');
		}

		// 6. Custom toString() if defined and informative
		if (typeof record.toString === 'function' && record.toString !== Object.prototype.toString) {
			try {
				const str = record.toString();
				if (typeof str === 'string' && str.trim() && str !== '[object Object]' && str !== '[object Error]') {
					return str.trim();
				}
			} catch { }
		}

		// 7. Non-enumerable properties & property names (captures hidden error fields)
		const propNames = Object.getOwnPropertyNames(record).filter(k => k !== 'constructor');
		const ownKeys = propNames.length > 0 ? propNames : Object.keys(record);
		const entries = ownKeys.slice(0, 12).map(key => `${key}: ${render(record[key], depth + 1)}`);
		if (entries.length > 0) {
			return `Structured error { ${entries.join(', ')} }`;
		}

		// 8. Specialized class instance without enumerable properties
		if (ctorName && ctorName !== 'Object') {
			return `[${ctorName}]`;
		}

		return 'Empty error object (no enumerable details or message properties)';
	};

	try {
		const message = render(error, 0).replace(/\s+/g, ' ').trim();
		return message.length > 2000 ? `${message.slice(0, 1997)}...` : message;
	} catch {
		return 'Structured error details could not be inspected safely.';
	}
}

interface IValidationIssue {
	readonly path: string;
	readonly message: string;
}

const MAX_SCHEMA_DEPTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesType(value: unknown, type: string): boolean {
	switch (type) {
		case 'object': return isRecord(value);
		case 'array': return Array.isArray(value);
		case 'integer': return typeof value === 'number' && Number.isInteger(value);
		case 'number': return typeof value === 'number' && Number.isFinite(value);
		case 'string': return typeof value === 'string';
		case 'boolean': return typeof value === 'boolean';
		case 'null': return value === null;
		default: return true;
	}
}

function isDeepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((value, index) => isDeepEqual(value, right[index]));
	}
	if (isRecord(left) && isRecord(right)) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && isDeepEqual(left[key], right[key]));
	}
	return false;
}

function validateValue(schemaValue: unknown, value: unknown, path: string, issues: IValidationIssue[], depth: number, rootSchema: unknown): void {
	if (schemaValue === true) {
		return;
	}
	if (schemaValue === false) {
		issues.push({ path, message: 'is rejected by the schema' });
		return;
	}
	if (!isRecord(schemaValue)) {
		issues.push({ path, message: 'does not have a valid JSON schema' });
		return;
	}
	if (depth > MAX_SCHEMA_DEPTH) {
		issues.push({ path, message: 'schema nesting exceeds the supported depth' });
		return;
	}
	const schema = schemaValue;
	if (typeof schema.$ref === 'string') {
		const reference = schema.$ref;
		if (!reference.startsWith('#/')) {
			issues.push({ path, message: `uses unsupported external schema reference ${reference}` });
			return;
		}
		let resolved: unknown = rootSchema;
		for (const segment of reference.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
			resolved = isRecord(resolved) ? resolved[segment] : undefined;
		}
		if (!isRecord(resolved)) {
			issues.push({ path, message: `references missing schema ${reference}` });
			return;
		}
		validateValue(resolved, value, path, issues, depth + 1, rootSchema);
	}
	const types = typeof schema.type === 'string' ? [schema.type] : Array.isArray(schema.type) ? schema.type.filter((item): item is string => typeof item === 'string') : [];
	const supportedTypes = new Set(['object', 'array', 'integer', 'number', 'string', 'boolean', 'null']);
	const unsupportedType = types.find(type => !supportedTypes.has(type));
	if (unsupportedType) {
		issues.push({ path, message: `declares unsupported JSON schema type ${unsupportedType}` });
		return;
	}
	if (types.length > 0 && !types.some(type => matchesType(value, type))) {
		issues.push({ path, message: `must be ${types.join(' or ')}` });
		return;
	}
	if (Array.isArray(schema.enum) && !schema.enum.some(candidate => isDeepEqual(candidate, value))) {
		issues.push({ path, message: 'must match one of the allowed values' });
	}
	if (Object.prototype.hasOwnProperty.call(schema, 'const') && !isDeepEqual(schema.const, value)) {
		issues.push({ path, message: 'must match the required constant value' });
	}

	for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
		const candidates = schema[keyword];
		if (!Array.isArray(candidates)) {
			continue;
		}
		const matchCount = candidates.filter(candidate => {
			const candidateIssues: IValidationIssue[] = [];
			validateValue(candidate, value, path, candidateIssues, depth + 1, rootSchema);
			return candidateIssues.length === 0;
		}).length;
		if (keyword === 'allOf' && matchCount !== candidates.length) {
			issues.push({ path, message: 'must satisfy every allOf schema' });
		} else if (keyword === 'anyOf' && matchCount === 0) {
			issues.push({ path, message: 'must satisfy at least one anyOf schema' });
		} else if (keyword === 'oneOf' && matchCount !== 1) {
			issues.push({ path, message: 'must satisfy exactly one oneOf schema' });
		}
	}
	if (isRecord(schema.not)) {
		const nestedIssues: IValidationIssue[] = [];
		validateValue(schema.not, value, path, nestedIssues, depth + 1, rootSchema);
		if (nestedIssues.length === 0) {
			issues.push({ path, message: 'must not match the excluded schema' });
		}
	}

	if (typeof value === 'string') {
		if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
			issues.push({ path, message: `must contain at least ${schema.minLength} character(s)` });
		}
		if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
			issues.push({ path, message: `must contain at most ${schema.maxLength} character(s)` });
		}
		if (typeof schema.pattern === 'string') {
			try {
				if (!new RegExp(schema.pattern).test(value)) {
					issues.push({ path, message: `must match pattern ${schema.pattern}` });
				}
			} catch {
				issues.push({ path, message: 'declares an invalid validation pattern' });
			}
		}
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		if (typeof schema.minimum === 'number' && value < schema.minimum) {
			issues.push({ path, message: `must be at least ${schema.minimum}` });
		}
		if (typeof schema.maximum === 'number' && value > schema.maximum) {
			issues.push({ path, message: `must be at most ${schema.maximum}` });
		}
		if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0 && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > Number.EPSILON * 8) {
			issues.push({ path, message: `must be a multiple of ${schema.multipleOf}` });
		}
	}

	if (Array.isArray(value)) {
		if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
			issues.push({ path, message: `must contain at least ${schema.minItems} item(s)` });
		}
		if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
			issues.push({ path, message: `must contain at most ${schema.maxItems} item(s)` });
		}
		if (schema.uniqueItems === true && value.some((item, index) => value.slice(index + 1).some(other => isDeepEqual(item, other)))) {
			issues.push({ path, message: 'must not contain duplicate items' });
		}
		if (isRecord(schema.items)) {
			value.forEach((item, index) => validateValue(schema.items, item, `${path}[${index}]`, issues, depth + 1, rootSchema));
		} else if (Array.isArray(schema.items)) {
			schema.items.forEach((itemSchema, index) => {
				if (index < value.length) {
					validateValue(itemSchema, value[index], `${path}[${index}]`, issues, depth + 1, rootSchema);
				}
			});
			if (schema.additionalItems === false && value.length > schema.items.length) {
				issues.push({ path, message: `must contain at most ${schema.items.length} item(s)` });
			} else if (isRecord(schema.additionalItems)) {
				for (let index = schema.items.length; index < value.length; index++) {
					validateValue(schema.additionalItems, value[index], `${path}[${index}]`, issues, depth + 1, rootSchema);
				}
			}
		}
	}

	if (isRecord(value)) {
		const properties = isRecord(schema.properties) ? schema.properties : {};
		const patternProperties = isRecord(schema.patternProperties) ? schema.patternProperties : {};
		const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
		for (const key of required) {
			if (!Object.prototype.hasOwnProperty.call(value, key)) {
				issues.push({ path: path ? `${path}.${key}` : key, message: 'is required' });
			}
		}
		if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) {
			issues.push({ path, message: `must contain at least ${schema.minProperties} property(s)` });
		}
		if (typeof schema.maxProperties === 'number' && Object.keys(value).length > schema.maxProperties) {
			issues.push({ path, message: `must contain at most ${schema.maxProperties} property(s)` });
		}
		for (const [key, propertyValue] of Object.entries(value)) {
			const propertySchema = properties[key];
			if (propertySchema !== undefined) {
				validateValue(propertySchema, propertyValue, path ? `${path}.${key}` : key, issues, depth + 1, rootSchema);
				continue;
			}
			let matchedPattern = false;
			for (const [pattern, patternSchema] of Object.entries(patternProperties)) {
				try {
					if (new RegExp(pattern).test(key)) {
						matchedPattern = true;
						validateValue(patternSchema, propertyValue, path ? `${path}.${key}` : key, issues, depth + 1, rootSchema);
					}
				} catch {
					issues.push({ path: path ? `${path}.${key}` : key, message: `schema declares an invalid property pattern ${pattern}` });
				}
			}
			if (!matchedPattern && schema.additionalProperties === false) {
				issues.push({ path: path ? `${path}.${key}` : key, message: 'is not an allowed property' });
			} else if (!matchedPattern && isRecord(schema.additionalProperties)) {
				validateValue(schema.additionalProperties, propertyValue, path ? `${path}.${key}` : key, issues, depth + 1, rootSchema);
			}
		}
		if (isRecord(schema.dependentRequired)) {
			for (const [trigger, dependencies] of Object.entries(schema.dependentRequired)) {
				if (Object.prototype.hasOwnProperty.call(value, trigger) && Array.isArray(dependencies)) {
					for (const dependency of dependencies) {
						if (typeof dependency === 'string' && !Object.prototype.hasOwnProperty.call(value, dependency)) {
							issues.push({ path: path ? `${path}.${dependency}` : dependency, message: `is required when ${trigger} is present` });
						}
					}
				}
			}
		}
	}
}

export function validateAgentToolArguments(schema: unknown, value: unknown): readonly string[] {
	if (!isRecord(value)) {
		return ['arguments must be a JSON object'];
	}
	if (!isRecord(schema)) {
		return ['tool does not declare a valid object input schema'];
	}
	const issues: IValidationIssue[] = [];
	validateValue(schema, value, '', issues, 0, schema);
	return [...new Set(issues.map(issue => issue.path ? `${issue.path}: ${issue.message}` : issue.message))];
}

export interface IAgentToolRuntimeEntry {
	readonly descriptor: IAgentToolDescriptor;
	readonly handler: AgentToolHandler;
}

export class AgentToolCatalog {
	private readonly _entries = new Map<string, IAgentToolRuntimeEntry>();
	private readonly _aliases = new Map<string, string>();

	register(entry: IAgentToolRuntimeEntry): void {
		const { name, aliases = [] } = entry.descriptor;
		if (!name.trim() || name !== name.trim() || this._entries.has(name) || this._aliases.has(name)) {
			throw new Error(`Duplicate or empty agent tool name: ${name}`);
		}
		if (typeof entry.descriptor.driver !== 'string' || !entry.descriptor.driver.trim()) {
			throw new Error(`Agent tool "${name}" must have exactly one non-empty local driver.`);
		}
		if (typeof entry.descriptor.inputSchema !== 'boolean' && !isRecord(entry.descriptor.inputSchema)) {
			throw new Error(`Agent tool "${name}" must have a valid JSON input schema.`);
		}
		const seenAliases = new Set<string>();
		for (const alias of aliases) {
			if (!alias.trim() || alias === name || seenAliases.has(alias) || this._entries.has(alias) || this._aliases.has(alias)) {
				throw new Error(`Duplicate or empty agent tool alias: ${alias}`);
			}
			seenAliases.add(alias);
		}
		this._entries.set(name, entry);
		for (const alias of aliases) {
			this._aliases.set(alias, name);
		}
	}

	resolve(name: string): IAgentToolRuntimeEntry | undefined {
		const canonicalName = this._aliases.get(name) ?? name;
		return this._entries.get(canonicalName);
	}

	list(): readonly IAgentToolDescriptor[] {
		return [...this._entries.values()].map(entry => entry.descriptor);
	}

	validate(name: string, args: unknown): { readonly descriptor: IAgentToolDescriptor; readonly args: Record<string, unknown> } | { readonly error: string } {
		const entry = this.resolve(name);
		if (!entry) {
			return { error: `Unknown tool "${name}". No action was run.` };
		}
		if (entry.descriptor.inputSchema === undefined) {
			return { error: `Tool "${entry.descriptor.name}" has no registered input schema. No action was run.` };
		}
		let parsed = args;
		if (typeof parsed === 'string') {
			try {
				parsed = JSON.parse(parsed);
			} catch (error) {
				return { error: `Invalid JSON arguments for ${entry.descriptor.name}: ${error instanceof Error ? error.message : String(error)}.` };
			}
		}
		if (!isRecord(parsed)) {
			return { error: `Arguments for ${entry.descriptor.name} must be a JSON object.` };
		}
		const errors = validateAgentToolArguments(entry.descriptor.inputSchema, parsed);
		return errors.length > 0
			? { error: `Invalid arguments for ${entry.descriptor.name}: ${errors.slice(0, 8).join('; ')}.` }
			: { descriptor: entry.descriptor, args: parsed as Record<string, unknown> };
	}
}

export class DardcorAgentToolRuntime {
	private readonly _catalog = new AgentToolCatalog();
	private readonly _handlers = new Map<string, AgentToolHandler>();
	private readonly _seenCallIds = new Set<string>();

	register(descriptor: IAgentToolDescriptor, handler: AgentToolHandler): void {
		this._catalog.register({ descriptor, handler });
		this._handlers.set(descriptor.name, handler);
	}

	get catalog(): AgentToolCatalog {
		return this._catalog;
	}

	async execute(request: IAgentToolExecutionRequest): Promise<IAgentToolExecutionResult> {
		if (!request || typeof request !== 'object') {
			return {
				version: AGENT_TOOL_RUNTIME_VERSION,
				callId: '',
				toolName: '',
				status: 'rejected',
				output: 'Tool request must be an object. No action was run.',
				evidence: [],
				retrySafe: true,
			};
		}
		if (request.version !== AGENT_TOOL_RUNTIME_VERSION) {
			return {
				version: AGENT_TOOL_RUNTIME_VERSION,
				callId: typeof request.callId === 'string' ? request.callId : '',
				toolName: typeof request.toolName === 'string' ? request.toolName : '',
				status: 'rejected',
				output: `Unsupported agent tool runtime version "${String(request.version)}". No action was run.`,
				evidence: [],
				retrySafe: true,
			};
		}
		if (typeof request.callId !== 'string' || !request.callId.trim()) {
			return {
				version: AGENT_TOOL_RUNTIME_VERSION,
				callId: request.callId,
				toolName: request.toolName,
				status: 'rejected',
				output: 'Tool request has no call ID. No action was run.',
				evidence: [],
				retrySafe: true,
			};
		}
		if (typeof request.toolName !== 'string' || !request.toolName.trim()) {
			return {
				version: AGENT_TOOL_RUNTIME_VERSION,
				callId: request.callId,
				toolName: typeof request.toolName === 'string' ? request.toolName : '',
				status: 'rejected',
				output: 'Tool request has no tool name. No action was run.',
				evidence: [],
				retrySafe: true,
			};
		}
		const validation = this._catalog.validate(request.toolName, request.arguments);
		if ('error' in validation) {
			return {
				version: AGENT_TOOL_RUNTIME_VERSION,
				callId: request.callId,
				toolName: request.toolName,
				status: 'rejected',
				output: validation.error,
				evidence: [],
				retrySafe: true,
			};
		}

		const name = validation.descriptor.name;
		if (this._seenCallIds.has(request.callId)) {
			return {
				version: AGENT_TOOL_RUNTIME_VERSION,
				callId: request.callId,
				toolName: name,
				status: 'rejected',
				output: `Duplicate tool call ID "${request.callId}" was rejected to prevent repeating a local action.`,
				evidence: [],
				retrySafe: true,
			};
		}
		const handler = this._handlers.get(name);
		if (!handler) {
			return {
				version: AGENT_TOOL_RUNTIME_VERSION,
				callId: request.callId,
				toolName: name,
				status: 'failed',
				output: `No local driver is registered for agent tool "${name}".`,
				evidence: [],
				retrySafe: true,
			};
		}

		this._seenCallIds.add(request.callId);
		if (this._seenCallIds.size > 512) {
			this._seenCallIds.delete(this._seenCallIds.values().next().value!);
		}
		try {
			const handlerResult = await handler(validation.args, { ...request, toolName: name });
			const normalized: IAgentToolHandlerResult = typeof handlerResult === 'string' ? { output: handlerResult } : handlerResult;
			const status = normalized.status ?? inferStatus(validation.descriptor, normalized.output, normalized.exitCode);
			return {
				version: AGENT_TOOL_RUNTIME_VERSION,
				callId: request.callId,
				toolName: name,
				status,
				output: normalized.output,
				exitCode: normalized.exitCode,
				evidence: normalized.evidence ?? [],
				retrySafe: normalized.retrySafe ?? status === 'rejected',
				details: normalized.details,
			};
		} catch (error) {
			return {
				version: AGENT_TOOL_RUNTIME_VERSION,
				callId: request.callId,
				toolName: name,
				status: 'failed',
				output: `Agent tool "${name}" failed: ${formatAgentToolError(error)}`,
				evidence: [],
				retrySafe: false,
			};
		}
	}
}

function inferStatus(descriptor: IAgentToolDescriptor, output: string, exitCode?: number): AgentToolExecutionStatus {
	if (exitCode !== undefined) {
		return exitCode === 0 ? 'succeeded' : 'failed';
	}
	if (descriptor.risk === 'command') {
		const exitCodeMarker = output.match(/\[Command result: exit code (-?\d+)\]/i)
			?? output.match(/(?:Command failed with exit code|Exit code:)\s*(-?\d+)/i);
		if (exitCodeMarker) {
			return Number(exitCodeMarker[1]) === 0 ? 'succeeded' : 'failed';
		}
	}
	if (/interrupted before its result was known/i.test(output)) {
		return 'unknown';
	}
	if (descriptor.risk === 'command' && /(?:final status unknown|final exit status is unknown|success is not confirmed|result is inconclusive|no confirmed completion status)/i.test(output)) {
		return 'unknown';
	}
	if (/approval was denied|Agent action not run|Tool call rejected/i.test(output)) {
		return 'denied';
	}
	if (/cancelled while running|was cancelled/i.test(output)) {
		return 'cancelled';
	}
	if (/timed out/i.test(output)) {
		return 'timedOut';
	}
	if (descriptor.risk === 'command' && /(?:completion status not reported|did not report completion|without reporting an exit code|not marked successful)/i.test(output)) {
		return 'unknown';
	}
	if (/(?:Command failed|Terminal execution error|execution failed|Browser Agent Error|\[ERROR\]|(?:^|\n)\s*Error:|❌)/i.test(output)) {
		return 'failed';
	}
	if (descriptor.risk === 'command') {
		return 'unknown';
	}
	return output.trim() ? 'succeeded' : 'unknown';
}
