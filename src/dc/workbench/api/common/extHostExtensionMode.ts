import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export const ExtensionMode = {
	Production: 1,
	Development: 2,
	Test: 3
};

export type ExtensionModeType = 1 | 2 | 3;
