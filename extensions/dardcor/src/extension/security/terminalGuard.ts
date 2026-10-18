/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ICommandSecurityAnalysis {
	command: string;
	riskLevel: 'safe' | 'caution' | 'dangerous';
	requiresExplicitApproval: boolean;
	reasons: string[];
}

const CRITICAL_DESTRUCTIVE_PATTERNS = [
	/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+[\/\\]/i,
	/\bdel\s+(?:\/[a-zA-Z]\s+)*[c-zC-Z]:[\/\\]/i,
	/\bformat\s+[c-zC-Z]:/i,
	/\bmkfs\b/i,
	/\bdd\s+if=.*of=\/dev\/(?:sd|hd|nvme)/i,
	/\b(?:reg\s+delete|regedit)\b/i,
	/\bgit\s+reset\s+--hard\b/i,
	/\bgit\s+push\s+(?:.*--force|-f\b)/i,
	/\b(?:shutdown|reboot|init\s+0)\b/i,
	/\bchmod\s+-R\s+777\s+[\/\\]/i,
];

const CAUTION_PATTERNS = [
	/\bgit\s+clean\s+-[a-zA-Z]*f/i,
	/\bnpm\s+publish\b/i,
	/\bdocker\s+(?:system\s+prune|rm\s+-f)\b/i,
	/\bkill(?:all)?\s+-9\b/i,
	/\b(?:curl|wget)\b.*\|\s*(?:bash|sh|powershell|cmd)\b/i,
];

export class TerminalSecurityGuard {
	public static analyzeCommand(command: string, workspaceRoot?: string): ICommandSecurityAnalysis {
		const trimmed = command.trim();
		const reasons: string[] = [];
		let riskLevel: 'safe' | 'caution' | 'dangerous' = 'safe';

		for (const pattern of CRITICAL_DESTRUCTIVE_PATTERNS) {
			if (pattern.test(trimmed)) {
				riskLevel = 'dangerous';
				reasons.push(`Command matches critical destructive pattern: ${pattern.source}`);
				break;
			}
		}

		if (riskLevel !== 'dangerous') {
			for (const pattern of CAUTION_PATTERNS) {
				if (pattern.test(trimmed)) {
					riskLevel = 'caution';
					reasons.push(`Command requires caution: matches pattern ${pattern.source}`);
					break;
				}
			}
		}

		if (workspaceRoot && riskLevel === 'safe') {
			if (trimmed.includes('../../../') || trimmed.includes('..\\..\\..\\')) {
				riskLevel = 'caution';
				reasons.push('Command contains deep parent directory traversal (../../../) outside local context.');
			}
		}

		return {
			command: trimmed,
			riskLevel,
			requiresExplicitApproval: riskLevel === 'dangerous',
			reasons,
		};
	}
}
