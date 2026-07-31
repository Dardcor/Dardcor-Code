/**
 * Dardcor Code - Editor View Model (Task 209)
 * Mirrors: vs/editor/common/viewModel/viewModelImpl.ts
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { ITextModel, Position } from '../model/text-model.js';


export interface IViewModel {
	readonly onDidChangeViewLineCount: Event<{ count: number }>;
	getLineCount(): number;
	getLineContent(viewLineNumber: number): string;
	modelPositionToViewPosition(modelPosition: Position): Position;
	viewPositionToModelPosition(viewPosition: Position): Position;
}

export class ViewModel extends Disposable implements IViewModel {
	private readonly _onDidChangeViewLineCount = this._register(new Emitter<{ count: number }>());
	readonly onDidChangeViewLineCount: Event<{ count: number }> = this._onDidChangeViewLineCount.event;

	constructor(private readonly _model: ITextModel) {
		super();
		this._register(this._model.onDidChangeContent(() => {
			this._onDidChangeViewLineCount.fire({ count: this.getLineCount() });
		}));
	}

	getLineCount(): number {
		return this._model.getLineCount();
	}

	getLineContent(viewLineNumber: number): string {
		return this._model.getLineContent(viewLineNumber);
	}

	modelPositionToViewPosition(modelPosition: Position): Position {
		return modelPosition; // 1:1 mapping when folding is not active
	}

	viewPositionToModelPosition(viewPosition: Position): Position {
		return viewPosition;
	}
}
