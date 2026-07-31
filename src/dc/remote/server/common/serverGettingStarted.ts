import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerGettingStartedCategory {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly icon?: string;
	readonly order: number;
}

export interface IServerGettingStartedStep {
	readonly id: string;
	readonly categoryId: string;
	readonly title: string;
	readonly description: string;
	readonly action?: { label: string; command: string };
	readonly media?: { type: 'image' | 'video'; path: string };
	readonly order: number;
}

export interface IServerGettingStartedService {
	readonly onDidChangeCategory: Event<IServerGettingStartedCategory>;
	readonly onDidChangeStep: Event<IServerGettingStartedStep>;
	readonly onDidChangeStepProgress: Event<{ id: string; done: boolean }>;
	getCategories(): IServerGettingStartedCategory[];
	getSteps(categoryId: string): IServerGettingStartedStep[];
	registerCategory(category: IServerGettingStartedCategory): IDisposable;
	registerStep(step: IServerGettingStartedStep): IDisposable;
	markStepComplete(id: string): void;
	markStepIncomplete(id: string): void;
	isStepComplete(id: string): boolean;
	getProgress(categoryId: string): { completed: number; total: number };
}

export class ServerGettingStartedCommon implements IServerGettingStartedService {
	private readonly _categories = new Map<string, IServerGettingStartedCategory>();
	private readonly _steps = new Map<string, IServerGettingStartedStep>();
	private readonly _completedSteps = new Set<string>();

	private readonly _onDidChangeCategory = new Emitter<IServerGettingStartedCategory>();
	readonly onDidChangeCategory = this._onDidChangeCategory.event;

	private readonly _onDidChangeStep = new Emitter<IServerGettingStartedStep>();
	readonly onDidChangeStep = this._onDidChangeStep.event;

	private readonly _onDidChangeStepProgress = new Emitter<{ id: string; done: boolean }>();
	readonly onDidChangeStepProgress = this._onDidChangeStepProgress.event;

	getCategories(): IServerGettingStartedCategory[] {
		return Array.from(this._categories.values()).sort((a, b) => a.order - b.order);
	}

	getSteps(categoryId: string): IServerGettingStartedStep[] {
		return Array.from(this._steps.values())
			.filter(s => s.categoryId === categoryId)
			.sort((a, b) => a.order - b.order);
	}

	registerCategory(category: IServerGettingStartedCategory): IDisposable {
		this._categories.set(category.id, category);
		this._onDidChangeCategory.fire(category);
		return { dispose: () => { this._categories.delete(category.id); } };
	}

	registerStep(step: IServerGettingStartedStep): IDisposable {
		this._steps.set(step.id, step);
		this._onDidChangeStep.fire(step);
		return { dispose: () => { this._steps.delete(step.id); } };
	}

	markStepComplete(id: string): void {
		if (this._steps.has(id) && !this._completedSteps.has(id)) {
			this._completedSteps.add(id);
			this._onDidChangeStepProgress.fire({ id, done: true });
		}
	}

	markStepIncomplete(id: string): void {
		if (this._steps.has(id) && this._completedSteps.has(id)) {
			this._completedSteps.delete(id);
			this._onDidChangeStepProgress.fire({ id, done: false });
		}
	}

	isStepComplete(id: string): boolean {
		return this._completedSteps.has(id);
	}

	getProgress(categoryId: string): { completed: number; total: number } {
		const steps = this.getSteps(categoryId);
		const completed = steps.filter(s => this._completedSteps.has(s.id)).length;
		return { completed, total: steps.length };
	}
}
