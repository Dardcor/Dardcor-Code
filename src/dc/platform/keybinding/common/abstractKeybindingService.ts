/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from '../../../base/common/actions.js';
import * as arrays from '../../../base/common/arrays.js';
import { IntervalTimer, TimeoutTimer } from '../../../base/common/async.js';
import { illegalState } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { IME } from '../../../base/common/ime.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { Keybinding, ResolvedChord, ResolvedKeybinding, SingleModifierChord } from '../../../base/common/keybindings.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import * as nls from '../../../nls.js';

import { ICommandService } from '../../commands/common/commands.js';
import { IContextKeyService, IContextKeyServiceTarget } from '../../contextkey/common/contextkey.js';
import { IKeybindingService, IKeyboardEvent, KeybindingsSchemaContribution } from './keybinding.js';
import { ResolutionResult, KeybindingResolver, ResultKind, NoMatchingKb } from './keybindingResolver.js';
import { ResolvedKeybindingItem } from './resolvedKeybindingItem.js';
import { ILogService } from '../../log/common/log.js';
import { INotificationService, IStatusHandle } from '../../notification/common/notification.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';

interface CurrentChord {
	keypress: string;
	label: string | null;
}

const HIGH_FREQ_COMMANDS = /^(cursor|delete|undo|redo|tab|editor\.action\.clipboard)/;

function isKeyInComposition(e: IKeyboardEvent): boolean {
	return e.keyCode === KeyCode.KEY_IN_COMPOSITION;
}

export abstract class AbstractKeybindingService extends Disposable implements IKeybindingService {

	public _serviceBrand: undefined;

	protected readonly _onDidUpdateKeybindings: Emitter<void> = this._register(new Emitter<void>());
	get onDidUpdateKeybindings(): Event<void> {
		return this._onDidUpdateKeybindings ? this._onDidUpdateKeybindings.event : Event.None;
	}

	private _currentChords: CurrentChord[];

	private _currentChordChecker: IntervalTimer;
	private _currentChordStatusMessage: IStatusHandle | null;
	private _ignoreSingleModifiers: KeybindingModifierSet;
	private _currentSingleModifier: SingleModifierChord | null;
	private _currentSingleModifierClearTimeout: TimeoutTimer;
	protected _currentlyDispatchingCommandId: string | null;

	protected _logging: boolean;

	public get inChordMode(): boolean {
		return this._currentChords.length > 0;
	}

	constructor(
		private _contextKeyService: IContextKeyService,
		protected _commandService: ICommandService,
		protected _telemetryService: ITelemetryService,
		private _notificationService: INotificationService,
		protected _logService: ILogService,
	) {
		super();

		this._currentChords = [];
		this._currentChordChecker = new IntervalTimer();
		this._currentChordStatusMessage = null;
		this._ignoreSingleModifiers = KeybindingModifierSet.EMPTY;
		this._currentSingleModifier = null;
		this._currentSingleModifierClearTimeout = new TimeoutTimer();
		this._currentlyDispatchingCommandId = null;
		this._logging = false;
	}


	protected abstract _getResolver(): KeybindingResolver;
	protected abstract _documentHasFocus(): boolean;
	public abstract resolveKeybinding(keybinding: Keybinding): ResolvedKeybinding[];
	public abstract resolveKeyboardEvent(keyboardEvent: IKeyboardEvent): ResolvedKeybinding;
	public abstract resolveUserBinding(userBinding: string): ResolvedKeybinding[];
	public abstract registerSchemaContribution(contribution: KeybindingsSchemaContribution): IDisposable;
	public abstract _dumpDebugInfo(): string;
	public abstract _dumpDebugInfoJSON(): string;

	public getDefaultKeybindingsContent(): string {
		return '';
	}

	public toggleLogging(): boolean {
		this._logging = !this._logging;
		return this._logging;
	}

	protected _log(str: string): void {
		if (this._logging) {
			this._logService.info(`[KeybindingService]: ${str}`);
		}
	}

	public getDefaultKeybindings(): readonly ResolvedKeybindingItem[] {
		return this._getResolver().getDefaultKeybindings();
	}

	public getKeybindings(): readonly ResolvedKeybindingItem[] {
		return this._getResolver().getKeybindings();
	}

	public customKeybindingsCount(): number {
		return 0;
	}

	public lookupKeybindings(commandId: string): ResolvedKeybinding[] {
		return arrays.coalesce(
			this._getResolver().lookupKeybindings(commandId).map(item => item.resolvedKeybinding)
		);
	}

	public lookupKeybinding(commandId: string, context?: IContextKeyService, enforceContextCheck = false): ResolvedKeybinding | undefined {
		const result = this._getResolver().lookupPrimaryKeybinding(commandId, context || this._contextKeyService, enforceContextCheck);
		if (!result) {
			return undefined;
		}
		return result.resolvedKeybinding;
	}

	public dispatchEvent(e: IKeyboardEvent, target: IContextKeyServiceTarget): boolean {
		return this._dispatch(e, target);
	}

	public softDispatch(e: IKeyboardEvent, target: IContextKeyServiceTarget): ResolutionResult {
		this._log(`/ Soft dispatching keyboard event`);
		if (isKeyInComposition(e)) {
			this._log(`\\ Keyboard event is part of an IME composition`);
			return NoMatchingKb;
		}
		const keybinding = this.resolveKeyboardEvent(e);
		if (keybinding.hasMultipleChords()) {
			console.warn('keyboard event should not be mapped to multiple chords');
			return NoMatchingKb;
		}
		const [firstChord,] = keybinding.getDispatchChords();
		if (firstChord === null) {
			this._log(`\\ Keyboard event cannot be dispatched`);
			return NoMatchingKb;
		}

		const contextValue = this._contextKeyService.getContext(target);
		const currentChords = this._currentChords.map((({ keypress }) => keypress));
		return this._getResolver().resolve(contextValue, currentChords, firstChord);
	}

	private _scheduleLeaveChordMode(): void {
		const chordLastInteractedTime = Date.now();
		this._currentChordChecker.cancelAndSet(() => {

			if (!this._documentHasFocus()) {
				this._leaveChordMode();
				return;
			}

			if (Date.now() - chordLastInteractedTime > 5000) {
				this._leaveChordMode();
			}

		}, 500);
	}

	private _expectAnotherChord(firstChord: string, keypressLabel: string | null): void {

		this._currentChords.push({ keypress: firstChord, label: keypressLabel });

		switch (this._currentChords.length) {
			case 0:
				throw illegalState('impossible');
			case 1:
				this._currentChordStatusMessage = this._notificationService.status(nls.localize('first.chord', "({0}) was pressed. Waiting for second key of chord...", keypressLabel));
				break;
			default: {
				const fullKeypressLabel = this._currentChords.map(({ label }) => label).join(', ');
				this._currentChordStatusMessage = this._notificationService.status(nls.localize('next.chord', "({0}) was pressed. Waiting for next key of chord...", fullKeypressLabel));
			}
		}

		this._scheduleLeaveChordMode();

		if (IME.enabled) {
			IME.disable();
		}
	}

	private _leaveChordMode(): void {
		if (this._currentChordStatusMessage) {
			this._currentChordStatusMessage.close();
			this._currentChordStatusMessage = null;
		}
		this._currentChordChecker.cancel();
		this._currentChords = [];
		IME.enable();
	}

	public dispatchByUserSettingsLabel(userSettingsLabel: string, target: IContextKeyServiceTarget): void {
		this._log(`/ Dispatching keybinding triggered via menu entry accelerator - ${userSettingsLabel}`);
		const keybindings = this.resolveUserBinding(userSettingsLabel);
		if (keybindings.length === 0) {
			this._log(`\\ Could not resolve - ${userSettingsLabel}`);
		} else {
			this._doDispatch(keybindings[0], target, false);
		}
	}

	protected _dispatch(e: IKeyboardEvent, target: IContextKeyServiceTarget): boolean {
		if (isKeyInComposition(e)) {
			this._log(`+ Ignoring keybinding dispatch because an IME composition is in progress.`);
			return false;
		}
		return this._doDispatch(this.resolveKeyboardEvent(e), target, false);
	}

	protected _singleModifierDispatch(e: IKeyboardEvent, target: IContextKeyServiceTarget): boolean {
		if (isKeyInComposition(e)) {
			return false;
		}
		const keybinding = this.resolveKeyboardEvent(e);
		const [singleModifier,] = keybinding.getSingleModifierDispatchChords();

		if (singleModifier) {

			if (this._ignoreSingleModifiers.has(singleModifier)) {
				this._log(`+ Ignoring single modifier ${singleModifier} due to it being pressed together with other keys.`);
				this._ignoreSingleModifiers = KeybindingModifierSet.EMPTY;
				this._currentSingleModifierClearTimeout.cancel();
				this._currentSingleModifier = null;
				return false;
			}

			this._ignoreSingleModifiers = KeybindingModifierSet.EMPTY;

			if (this._currentSingleModifier === null) {
				this._log(`+ Storing single modifier for possible chord ${singleModifier}.`);
				this._currentSingleModifier = singleModifier;
				this._currentSingleModifierClearTimeout.cancelAndSet(() => {
					this._log(`+ Clearing single modifier due to 300ms elapsed.`);
					this._currentSingleModifier = null;
				}, 300);
				return false;
			}

			if (singleModifier === this._currentSingleModifier) {
				this._log(`/ Dispatching single modifier chord ${singleModifier} ${singleModifier}`);
				this._currentSingleModifierClearTimeout.cancel();
				this._currentSingleModifier = null;
				return this._doDispatch(keybinding, target, true);
			}

			this._log(`+ Clearing single modifier due to modifier mismatch: ${this._currentSingleModifier} ${singleModifier}`);
			this._currentSingleModifierClearTimeout.cancel();
			this._currentSingleModifier = null;
			return false;
		}

		const [firstChord,] = keybinding.getChords();
		this._ignoreSingleModifiers = new KeybindingModifierSet(firstChord);

		if (this._currentSingleModifier !== null) {
			this._log(`+ Clearing single modifier due to other key up.`);
		}
		this._currentSingleModifierClearTimeout.cancel();
		this._currentSingleModifier = null;
		return false;
	}

	private _doDispatch(userKeypress: ResolvedKeybinding, target: IContextKeyServiceTarget, isSingleModiferChord = false): boolean {
		let shouldPreventDefault = false;

		if (userKeypress.hasMultipleChords()) {
			console.warn('Unexpected keyboard event mapped to multiple chords');
			return false;
		}

		let userPressedChord: string | null = null;
		let currentChords: string[] | null = null;

		if (isSingleModiferChord) {
			const [dispatchKeyname,] = userKeypress.getSingleModifierDispatchChords();
			userPressedChord = dispatchKeyname;
			currentChords = dispatchKeyname ? [dispatchKeyname] : [];
		} else {
			[userPressedChord,] = userKeypress.getDispatchChords();
			currentChords = this._currentChords.map(({ keypress }) => keypress);
		}

		if (userPressedChord === null) {
			this._log(`\\ Keyboard event cannot be dispatched in keydown phase.`);
			return shouldPreventDefault;
		}

		const contextValue = this._contextKeyService.getContext(target);
		const keypressLabel = userKeypress.getLabel();

		const resolveResult = this._getResolver().resolve(contextValue, currentChords, userPressedChord);

		switch (resolveResult.kind) {

			case ResultKind.NoMatchingKb: {

				this._logService.trace('KeybindingService#dispatch', keypressLabel, `[ No matching keybinding ]`);

				if (this.inChordMode) {
					const currentChordsLabel = this._currentChords.map(({ label }) => label).join(', ');
					this._log(`+ Leaving multi-chord mode: Nothing bound to "${currentChordsLabel}, ${keypressLabel}".`);
					this._notificationService.status(nls.localize('missing.chord', "The key combination ({0}, {1}) is not a command.", currentChordsLabel, keypressLabel), { hideAfter: 10 * 1000 });
					this._leaveChordMode();

					shouldPreventDefault = true;
				}
				return shouldPreventDefault;
			}

			case ResultKind.MoreChordsNeeded: {

				this._logService.trace('KeybindingService#dispatch', keypressLabel, `[ Several keybindings match - more chords needed ]`);

				shouldPreventDefault = true;
				this._expectAnotherChord(userPressedChord, keypressLabel);
				this._log(this._currentChords.length === 1 ? `+ Entering multi-chord mode...` : `+ Continuing multi-chord mode...`);
				return shouldPreventDefault;
			}

			case ResultKind.KbFound: {

				this._logService.trace('KeybindingService#dispatch', keypressLabel, `[ Will dispatch command ${resolveResult.commandId} ]`);

				if (resolveResult.commandId === null || resolveResult.commandId === '') {

					if (this.inChordMode) {
						const currentChordsLabel = this._currentChords.map(({ label }) => label).join(', ');
						this._log(`+ Leaving chord mode: Nothing bound to "${currentChordsLabel}, ${keypressLabel}".`);
						this._notificationService.status(nls.localize('missing.chord', "The key combination ({0}, {1}) is not a command.", currentChordsLabel, keypressLabel), { hideAfter: 10 * 1000 });
						this._leaveChordMode();
						shouldPreventDefault = true;
					}

				} else {
					if (this.inChordMode) {
						this._leaveChordMode();
					}

					if (!resolveResult.isBubble) {
						shouldPreventDefault = true;
					}

					this._log(`+ Invoking command ${resolveResult.commandId}.`);
					this._currentlyDispatchingCommandId = resolveResult.commandId;
					try {
						if (typeof resolveResult.commandArgs === 'undefined') {
							this._commandService.executeCommand(resolveResult.commandId).then(undefined, err => this._notificationService.warn(err));
						} else {
							this._commandService.executeCommand(resolveResult.commandId, resolveResult.commandArgs).then(undefined, err => this._notificationService.warn(err));
						}
					} finally {
						this._currentlyDispatchingCommandId = null;
					}

					if (!HIGH_FREQ_COMMANDS.test(resolveResult.commandId)) {
						this._telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: resolveResult.commandId, from: 'keybinding', detail: userKeypress.getUserSettingsLabel() ?? undefined });
					}
				}

				return shouldPreventDefault;
			}
		}
	}

	abstract enableKeybindingHoldMode(commandId: string): Promise<void> | undefined;

	mightProducePrintableCharacter(event: IKeyboardEvent): boolean {
		if (event.ctrlKey || event.metaKey) {
			return false;
		}
		if ((event.keyCode >= KeyCode.KeyA && event.keyCode <= KeyCode.KeyZ)
			|| (event.keyCode >= KeyCode.Digit0 && event.keyCode <= KeyCode.Digit9)) {
			return true;
		}
		return false;
	}

	public appendKeybinding(label: string, commandId: string | undefined | null, context?: IContextKeyService, enforceContextCheck?: boolean): string {
		if (commandId) {
			const keybindingLabel = this.lookupKeybinding(commandId, context, enforceContextCheck)?.getLabel();
			if (keybindingLabel) {
				return nls.localize(
					{ key: 'keybindingLabel', comment: ['UI element label', 'A keybinding label'] },
					"{0} ({1})",
					label,
					keybindingLabel);
			}
		}
		return label;
	}
}

class KeybindingModifierSet {

	public static EMPTY = new KeybindingModifierSet(null);

	private readonly _ctrlKey: boolean;
	private readonly _shiftKey: boolean;
	private readonly _altKey: boolean;
	private readonly _metaKey: boolean;

	constructor(source: ResolvedChord | null) {
		this._ctrlKey = source ? source.ctrlKey : false;
		this._shiftKey = source ? source.shiftKey : false;
		this._altKey = source ? source.altKey : false;
		this._metaKey = source ? source.metaKey : false;
	}

	has(modifier: SingleModifierChord) {
		switch (modifier) {
			case 'ctrl': return this._ctrlKey;
			case 'shift': return this._shiftKey;
			case 'alt': return this._altKey;
			case 'meta': return this._metaKey;
		}
	}
}
