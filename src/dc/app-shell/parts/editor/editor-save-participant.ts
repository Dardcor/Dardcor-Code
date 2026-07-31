/**
 * Dardcor Code - Post-Save Edit Transformation Pipeline Hooks
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { EditorInput } from './editor-input';
import { ITextModel } from '../../../engine/model/text-model';

export const enum SaveParticipantReason {
	MANUAL = 'manual',
	AUTO = 'auto',
	EXIT = 'exit',
}

export interface ISaveParticipantContext {
	readonly reason: SaveParticipantReason;
	readonly model: ITextModel;
	readonly input: EditorInput;
}

export interface ISaveParticipant {
	readonly id: string;
	readonly order: number;
	participate(context: ISaveParticipantContext): void | Promise<void>;
}

export interface ISaveParticipantEvent {
	readonly participantId: string;
	readonly input: EditorInput;
	readonly error: Error | null;
}

export interface IEditorSaveParticipantOptions {
	readonly trimTrailingWhitespace?: boolean;
	readonly insertFinalNewline?: boolean;
	readonly trimFinalNewlines?: boolean;
	readonly formatOnSave?: boolean;
}

export class EditorSaveParticipant extends Disposable {
	private readonly _participants: ISaveParticipant[] = [];
	private readonly _options: IEditorSaveParticipantOptions;

	private readonly _onDidRunParticipant = this._register(new Emitter<ISaveParticipantEvent>());
	readonly onDidRunParticipant: Event<ISaveParticipantEvent> = this._onDidRunParticipant.event;

	private readonly _onDidRunPipeline = this._register(new Emitter<{ input: EditorInput; reason: SaveParticipantReason; count: number }>());
	readonly onDidRunPipeline: Event<{ input: EditorInput; reason: SaveParticipantReason; count: number }> = this._onDidRunPipeline.event;

	constructor(options: IEditorSaveParticipantOptions = {}) {
		super();
		this._options = options;
		this._registerBuiltInParticipants();
	}

	get participantCount(): number {
		return this._participants.length;
	}

	registerParticipant(participant: ISaveParticipant): IDisposable {
		this._participants.push(participant);
		this._participants.sort((a, b) => a.order - b.order);
		return {
			dispose: () => {
				const idx = this._participants.indexOf(participant);
				if (idx !== -1) {
					this._participants.splice(idx, 1);
				}
			}
		};
	}

	async runParticipants(input: EditorInput, reason: SaveParticipantReason = SaveParticipantReason.MANUAL): Promise<void> {
		const model = input.getTextModel();
		if (!model) {
			return;
		}
		const context: ISaveParticipantContext = { reason, model, input };
		let ran = 0;
		for (const participant of this._participants) {
			try {
				await participant.participate(context);
				ran++;
				this._onDidRunParticipant.fire({ participantId: participant.id, input, error: null });
			} catch (err) {
				const error = err instanceof Error ? err : new Error(String(err));
				this._onDidRunParticipant.fire({ participantId: participant.id, input, error });
			}
		}
		this._onDidRunPipeline.fire({ input, reason, count: ran });
	}

	participantsFor(input: EditorInput): ISaveParticipant[] {
		return this._participants.filter(p => this._participantApplies(p, input));
	}

	private _participantApplies(participant: ISaveParticipant, input: EditorInput): boolean {
		if (participant.id === 'trimTrailingWhitespace') {
			return this._options.trimTrailingWhitespace ?? false;
		}
		if (participant.id === 'insertFinalNewline') {
			return this._options.insertFinalNewline ?? true;
		}
		if (participant.id === 'trimFinalNewlines') {
			return this._options.trimFinalNewlines ?? false;
		}
		if (participant.id === 'formatOnSave') {
			return this._options.formatOnSave ?? false;
		}
		return true;
	}

	private _registerBuiltInParticipants(): void {
		this._registerParticipant({
			id: 'trimTrailingWhitespace',
			order: 10,
			participate: context => this._trimTrailingWhitespace(context.model),
		});
		this._registerParticipant({
			id: 'insertFinalNewline',
			order: 20,
			participate: context => this._insertFinalNewline(context.model),
		});
		this._registerParticipant({
			id: 'trimFinalNewlines',
			order: 30,
			participate: context => this._trimFinalNewlines(context.model),
		});
		this._registerParticipant({
			id: 'formatOnSave',
			order: 40,
			participate: context => this._formatOnSave(context.model),
		});
	}

	private _registerParticipant(participant: ISaveParticipant): void {
		const raw = participant.participate;
		participant.participate = context => {
			if (!this._participantApplies(participant, context.input)) {
				return;
			}
			return raw(context);
		};
		this._participants.push(participant);
	}

	private _trimTrailingWhitespace(model: ITextModel): void {
		const lines = model.getValue().split(/\r?\n/);
		let changed = false;
		const trimmed = lines.map(line => {
			const newLine = line.replace(/[ \t]+$/, '');
			if (newLine !== line) {
				changed = true;
			}
			return newLine;
		});
		if (changed) {
			model.setValue(trimmed.join('\n'));
		}
	}

	private _insertFinalNewline(model: ITextModel): void {
		const value = model.getValue();
		if (value.length > 0 && !value.endsWith('\n')) {
			model.setValue(value + '\n');
		}
	}

	private _trimFinalNewlines(model: ITextModel): void {
		const value = model.getValue();
		const trimmed = value.replace(/[\r\n]+$/, '');
		if (trimmed !== value) {
			model.setValue(trimmed + '\n');
		}
	}

	private _formatOnSave(model: ITextModel): void {
		const value = model.getValue();
		if (!value) {
			return;
		}
		const lines = value.split(/\r?\n/);
		let inBlockComment = false;
		const normalized = lines.map(line => {
			const stripped = line.replace(/[ \t]+$/, '');
			const isContinuation = inBlockComment || /^\s*(\/\/|\/\*|\*)/.test(stripped);
			const indentMatch = stripped.match(/^[ \t]+/);
			const baseIndent = indentMatch ? indentMatch[0].replace(/ {4}/g, '\t').length : 0;
			const trimmed = stripped.replace(/^[ \t]+/, '');
			if (trimmed.startsWith('/*')) {
				inBlockComment = true;
			}
			if (trimmed.includes('*/')) {
				inBlockComment = false;
			}
			if (!trimmed && isContinuation) {
				return '';
			}
			return '\t'.repeat(Math.max(0, baseIndent)) + trimmed;
		});
		model.setValue(normalized.join('\n'));
	}

	dispose(): void {
		this._participants.length = 0;
		super.dispose();
	}
}
