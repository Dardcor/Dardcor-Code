/**
 * Dardcor Code - Folding Command Bindings (Fold All / Unfold All)
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { FoldingModel } from "./folding-model.js";

export interface IFoldingCommandHost {
	getFoldingModel(): FoldingModel | null;
	revealLine(lineNumber: number): void;
}

export interface IFoldingCommandResult {
	readonly affectedRegions: number;
}

export enum FoldingCommandId {
	FoldAll = "dc.editor.foldAll",
	UnfoldAll = "dc.editor.unfoldAll",
	FoldLevel1 = "dc.editor.foldLevel1",
	FoldLevel2 = "dc.editor.foldLevel2",
	FoldLevel3 = "dc.editor.foldLevel3",
	FoldLevel4 = "dc.editor.foldLevel4",
	Fold = "dc.editor.fold",
	Unfold = "dc.editor.unfold",
	ToggleFold = "dc.editor.toggleFold"
}

export interface IFoldingCommand {
	readonly id: FoldingCommandId;
	run(): IFoldingCommandResult;
}

/**
 * Implements the fold/unfold command actions. The commands are plain
 * functions callable from a controller (or command registry) - each returns a
 * result describing how many regions were affected.
 */
export class FoldingCommands {
	public static readonly AllCommands: readonly FoldingCommandId[] = [
		FoldingCommandId.FoldAll,
		FoldingCommandId.UnfoldAll,
		FoldingCommandId.FoldLevel1,
		FoldingCommandId.FoldLevel2,
		FoldingCommandId.FoldLevel3,
		FoldingCommandId.FoldLevel4,
		FoldingCommandId.Fold,
		FoldingCommandId.Unfold,
		FoldingCommandId.ToggleFold
	];

	public static foldAll(host: IFoldingCommandHost): IFoldingCommandResult {
		const model = host.getFoldingModel();
		if (!model) {
			return { affectedRegions: 0 };
		}
		const count = model.getAllRegions().length;
		model.collapseAll();
		return { affectedRegions: count };
	}

	public static unfoldAll(host: IFoldingCommandHost): IFoldingCommandResult {
		const model = host.getFoldingModel();
		if (!model) {
			return { affectedRegions: 0 };
		}
		const count = model.getCollapsedRegions().length;
		model.expandAll();
		return { affectedRegions: count };
	}

	public static foldLevel(host: IFoldingCommandHost, level: number): IFoldingCommandResult {
		const model = host.getFoldingModel();
		if (!model) {
			return { affectedRegions: 0 };
		}
		let count = 0;
		for (const region of model.getAllRegions()) {
			if (region.indentLevel < level && !region.isCollapsed) {
				region.isCollapsed = true;
				count++;
			}
		}
		return { affectedRegions: count };
	}

	public static fold(host: IFoldingCommandHost, lineNumber: number): IFoldingCommandResult {
		const model = host.getFoldingModel();
		if (!model) {
			return { affectedRegions: 0 };
		}
		model.collapse(lineNumber);
		return { affectedRegions: 1 };
	}

	public static unfold(host: IFoldingCommandHost, lineNumber: number): IFoldingCommandResult {
		const model = host.getFoldingModel();
		if (!model) {
			return { affectedRegions: 0 };
		}
		model.expand(lineNumber);
		return { affectedRegions: 1 };
	}

	public static toggleFold(host: IFoldingCommandHost, lineNumber: number): IFoldingCommandResult {
		const model = host.getFoldingModel();
		if (!model) {
			return { affectedRegions: 0 };
		}
		model.toggle(lineNumber);
		return { affectedRegions: 1 };
	}

	public static createCommand(host: IFoldingCommandHost, id: FoldingCommandId, lineNumber: number = -1): IFoldingCommand {
		return {
			id,
			run: () => FoldingCommands.execute(host, id, lineNumber)
		};
	}

	public static execute(host: IFoldingCommandHost, id: FoldingCommandId, lineNumber: number = -1): IFoldingCommandResult {
		switch (id) {
			case FoldingCommandId.FoldAll:
				return FoldingCommands.foldAll(host);
			case FoldingCommandId.UnfoldAll:
				return FoldingCommands.unfoldAll(host);
			case FoldingCommandId.FoldLevel1:
				return FoldingCommands.foldLevel(host, 2);
			case FoldingCommandId.FoldLevel2:
				return FoldingCommands.foldLevel(host, 3);
			case FoldingCommandId.FoldLevel3:
				return FoldingCommands.foldLevel(host, 4);
			case FoldingCommandId.FoldLevel4:
				return FoldingCommands.foldLevel(host, 5);
			case FoldingCommandId.Fold:
				return FoldingCommands.fold(host, lineNumber);
			case FoldingCommandId.Unfold:
				return FoldingCommands.unfold(host, lineNumber);
			case FoldingCommandId.ToggleFold:
				return FoldingCommands.toggleFold(host, lineNumber);
			default:
				return { affectedRegions: 0 };
		}
	}
}

/**
 * Thin binder that keeps a reference to a host and exposes runnable command
 * objects - usable both from a controller and from the command registry.
 */
export class FoldingCommandBinder extends Disposable {
	constructor(private readonly _host: IFoldingCommandHost) {
		super();
	}

	public foldAll(): IFoldingCommandResult {
		return FoldingCommands.foldAll(this._host);
	}

	public unfoldAll(): IFoldingCommandResult {
		return FoldingCommands.unfoldAll(this._host);
	}

	public foldLevel(level: number): IFoldingCommandResult {
		return FoldingCommands.foldLevel(this._host, level);
	}

	public fold(lineNumber: number): IFoldingCommandResult {
		return FoldingCommands.fold(this._host, lineNumber);
	}

	public unfold(lineNumber: number): IFoldingCommandResult {
		return FoldingCommands.unfold(this._host, lineNumber);
	}

	public toggle(lineNumber: number): IFoldingCommandResult {
		return FoldingCommands.toggleFold(this._host, lineNumber);
	}
}
