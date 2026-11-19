/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';

type FoundSymbol = {
	symbol: vscode.SymbolInformation | vscode.DocumentSymbol;
	matchCount: number;
};

function findBestSymbol(
	symbols: ReadonlyArray<vscode.SymbolInformation | vscode.DocumentSymbol>,
	symbolParts: readonly string[]
): FoundSymbol | undefined {
	if (!symbolParts.length) {
		return;
	}

	let bestMatch: FoundSymbol | undefined;
	for (const symbol of symbols) {
		if ((symbol as vscode.DocumentSymbol).children) {
			let partMatch = symbol.name === symbolParts[0] ? { symbol, matchCount: 1 } : undefined;
			if (partMatch) {
				const remainingPartMatch = findBestSymbol((symbol as vscode.DocumentSymbol).children, symbolParts.slice(1));
				if (remainingPartMatch) {
					partMatch = { symbol: remainingPartMatch.symbol, matchCount: partMatch.matchCount + remainingPartMatch.matchCount };
				}
			}

			const restMatch = findBestSymbol((symbol as vscode.DocumentSymbol).children, symbolParts);
			let match: FoundSymbol | undefined;
			if (partMatch && restMatch) {
				match = partMatch.matchCount >= restMatch.matchCount ? partMatch : restMatch;
			} else {
				match = partMatch ?? restMatch;
			}

			if (match && (!bestMatch || match.matchCount > bestMatch?.matchCount)) {
				bestMatch = match;
			}
		} else {
			const matchIndex = symbolParts.indexOf(symbol.name);
			if (matchIndex !== -1) {
				const match = { symbol, matchCount: matchIndex + 1 };
				if (!bestMatch || match.matchCount > bestMatch.matchCount) {
					bestMatch = match;
				}
			}
		}
	}

	return bestMatch;
}

export function findBestSymbolByPath(
	symbols: ReadonlyArray<vscode.SymbolInformation | vscode.DocumentSymbol>,
	symbolPath: string
): vscode.SymbolInformation | vscode.DocumentSymbol | undefined {

	return (
		findBestSymbol(symbols, [symbolPath]) ?? findBestSymbol(symbols, extractSymbolNamesInCode(symbolPath))
	)?.symbol;
}

export function extractSymbolNamesInCode(inlineCode: string): string[] {
	return Array.from(inlineCode.matchAll(/[#\w$][\w\d$]*/g), x => x[0]);
}
