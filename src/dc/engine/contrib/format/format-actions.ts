/**
 * Dardcor Code - Format Document / Format Selection Commands
 */

import { ITextModel, IRange } from "../../model/text-model.js";
import { FormatController, IFormattingOptions } from "./format-controller.js";

export interface IFormatActionHost {
	getModel(): ITextModel | null;
	getSelection(): IRange | null;
}

export interface IFormatActionResult {
	readonly handled: boolean;
	readonly editCount: number;
}

export enum FormatActionId {
	FormatDocument = "dc.editor.formatDocument",
	FormatSelection = "dc.editor.formatSelection"
}

/**
 * Command actions for "Format Document" and "Format Selection". They are
 * plain functions over a host + FormatController so they can be wired into
 * the command registry, keybindings or menu items.
 */
export class FormatActions {
	public static async formatDocument(host: IFormatActionHost, controller: FormatController, options?: Partial<IFormattingOptions>): Promise<IFormatActionResult> {
		const model = host.getModel();
		if (!model || controller.isFormatting()) {
			return { handled: false, editCount: 0 };
		}
		const formattingOptions: IFormattingOptions = { tabSize: 4, insertSpaces: true, ...options };
		const editCount = await this._runWithCount(() => controller.formatDocument(model, formattingOptions), controller);
		return { handled: editCount > 0, editCount };
	}

	public static async formatSelection(host: IFormatActionHost, controller: FormatController, options?: Partial<IFormattingOptions>): Promise<IFormatActionResult> {
		const model = host.getModel();
		const selection = host.getSelection();
		if (!model || !selection || controller.isFormatting()) {
			return { handled: false, editCount: 0 };
		}
		const formattingOptions: IFormattingOptions = { tabSize: 4, insertSpaces: true, ...options };
		const editCount = await this._runWithCount(() => controller.formatRange(model, selection, formattingOptions), controller);
		return { handled: editCount > 0, editCount };
	}

	public static isFormatActionId(id: string): id is FormatActionId {
		return id === FormatActionId.FormatDocument || id === FormatActionId.FormatSelection;
	}

	public static execute(host: IFormatActionHost, controller: FormatController, id: FormatActionId): Promise<IFormatActionResult> {
		switch (id) {
			case FormatActionId.FormatDocument:
				return FormatActions.formatDocument(host, controller);
			case FormatActionId.FormatSelection:
				return FormatActions.formatSelection(host, controller);
			default:
				return Promise.resolve({ handled: false, editCount: 0 });
		}
	}

	private static async _runWithCount(fn: () => Promise<boolean>, controller: FormatController): Promise<number> {
		let editCount = 0;
		const handler = (event: { edits: number }) => {
			editCount = event.edits;
		};
		const subscription = controller.onDidFormat(handler);
		try {
			await fn();
		} finally {
			subscription.dispose();
		}
		return editCount;
	}
}

/**
 * Binder that captures the controller so format actions can be invoked
 * without threading dependencies at every call site.
 */
export class FormatActionBinder {
	constructor(
		private readonly _host: IFormatActionHost,
		private readonly _controller: FormatController
	) {}

	public formatDocument(): Promise<IFormatActionResult> {
		return FormatActions.formatDocument(this._host, this._controller);
	}

	public formatSelection(): Promise<IFormatActionResult> {
		return FormatActions.formatSelection(this._host, this._controller);
	}
}
