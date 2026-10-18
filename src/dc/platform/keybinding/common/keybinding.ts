/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IJSONSchema } from '../../../base/common/jsonSchema.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { ResolvedKeybinding, Keybinding } from '../../../base/common/keybindings.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { IContextKeyService, IContextKeyServiceTarget } from '../../contextkey/common/contextkey.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ResolutionResult } from './keybindingResolver.js';
import { ResolvedKeybindingItem } from './resolvedKeybindingItem.js';

export interface IUserFriendlyKeybinding {
	key: string;
	command: string;
	args?: any;
	when?: string;
	systemWide?: boolean;
}

export interface IKeyboardEvent {
	readonly _standardKeyboardEventBrand: true;

	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly altGraphKey: boolean;
	readonly keyCode: KeyCode;
	readonly code: string;
}

export interface KeybindingsSchemaContribution {
	readonly onDidChange?: Event<void>;

	getSchemaAdditions(): IJSONSchema[];
}

export const IKeybindingService = createDecorator<IKeybindingService>('keybindingService');

export interface IKeybindingService {
	readonly _serviceBrand: undefined;

	readonly inChordMode: boolean;

	readonly onDidUpdateKeybindings: Event<void>;

	resolveKeybinding(keybinding: Keybinding): ResolvedKeybinding[];

	resolveKeyboardEvent(keyboardEvent: IKeyboardEvent): ResolvedKeybinding;

	resolveUserBinding(userBinding: string): ResolvedKeybinding[];

	dispatchEvent(e: IKeyboardEvent, target: IContextKeyServiceTarget): boolean;

	softDispatch(keyboardEvent: IKeyboardEvent, target: IContextKeyServiceTarget): ResolutionResult;

	enableKeybindingHoldMode(commandId: string): Promise<void> | undefined;

	dispatchByUserSettingsLabel(userSettingsLabel: string, target: IContextKeyServiceTarget): void;

	lookupKeybindings(commandId: string): ResolvedKeybinding[];

	lookupKeybinding(commandId: string, context?: IContextKeyService, enforceContextCheck?: boolean): ResolvedKeybinding | undefined;

	getDefaultKeybindingsContent(): string;

	getDefaultKeybindings(): readonly ResolvedKeybindingItem[];

	getKeybindings(): readonly ResolvedKeybindingItem[];

	customKeybindingsCount(): number;

	mightProducePrintableCharacter(event: IKeyboardEvent): boolean;

	registerSchemaContribution(contribution: KeybindingsSchemaContribution): IDisposable;

	toggleLogging(): boolean;

	appendKeybinding(label: string, commandId: string | undefined | null, context?: IContextKeyService, enforceContextCheck?: boolean): string;

	_dumpDebugInfo(): string;
	_dumpDebugInfoJSON(): string;
}
