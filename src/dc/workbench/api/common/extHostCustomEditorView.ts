import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostCustomEditorView {
	// Represents the visual part of a custom editor
	constructor(public readonly viewType: string) {}
}
