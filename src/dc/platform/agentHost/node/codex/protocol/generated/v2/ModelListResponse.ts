
import type { Model } from "./Model.js";

export type ModelListResponse = {
	data: Array<Model>,
	nextCursor: string | null,
};
