/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {



	export interface AuthenticationChallenge {
		readonly scheme: string;

		readonly params: Record<string, string>;
	}

	export interface AuthenticationConstraint {
		readonly challenges: readonly AuthenticationChallenge[];

		readonly fallbackScopes?: readonly string[];
	}

	export interface AuthenticationProvider {
		getSessionsFromChallenges?(constraint: AuthenticationConstraint, options: AuthenticationProviderSessionOptions): Thenable<readonly AuthenticationSession[]>;

		createSessionFromChallenges?(constraint: AuthenticationConstraint, options: AuthenticationProviderSessionOptions): Thenable<AuthenticationSession>;
	}

	export interface AuthenticationProviderOptions {
		supportsChallenges?: boolean;
	}
}
