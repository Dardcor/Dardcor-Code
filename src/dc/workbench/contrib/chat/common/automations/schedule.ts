/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAutomationSchedule } from './automation.js';
import { localize } from '../../../../../nls.js';

export const DAYS_OF_WEEK: readonly string[] = [
	localize('automation.day.sun', "Sunday"),
	localize('automation.day.mon', "Monday"),
	localize('automation.day.tue', "Tuesday"),
	localize('automation.day.wed', "Wednesday"),
	localize('automation.day.thu', "Thursday"),
	localize('automation.day.fri', "Friday"),
	localize('automation.day.sat', "Saturday"),
];

export function computeNextRunAt(schedule: IAutomationSchedule, now: Date): Date | undefined {
	const { interval, scheduleHour, scheduleMinute, scheduleDay } = schedule;

	switch (interval) {
		case 'manual':
			return undefined;

		case 'hourly':
			return new Date(now.getTime() + 60 * 60 * 1000);

		case 'daily': {
			if (!isValidHourMinute(scheduleHour, scheduleMinute)) {
				return undefined;
			}
			const today = buildLocalDate(now.getFullYear(), now.getMonth(), now.getDate(), scheduleHour, scheduleMinute);
			if (today.getTime() > now.getTime()) {
				return today;
			}
			return buildLocalDate(now.getFullYear(), now.getMonth(), now.getDate() + 1, scheduleHour, scheduleMinute);
		}

		case 'weekly': {
			if (!isValidHourMinute(scheduleHour, scheduleMinute)) {
				return undefined;
			}
			if (!Number.isInteger(scheduleDay) || scheduleDay < 0 || scheduleDay > 6) {
				return undefined;
			}
			const currentDay = now.getDay();
			let daysAhead = scheduleDay - currentDay;
			const sameDayButPassed = daysAhead === 0 && (now.getHours() > scheduleHour ||
				(now.getHours() === scheduleHour && now.getMinutes() >= scheduleMinute));
			if (daysAhead < 0 || sameDayButPassed) {
				daysAhead += 7;
			}
			return buildLocalDate(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, scheduleHour, scheduleMinute);
		}

		default:
			return undefined;
	}
}

function isValidHourMinute(hour: number, minute: number): boolean {
	return Number.isInteger(hour) && hour >= 0 && hour <= 23
		&& Number.isInteger(minute) && minute >= 0 && minute <= 59;
}

function buildLocalDate(year: number, monthIndex: number, day: number, hour: number, minute: number): Date {
	const candidate = new Date(year, monthIndex, day, hour, minute, 0, 0);
	if (candidate.getHours() === hour && candidate.getMinutes() === minute) {
		return candidate;
	}
	for (let shift = 1; shift <= 3; shift++) {
		const shifted = new Date(year, monthIndex, day, hour + shift, minute, 0, 0);
		if (shifted.getHours() === (hour + shift) % 24 && shifted.getMinutes() === minute) {
			return shifted;
		}
	}
	return candidate;
}
