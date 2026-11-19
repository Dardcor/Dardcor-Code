/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { Schemas } from '../../../../../base/common/network.js';
import { isIOS, isMacintosh, isWindows } from '../../../../../base/common/platform.js';
import { isObject, isString } from '../../../../../base/common/types.js';
import { localize, localize2 } from '../../../../../nls.js';
import { CONTEXT_ACCESSIBILITY_MODE_ENABLED } from '../../../../../platform/accessibility/common/accessibility.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, type ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
import type { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingsRegistry, KeybindingWeight, type IKeybindings } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { GeneralShellType, TerminalSettingId, WindowsShellType } from '../../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IConfigurationResolverService } from '../../../../services/configurationResolver/common/configurationResolver.js';
import { IHistoryService } from '../../../../services/history/common/history.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { registerTerminalAction } from '../../../terminal/browser/terminalActions.js';
import { TerminalCommandId } from '../../../terminal/common/terminal.js';
import { TerminalContextKeys, TerminalContextKeyStrings } from '../../../terminal/common/terminalContextKey.js';

export const enum TerminalSendSequenceCommandId {
	SendSequence = 'workbench.action.terminal.sendSequence',
}

function toOptionalString(obj: unknown): string | undefined {
	return isString(obj) ? obj : undefined;
}

export const terminalSendSequenceCommand = async (accessor: ServicesAccessor, args: unknown) => {
	const quickInputService = accessor.get(IQuickInputService);
	const configurationResolverService = accessor.get(IConfigurationResolverService);
	const workspaceContextService = accessor.get(IWorkspaceContextService);
	const historyService = accessor.get(IHistoryService);
	const terminalService = accessor.get(ITerminalService);

	const instance = terminalService.activeInstance;
	if (instance) {
		function isTextArg(obj: unknown): obj is { text: string } {
			return isObject(obj) && 'text' in obj;
		}
		let text = isTextArg(args) ? toOptionalString(args.text) : undefined;

		if (!text) {
			text = await quickInputService.input({
				value: '',
				placeHolder: 'Enter sequence to send (supports \\n, \\r, \\xAB)',
				prompt: localize('workbench.action.terminal.sendSequence.prompt', "Enter sequence to send to the terminal"),
			});
			if (!text) {
				return;
			}
			let processedText = text
				.replace(/\\n/g, '\n')
				.replace(/\\r/g, '\r');

			while (true) {
				const match = processedText.match(/\\x([0-9a-fA-F]{2})/);
				if (match === null || match.index === undefined || match.length < 2) {
					break;
				}
				processedText = processedText.slice(0, match.index) + String.fromCharCode(parseInt(match[1], 16)) + processedText.slice(match.index + 4);
			}

			text = processedText;
		}

		const activeWorkspaceRootUri = historyService.getLastActiveWorkspaceRoot(instance.hasRemoteAuthority ? Schemas.vscodeRemote : Schemas.file);
		const lastActiveWorkspaceRoot = activeWorkspaceRootUri ? workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri) ?? undefined : undefined;
		const resolvedText = await configurationResolverService.resolveAsync(lastActiveWorkspaceRoot, text);
		instance.sendText(resolvedText, false);
	}
};

const sendSequenceString = localize2('sendSequence', "Send Sequence");
registerTerminalAction({
	id: TerminalSendSequenceCommandId.SendSequence,
	title: sendSequenceString,
	f1: true,
	metadata: {
		description: sendSequenceString.value,
		args: [{
			name: 'args',
			schema: {
				type: 'object',
				required: ['text'],
				properties: {
					text: {
						description: localize('sendSequence.text.desc', "The sequence of text to send to the terminal"),
						type: 'string'
					}
				},
			}
		}]
	},
	run: (c, accessor, args) => terminalSendSequenceCommand(accessor, args)
});

export function registerSendSequenceKeybinding(text: string, rule: { when?: ContextKeyExpression } & IKeybindings): void {
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: TerminalSendSequenceCommandId.SendSequence,
		weight: KeybindingWeight.WorkbenchContrib,
		when: rule.when || TerminalContextKeys.focus,
		primary: rule.primary,
		mac: rule.mac,
		linux: rule.linux,
		win: rule.win,
		handler: terminalSendSequenceCommand,
		args: { text }
	});
}



const enum Constants {
	CtrlLetterOffset = 64
}

if (isWindows) {
	const ctrlV = String.fromCharCode('V'.charCodeAt(0) - Constants.CtrlLetterOffset);
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: TerminalCommandId.PastePwsh,
		weight: KeybindingWeight.WorkbenchContrib,
		when: ContextKeyExpr.and(TerminalContextKeys.focus, ContextKeyExpr.equals(TerminalContextKeyStrings.ShellType, GeneralShellType.PowerShell), CONTEXT_ACCESSIBILITY_MODE_ENABLED.negate()),
		primary: KeyMod.CtrlCmd | KeyCode.KeyV,
		handler: async accessor => {
			const clipboardService = accessor.get(IClipboardService);
			const commandService = accessor.get(ICommandService);
			if (!await clipboardService.readText() && await clipboardService.hasResources()) {
				return commandService.executeCommand(TerminalCommandId.Paste);
			}
			return commandService.executeCommand(TerminalCommandId.SendSequence, { text: ctrlV });
		}
	});
}

registerSendSequenceKeybinding('\x1b[24~a', {
	when: ContextKeyExpr.and(TerminalContextKeys.focus, ContextKeyExpr.equals(TerminalContextKeyStrings.ShellType, GeneralShellType.PowerShell), TerminalContextKeys.terminalShellIntegrationEnabled, ContextKeyExpr.equals(`config.${TerminalSettingId.EnableWin32InputMode}`, true), CONTEXT_ACCESSIBILITY_MODE_ENABLED.negate()),
	primary: KeyMod.CtrlCmd | KeyCode.Space,
	mac: { primary: KeyMod.WinCtrl | KeyCode.Space }
});
registerSendSequenceKeybinding('\x1b[24~b', {
	when: ContextKeyExpr.and(TerminalContextKeys.focus, ContextKeyExpr.equals(TerminalContextKeyStrings.ShellType, GeneralShellType.PowerShell), TerminalContextKeys.terminalShellIntegrationEnabled, ContextKeyExpr.equals(`config.${TerminalSettingId.EnableWin32InputMode}`, true), CONTEXT_ACCESSIBILITY_MODE_ENABLED.negate()),
	primary: KeyMod.Alt | KeyCode.Space
});
registerSendSequenceKeybinding('\x1b[24~c', {
	when: ContextKeyExpr.and(TerminalContextKeys.focus, ContextKeyExpr.equals(TerminalContextKeyStrings.ShellType, GeneralShellType.PowerShell), TerminalContextKeys.terminalShellIntegrationEnabled, ContextKeyExpr.equals(`config.${TerminalSettingId.EnableWin32InputMode}`, true), CONTEXT_ACCESSIBILITY_MODE_ENABLED.negate()),
	primary: KeyMod.Shift | KeyCode.Enter
});
registerSendSequenceKeybinding('\x1b[24~d', {
	when: ContextKeyExpr.and(TerminalContextKeys.focus, ContextKeyExpr.equals(TerminalContextKeyStrings.ShellType, GeneralShellType.PowerShell), TerminalContextKeys.terminalShellIntegrationEnabled, ContextKeyExpr.equals(`config.${TerminalSettingId.EnableWin32InputMode}`, true), CONTEXT_ACCESSIBILITY_MODE_ENABLED.negate()),
	mac: { primary: KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.RightArrow }
});

registerSendSequenceKeybinding('\x1b[1;2H', {
	when: ContextKeyExpr.and(TerminalContextKeys.focus, ContextKeyExpr.equals(TerminalContextKeyStrings.ShellType, GeneralShellType.PowerShell), ContextKeyExpr.equals(`config.${TerminalSettingId.EnableWin32InputMode}`, true)),
	mac: { primary: KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.LeftArrow }
});

registerSendSequenceKeybinding('\x1b[1;5A', {
	when: ContextKeyExpr.and(TerminalContextKeys.focus),
	primary: KeyMod.Alt | KeyCode.UpArrow
});
registerSendSequenceKeybinding('\x1b[1;5B', {
	when: ContextKeyExpr.and(TerminalContextKeys.focus),
	primary: KeyMod.Alt | KeyCode.DownArrow
});
registerSendSequenceKeybinding('\x1b' + (isMacintosh ? 'f' : '[1;5C'), {
	when: ContextKeyExpr.and(TerminalContextKeys.focus),
	primary: KeyMod.Alt | KeyCode.RightArrow
});
registerSendSequenceKeybinding('\x1b' + (isMacintosh ? 'b' : '[1;5D'), {
	when: ContextKeyExpr.and(TerminalContextKeys.focus),
	primary: KeyMod.Alt | KeyCode.LeftArrow
});

registerSendSequenceKeybinding('\x12', {
	when: ContextKeyExpr.and(TerminalContextKeys.focus, CONTEXT_ACCESSIBILITY_MODE_ENABLED),
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyR,
	mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.KeyR }
});

registerSendSequenceKeybinding('\x07', {
	when: TerminalContextKeys.focus,
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyG,
	mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.KeyG }
});

if (isIOS) {
	registerSendSequenceKeybinding(String.fromCharCode('C'.charCodeAt(0) - Constants.CtrlLetterOffset), {
		when: ContextKeyExpr.and(TerminalContextKeys.focus),
		primary: KeyMod.WinCtrl | KeyCode.KeyC
	});
}

registerSendSequenceKeybinding(String.fromCharCode('W'.charCodeAt(0) - Constants.CtrlLetterOffset), {
	primary: KeyMod.CtrlCmd | KeyCode.Backspace,
	mac: { primary: KeyMod.Alt | KeyCode.Backspace }
});
if (isWindows) {
	registerSendSequenceKeybinding(String.fromCharCode('H'.charCodeAt(0) - Constants.CtrlLetterOffset), {
		when: ContextKeyExpr.and(TerminalContextKeys.focus, ContextKeyExpr.equals(TerminalContextKeyStrings.ShellType, WindowsShellType.CommandPrompt)),
		primary: KeyMod.CtrlCmd | KeyCode.Backspace,
	});
}
registerSendSequenceKeybinding('\u001bd', {
	primary: KeyMod.CtrlCmd | KeyCode.Delete,
	mac: { primary: KeyMod.Alt | KeyCode.Delete }
});
registerSendSequenceKeybinding('\u0015', {
	mac: { primary: KeyMod.CtrlCmd | KeyCode.Backspace }
});
registerSendSequenceKeybinding(String.fromCharCode('A'.charCodeAt(0) - 64), {
	mac: { primary: KeyMod.CtrlCmd | KeyCode.LeftArrow }
});
registerSendSequenceKeybinding(String.fromCharCode('E'.charCodeAt(0) - 64), {
	mac: { primary: KeyMod.CtrlCmd | KeyCode.RightArrow }
});
registerSendSequenceKeybinding('\u0000', {
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Digit2,
	mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.Digit2 }
});
registerSendSequenceKeybinding('\u001e', {
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Digit6,
	mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.Digit6 }
});
