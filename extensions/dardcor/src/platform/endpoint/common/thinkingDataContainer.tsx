/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { BasePromptElementProps, PromptElement, Raw } from '@vscode/prompt-tsx';
import { ThinkingData } from '../../thinking/common/thinking';
import { CustomDataPartMimeTypes } from './endpointTypes';

interface IThinkingDataOpaque {
	type: typeof CustomDataPartMimeTypes.ThinkingData;
	thinking: ThinkingData;
}

export interface IThinkingDataContainerProps extends BasePromptElementProps {
	thinking: ThinkingData;
}

export class ThinkingDataContainer extends PromptElement<IThinkingDataContainerProps> {
	render() {
		const { thinking } = this.props;
		const container: IThinkingDataOpaque = { type: CustomDataPartMimeTypes.ThinkingData, thinking };
		return <opaque value={container} tokenUsage={thinking.tokens} />;
	}
}

export function rawPartAsThinkingData(part: Raw.ChatCompletionContentPartOpaque): ThinkingData | undefined {
	const value = part.value as unknown;
	if (!value || typeof value !== 'object') {
		return;
	}

	const data = value as IThinkingDataOpaque;
	if (data.type === CustomDataPartMimeTypes.ThinkingData && data.thinking && typeof data.thinking === 'object') {
		return data.thinking;
	}
	return;
}
