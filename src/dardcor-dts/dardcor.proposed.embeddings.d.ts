/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface Embedding {
		readonly values: number[];
	}

	export namespace lm {

		export const embeddingModels: string[];

		export const onDidChangeEmbeddingModels: Event<void>;

		export function computeEmbeddings(embeddingsModel: string, input: string, token?: CancellationToken): Thenable<Embedding>;

		export function computeEmbeddings(embeddingsModel: string, input: string[], token?: CancellationToken): Thenable<Embedding[]>;
	}

	export interface EmbeddingsProvider {
		provideEmbeddings(input: string[], token: CancellationToken): ProviderResult<Embedding[]>;
	}

	export namespace lm {
		export function registerEmbeddingsProvider(embeddingsModel: string, provider: EmbeddingsProvider): Disposable;
	}
}
