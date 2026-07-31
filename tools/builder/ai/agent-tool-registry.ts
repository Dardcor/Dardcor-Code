/**
 * Dardcor Code - Agent Tool Invocation Definitions & Registry (Task 934)
 *
 * Registry of executable agent tools (read_file, write_file, run_command,
 * list_dir, grep_files) with JSON-Schema parameter definitions. Paths are
 * confined to the workspace root; commands run with a shell and are
 * reported verbatim (execution safety is enforced by the agent sandbox).
 */

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface ToolParameter {
	readonly type: 'string' | 'number' | 'boolean' | 'array' | 'object';
	readonly description?: string;
	readonly enum?: readonly (string | number)[];
	readonly items?: ToolParameter;
}

export interface ToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly parameters: Readonly<Record<string, ToolParameter>>;
	readonly required?: readonly string[];
}

export interface ToolContext {
	readonly workspaceRoot: string;
	readonly maxOutputChars?: number;
	readonly timeoutMs?: number;
	readonly allowCommandExecution?: boolean;
}

export interface ToolResult {
	readonly ok: boolean;
	readonly output: string;
	readonly error?: string;
	readonly truncated?: boolean;
}

export type ToolExecutor = (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;

const MAX_OUTPUT = 60_000;

function resolveWithinRoot(root: string, filePath: string): string {
	const resolved = path.resolve(root, filePath);
	const rel = path.relative(root, resolved);
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		throw new Error(`path escapes workspace root: ${filePath}`);
	}
	return resolved;
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	return { text: text.slice(0, maxChars) + '\n... [truncated]', truncated: true };
}

export const builtinTools: readonly ToolDefinition[] = [
	{
		name: 'read_file',
		description: 'Reads a text file from the workspace. Returns raw content with line numbers.',
		parameters: {
			filePath: { type: 'string', description: 'Path relative to the workspace root' },
			startLine: { type: 'number', description: 'First line (1-based) to read' },
			lineCount: { type: 'number', description: 'How many lines to read' },
		},
		required: ['filePath'],
	},
	{
		name: 'write_file',
		description: 'Writes (creates or overwrites) a file inside the workspace.',
		parameters: {
			filePath: { type: 'string', description: 'Path relative to the workspace root' },
			content: { type: 'string', description: 'Full file content to write' },
		},
		required: ['filePath', 'content'],
	},
	{
		name: 'list_dir',
		description: 'Lists directory entries (files and subdirectories) with sizes.',
		parameters: {
			dirPath: { type: 'string', description: 'Directory relative to the workspace root' },
		},
		required: ['dirPath'],
	},
	{
		name: 'grep_files',
		description: 'Searches file contents for a regex pattern, returning matching lines with paths.',
		parameters: {
			pattern: { type: 'string', description: 'Regular expression to search for' },
			include: { type: 'string', description: 'Optional filename filter (e.g. *.ts)' },
		},
		required: ['pattern'],
	},
	{
		name: 'run_command',
		description: 'Runs a shell command in the workspace root (disabled unless allowCommandExecution).',
		parameters: {
			command: { type: 'string', description: 'Command line to execute' },
			cwd: { type: 'string', description: 'Working directory relative to workspace root' },
		},
		required: ['command'],
	},
];

export class AgentToolRegistry {
	private readonly _executors = new Map<string, ToolExecutor>();
	private readonly _definitions = new Map<string, ToolDefinition>();

	constructor() {
		this.registerDefinition(builtinTools[0], this._readFile);
		this.registerDefinition(builtinTools[1], this._writeFile);
		this.registerDefinition(builtinTools[2], this._listDir);
		this.registerDefinition(builtinTools[3], this._grepFiles);
		this.registerDefinition(builtinTools[4], this._runCommand);
	}

	registerDefinition(definition: ToolDefinition, executor: ToolExecutor): void {
		this._definitions.set(definition.name, definition);
		this._executors.set(definition.name, executor);
	}

	getDefinition(name: string): ToolDefinition | undefined {
		return this._definitions.get(name);
	}

	listTools(): ToolDefinition[] {
		return [...this._definitions.values()];
	}

	hasTool(name: string): boolean {
		return this._executors.has(name);
	}

	async execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const definition = this._definitions.get(name);
		const executor = this._executors.get(name);
		if (!definition || !executor) {
			return { ok: false, output: '', error: `unknown tool: ${name}` };
		}
		for (const required of definition.required ?? []) {
			if (args[required] === undefined) {
				return { ok: false, output: '', error: `missing required argument: ${required}` };
			}
		}
		try {
			return await executor(args, context);
		} catch (err) {
			return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
		}
	}

	private _readFile = async (args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
		const file = resolveWithinRoot(context.workspaceRoot, String(args.filePath));
		const content = await readFile(file, 'utf8');
		const lines = content.split('\n');
		const start = Math.max(0, (Number(args.startLine) || 1) - 1);
		const count = Math.max(1, Number(args.lineCount) || lines.length - start);
		const numbered = lines.slice(start, start + count).map((line, i) => `${String(start + i + 1).padStart(5)} | ${line}`);
		const { text, truncated } = truncate(numbered.join('\n'), context.maxOutputChars ?? MAX_OUTPUT);
		return { ok: true, output: text, truncated };
	};

	private _writeFile = async (args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
		const file = resolveWithinRoot(context.workspaceRoot, String(args.filePath));
		const content = String(args.content ?? '');
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, content, 'utf8');
		return { ok: true, output: `wrote ${content.length} chars to ${file}` };
	};

	private _listDir = async (args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
		const dir = resolveWithinRoot(context.workspaceRoot, String(args.dirPath ?? '.'));
		const entries = await readdir(dir, { withFileTypes: true });
		const lines: string[] = [];
		for (const entry of entries) {
			const abs = path.join(dir, entry.name);
			let size = 0;
			try {
				size = entry.isDirectory() ? 0 : (await stat(abs)).size;
			} catch { /* ignore */ }
			lines.push(`${entry.isDirectory() ? 'd' : 'f'} ${size.toString().padStart(10)} ${entry.name}${entry.isDirectory() ? '/' : ''}`);
		}
		return { ok: true, output: lines.join('\n') };
	};

	private _grepFiles = async (args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
		const regex = new RegExp(String(args.pattern));
		const include = args.include ? new RegExp(String(args.include).replace(/\./g, '\\.').replace(/\*/g, '.*')) : null;
		const hits: string[] = [];
		const walk = async (dir: string): Promise<void> => {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
				const abs = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(abs);
					continue;
				}
				if (include && !include.test(entry.name)) continue;
				try {
					const content = await readFile(abs, 'utf8');
					content.split('\n').forEach((line, index) => {
						if (regex.test(line)) hits.push(`${abs}:${index + 1}: ${line.slice(0, 200)}`);
					});
				} catch { /* binary/unreadable */ }
				if (hits.length >= 500) return;
			}
		};
		await walk(context.workspaceRoot);
		const { text, truncated } = truncate(hits.join('\n'), context.maxOutputChars ?? MAX_OUTPUT);
		return { ok: true, output: text || '(no matches)', truncated };
	};

	private _runCommand = async (args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
		if (context.allowCommandExecution !== true) {
			return { ok: false, output: '', error: 'command execution disabled in this context' };
		}
		const command = String(args.command);
		const cwd = args.cwd ? resolveWithinRoot(context.workspaceRoot, String(args.cwd)) : context.workspaceRoot;
		const shell = process.platform === 'win32' ? 'powershell' : '/bin/sh';
		const { stdout, stderr } = await execFileAsync(shell, process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command], {
			cwd,
			timeout: context.timeoutMs ?? 30_000,
			maxBuffer: MAX_OUTPUT,
			windowsHide: true,
		});
		const combined = stdout + (stderr ? '\n[stderr]\n' + stderr : '');
		const { text, truncated } = truncate(combined, context.maxOutputChars ?? MAX_OUTPUT);
		return { ok: true, output: text, truncated };
	};
}

export function createToolRegistry(): AgentToolRegistry {
	return new AgentToolRegistry();
}
