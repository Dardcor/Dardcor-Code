/**
 * Dardcor Code - Snippet Variable Resolver (TM_FILENAME, CURRENT_YEAR, ...)
 */

import { URI } from "../../../core/types/uri.js";
import { generateUuid } from "../../../core/types/uuid.js";

export interface ISnippetVariableEnvironment {
	readonly uri?: URI | null;
	readonly lineNumber?: number;
	readonly column?: number;
	readonly currentLine?: string;
	readonly selectedText?: string;
	readonly clipboard?: string;
	readonly workspaceName?: string;
	readonly now?: Date;
}

const VARIABLE_NAMES = [
	"TM_FILENAME", "TM_FILENAME_BASE", "TM_DIRECTORY", "TM_FILEPATH", "TM_RELATIVE_FILE",
	"TM_LINE_INDEX", "TM_LINE_NUMBER", "TM_CURRENT_LINE", "TM_CURSOR_INDEX", "TM_CURSOR_LINE_NUMBER",
	"TM_SELECTED_TEXT", "TM_SELECTED_TEXT_LENGTH", "CLIPBOARD", "WORKSPACE_NAME",
	"CURRENT_YEAR", "CURRENT_YEAR_SHORT", "CURRENT_MONTH", "CURRENT_MONTH_NAME",
	"CURRENT_MONTH_NAME_SHORT", "CURRENT_DATE", "CURRENT_DAY_NAME", "CURRENT_DAY_NAME_SHORT",
	"CURRENT_HOUR", "CURRENT_MINUTE", "CURRENT_SECOND", "RANDOM", "RANDOM_HEX", "UUID"
];

function basename(path: string): string {
	const parts = path.split("/");
	return parts[parts.length - 1] || path;
}

function dirname(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.substring(0, index);
}

export class SnippetVariables {
	public static isVariableName(name: string): boolean {
		return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
	}

	public static resolveName(name: string, env: ISnippetVariableEnvironment): string | undefined {
		const now = env.now ?? new Date();
		const uri = env.uri ?? null;
		const filePath = uri?.path ?? "";
		const fileName = filePath ? basename(filePath) : "";
		const base = fileName.replace(/\.[^.]+$/, "");
		const twoDigit = (n: number) => String(n).padStart(2, "0");

		switch (name) {
			case "TM_FILENAME":
				return fileName;
			case "TM_FILENAME_BASE":
				return base;
			case "TM_DIRECTORY":
				return filePath ? dirname(filePath) : "";
			case "TM_FILEPATH":
				return filePath;
			case "TM_RELATIVE_FILE":
				return filePath;
			case "TM_LINE_INDEX":
				return String(Math.max(0, (env.lineNumber ?? 1) - 1));
			case "TM_LINE_NUMBER":
				return String(env.lineNumber ?? 1);
			case "TM_CURRENT_LINE":
				return env.currentLine ?? "";
			case "TM_CURSOR_INDEX":
				return String(Math.max(0, (env.column ?? 1) - 1));
			case "TM_CURSOR_LINE_NUMBER":
				return String(env.lineNumber ?? 1);
			case "TM_SELECTED_TEXT":
				return env.selectedText ?? "";
			case "TM_SELECTED_TEXT_LENGTH":
				return String(env.selectedText?.length ?? 0);
			case "CLIPBOARD":
				return env.clipboard ?? "";
			case "WORKSPACE_NAME":
				return env.workspaceName ?? "";
			case "CURRENT_YEAR":
				return String(now.getFullYear());
			case "CURRENT_YEAR_SHORT":
				return String(now.getFullYear()).slice(-2);
			case "CURRENT_MONTH":
				return twoDigit(now.getMonth() + 1);
			case "CURRENT_MONTH_NAME":
				return now.toLocaleString("en", { month: "long" });
			case "CURRENT_MONTH_NAME_SHORT":
				return now.toLocaleString("en", { month: "short" });
			case "CURRENT_DATE":
				return twoDigit(now.getDate());
			case "CURRENT_DAY_NAME":
				return now.toLocaleString("en", { weekday: "long" });
			case "CURRENT_DAY_NAME_SHORT":
				return now.toLocaleString("en", { weekday: "short" });
			case "CURRENT_HOUR":
				return twoDigit(now.getHours());
			case "CURRENT_MINUTE":
				return twoDigit(now.getMinutes());
			case "CURRENT_SECOND":
				return twoDigit(now.getSeconds());
			case "RANDOM":
				return String(Math.floor(Math.random() * 100000));
			case "RANDOM_HEX":
				return Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, "0");
			case "UUID":
				return generateUuid();
			default:
				return undefined;
		}
	}

	public static resolve(env: ISnippetVariableEnvironment): Record<string, string> {
		const result: Record<string, string> = {};
		for (const name of VARIABLE_NAMES) {
			result[name] = SnippetVariables.resolveName(name, env) ?? "";
		}
		return result;
	}

	public static resolveNames(names: readonly string[], env: ISnippetVariableEnvironment): Record<string, string | undefined> {
		const result: Record<string, string | undefined> = {};
		for (const name of names) {
			result[name] = SnippetVariables.resolveName(name, env);
		}
		return result;
	}

	public static getVariableNames(): readonly string[] {
		return VARIABLE_NAMES;
	}
}
