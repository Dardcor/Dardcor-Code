/**
 * Dardcor Code - Editor Document Input Representation Base Class
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { URI } from '../../../core/types/uri';
import { Path } from '../../../core/types/path';
import { ITextModel, TextModel } from '../../../engine/model/text-model';

export abstract class EditorInput extends Disposable {
	private _isDirty = false;
	private _textModel: ITextModel | null = null;
	private readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty: Event<void> = this._onDidChangeDirty.event;

	constructor(public readonly uri: URI) {
		super();
	}

	abstract getName(): string;
	abstract getDescription(): string;

	getLabel(): string {
		const name = this.getName();
		const description = this.getDescription();
		return description ? `${name} - ${description}` : name;
	}

	get isDirty(): boolean {
		return this._isDirty;
	}

	setDirty(dirty: boolean): void {
		if (this._isDirty === dirty) {
			return;
		}
		this._isDirty = dirty;
		this._onDidChangeDirty.fire();
	}

	matches(other: EditorInput): boolean {
		return this.uri.toString() === other.uri.toString();
	}

	toKey(): string {
		return this.uri.toString();
	}

	getTextModel(): ITextModel | null {
		if (!this._textModel) {
			this._textModel = new TextModel(this.uri, this.getInitialContent());
		}
		return this._textModel;
	}

	protected getInitialContent(): string {
		return '';
	}
}

export class FileEditorInput extends EditorInput {
	constructor(
		uri: URI,
		private readonly _initialContent?: string
	) {
		super(uri);
	}

	getName(): string {
		return Path.basename(this.uri.path);
	}

	getDescription(): string {
		return Path.dirname(this.uri.path);
	}

	protected getInitialContent(): string {
		return this._initialContent ?? '';
	}
}

let untitledCounter = 0;

export class UntitledEditorInput extends EditorInput {
	private readonly _label: string;

	constructor() {
		super(URI.from({ scheme: 'untitled', path: `Untitled-${++untitledCounter}` }));
		this._label = `Untitled-${untitledCounter}`;
	}

	getName(): string {
		return this._label;
	}

	getDescription(): string {
		return '';
	}
}
