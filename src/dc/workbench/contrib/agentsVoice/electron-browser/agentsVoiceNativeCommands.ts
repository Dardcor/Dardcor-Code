/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';


CommandsRegistry.registerCommand('_agentsVoice.setWindowAlwaysOnTop', async (accessor, alwaysOnTop: boolean, targetWindowId: number) => {
	const nativeHostService = accessor.get(INativeHostService);
	await nativeHostService.setWindowAlwaysOnTop(alwaysOnTop, { targetWindowId });
});

CommandsRegistry.registerCommand('_agentsVoice.minimizeWindow', async (accessor, targetWindowId: number) => {
	const nativeHostService = accessor.get(INativeHostService);
	await nativeHostService.minimizeWindow({ targetWindowId });
});
