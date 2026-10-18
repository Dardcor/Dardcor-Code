/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export enum PortAutoForwardAction {
		Notify = 1,
		OpenBrowser = 2,
		OpenPreview = 3,
		Silent = 4,
		Ignore = 5
	}

	export class PortAttributes {
		autoForwardAction: PortAutoForwardAction;

		constructor(autoForwardAction: PortAutoForwardAction);
	}

	export interface PortAttributesProvider {
		providePortAttributes(attributes: { port: number; pid?: number; commandLine?: string }, token: CancellationToken): ProviderResult<PortAttributes>;
	}

	export interface PortAttributesSelector {
		portRange?: [number, number] | number;

		commandPattern?: RegExp;
	}

	export namespace workspace {
		export function registerPortAttributesProvider(portSelector: PortAttributesSelector, provider: PortAttributesProvider): Disposable;
	}
}
