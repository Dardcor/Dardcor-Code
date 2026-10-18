/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface DardcorAnnotation {
	id: number;
	start_offset: number;
	stop_offset: number;
	details: { [key: string]: unknown };
	citations?: { [key: string]: string };
}

export type DardcorNamedAnnotationList = { [key: string]: DardcorAnnotation[] };

export interface DardcorAnnotations {
	current: DardcorNamedAnnotationList;
	update: (annotations: DardcorNamedAnnotationList) => void;
	update_namespace: (namespace: string, annotation: DardcorAnnotation) => void;
	for: (namespace: string) => DardcorAnnotation[];
}

export class StreamDardcorAnnotations implements DardcorAnnotations {
	current: DardcorNamedAnnotationList = {};

	update(annotations: DardcorNamedAnnotationList) {
		Object.entries(annotations).forEach(([namespace, annotations]) => {
			annotations.forEach(a => this.update_namespace(namespace, a));
		});
	}

	update_namespace(namespace: string, annotation: DardcorAnnotation) {
		if (!this.current[namespace]) {
			this.current[namespace] = [];
		}
		const annotationToUpdate = this.current[namespace];
		const index = annotationToUpdate.findIndex(a => a.id === annotation.id);
		if (index >= 0) {
			annotationToUpdate[index] = annotation;
		} else {
			annotationToUpdate.push(annotation);
		}
	}

	for(namespace: string) {
		return this.current[namespace] ?? [];
	}
}

