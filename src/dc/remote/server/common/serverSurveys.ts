import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerSurvey {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly link: string;
	readonly condition?: (context: any) => boolean;
}

export interface IServerSurveysService {
	readonly onDidShowSurvey: Event<IServerSurvey>;
	registerSurvey(survey: IServerSurvey): IDisposable;
	getSurveys(): IServerSurvey[];
	showSurvey(id: string): void;
	shouldShowSurvey(id: string, context?: any): boolean;
}

export class ServerSurveysCommon implements IServerSurveysService {
	private readonly _surveys = new Map<string, IServerSurvey>();
	private readonly _shownSurveys = new Set<string>();

	private readonly _onDidShowSurvey = new Emitter<IServerSurvey>();
	readonly onDidShowSurvey = this._onDidShowSurvey.event;

	registerSurvey(survey: IServerSurvey): IDisposable {
		this._surveys.set(survey.id, survey);
		return { dispose: () => { this._surveys.delete(survey.id); } };
	}

	getSurveys(): IServerSurvey[] {
		return Array.from(this._surveys.values());
	}

	showSurvey(id: string): void {
		const survey = this._surveys.get(id);
		if (survey && !this._shownSurveys.has(id)) {
			this._shownSurveys.add(id);
			this._onDidShowSurvey.fire(survey);
		}
	}

	shouldShowSurvey(id: string, context?: any): boolean {
		if (this._shownSurveys.has(id)) return false;
		const survey = this._surveys.get(id);
		if (!survey) return false;
		if (survey.condition) {
			return survey.condition(context);
		}
		return true;
	}
}
