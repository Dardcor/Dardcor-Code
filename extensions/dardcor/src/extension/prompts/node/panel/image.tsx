/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { Image as BaseImage, BasePromptElementProps, ChatResponseReferencePartStatusKind, PromptElement, PromptReference, PromptSizing, UserMessage } from '@vscode/prompt-tsx';
import { Uri } from '../../../../dardcorTypes';
import { IPromptEndpoint } from '../base/promptRenderer';

export interface ImageProps extends BasePromptElementProps {
	variableName: string;
	variableValue: Uint8Array | Promise<Uint8Array>;
	omitReferences?: boolean;
	reference?: Uri;
}

export interface HistoricalImageProps extends BasePromptElementProps {
	src: string;
	detail?: 'auto' | 'low' | 'high';
	mimeType?: string;
}

export class HistoricalImage extends PromptElement<HistoricalImageProps, unknown> {
	constructor(
		props: HistoricalImageProps,
		@IPromptEndpoint private readonly promptEndpoint: IPromptEndpoint,
	) {
		super(props);
	}

	override async render(_state: unknown, sizing: PromptSizing) {
		if (!this.promptEndpoint.supportsVision) {
			return undefined;
		}

		return <BaseImage src={this.props.src} detail={this.props.detail} mimeType={this.props.mimeType} />;
	}
}

export class Image extends PromptElement<ImageProps, unknown> {
	constructor(
		props: ImageProps,
		@IPromptEndpoint private readonly promptEndpoint: IPromptEndpoint,
	) {
		super(props);
	}

	override async render(_state: unknown, sizing: PromptSizing) {
		const noVisionDescription = l10n.t("{0} does not support images.", this.promptEndpoint.model);
		const omittedOptions = { status: { description: noVisionDescription, kind: ChatResponseReferencePartStatusKind.Omitted } };
		const errorOptions = { status: { description: noVisionDescription, kind: ChatResponseReferencePartStatusKind.Omitted } };

		const fillerUri: Uri = this.props.reference ?? Uri.parse('Attached Image');

		try {
			if (!this.promptEndpoint.supportsVision) {
				if (this.props.omitReferences) {
					return;
				}

				return (
					<>
						<references value={[new PromptReference(this.props.variableName ? { variableName: this.props.variableName, value: fillerUri } : fillerUri, undefined, omittedOptions)]} />
					</>
				);
			}
			const variable = await this.props.variableValue;
			const imageSource = Buffer.from(variable).toString('base64');

			return (
				<UserMessage priority={0}>
					<BaseImage src={imageSource} detail='high' />
					{this.props.reference && (
						<references value={[new PromptReference(this.props.variableName ? { variableName: this.props.variableName, value: fillerUri } : fillerUri, undefined)]} />
					)}
				</UserMessage>
			);
		} catch (err) {
			if (this.props.omitReferences) {
				return;
			}

			return (
				<>
					<references value={[new PromptReference(this.props.variableName ? { variableName: this.props.variableName, value: fillerUri } : fillerUri, undefined, errorOptions)]} />
				</>);
		}
	}
}
