/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const powershellAutoApproveRules: Readonly<Record<string, boolean>> = {
	'Get-ChildItem': true,
	'Get-Content': true,
	'Get-Date': true,
	'Get-Random': true,
	'Get-Location': true,
	'Set-Location': true,
	'Write-Host': true,
	'Write-Output': true,
	'Out-String': true,
	'Split-Path': true,
	'Join-Path': true,
	'Start-Sleep': true,
	'Where-Object': true,
	'Select-Object': true,
	'Select-String': true,
	'Measure-Object': true,
	'Compare-Object': true,
	'Format-List': true,
	'Format-Table': true,
	'Sort-Object': true,
};
