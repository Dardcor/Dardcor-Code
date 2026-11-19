/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, Raw } from '@vscode/prompt-tsx';
import { CustomDataPartMimeTypes } from './endpointTypes';

interface IStatefulMarkerContainer {
	type: typeof CustomDataPartMimeTypes.StatefulMarker;
	value: StatefulMarkerWithModel;
}

export type StatefulMarkerWithModel = {
	modelId: string;
	marker: string;
	summarizedAtRoundId?: string;
};

export interface IStatefulMarkerContainerProps extends BasePromptElementProps {
	statefulMarker: StatefulMarkerWithModel;
}

export class StatefulMarkerContainer extends PromptElement<IStatefulMarkerContainerProps> {
	render() {
		const { statefulMarker } = this.props;
		const container = { type: CustomDataPartMimeTypes.StatefulMarker, value: statefulMarker };
		return <opaque value={container} />;
	}
}

export function rawPartAsStatefulMarker(part: Raw.ChatCompletionContentPartOpaque): StatefulMarkerWithModel | undefined {
	const value = part.value;
	if (!value || typeof value !== 'object') {
		return;
	}

	const data = value as IStatefulMarkerContainer;
	if (data.type === CustomDataPartMimeTypes.StatefulMarker && typeof data.value === 'object') {
		return data.value;
	}
	return;
}

export function encodeStatefulMarker(modelId: string, marker: string): Uint8Array {
	return new TextEncoder().encode(modelId + '\\' + marker);
}

export function decodeStatefulMarker(data: Uint8Array): StatefulMarkerWithModel {
	const decoded = new TextDecoder().decode(data);
	const [modelId, marker] = decoded.split('\\');
	return { modelId, marker };
}

export function* getAllStatefulMarkersAndIndicies(messages: readonly Raw.ChatMessage[]) {
	for (let idx = messages.length - 1; idx >= 0; idx--) {
		const message = messages[idx];
		if (message.role === Raw.ChatRole.Assistant) {
			for (const part of message.content) {
				if (part.type === Raw.ChatCompletionContentPartKind.Opaque) {
					const statefulMarker = rawPartAsStatefulMarker(part);
					if (statefulMarker) {
						yield { statefulMarker: statefulMarker, index: idx };
					}
				}
			}
		}
	}
	return undefined;
}

export function getStatefulMarkerAndIndex(modelId: string, messages: readonly Raw.ChatMessage[]): { statefulMarker: string; index: number } | undefined {
	for (const marker of getAllStatefulMarkersAndIndicies(messages)) {
		if (marker.statefulMarker.modelId === modelId) {
			return { statefulMarker: marker.statefulMarker.marker, index: marker.index };
		}
	}
	return undefined;
}

export function getIndexOfStatefulMarker(markerValue: string, messages: readonly Raw.ChatMessage[]): number | undefined {
	for (const entry of getAllStatefulMarkersAndIndicies(messages)) {
		if (entry.statefulMarker.marker === markerValue) {
			return entry.index;
		}
	}
	return undefined;
}
