/**
 * Dardcor Code - 2D Coordinate & Bounding Box Math
 */

export interface IPosition2D {
	x: number;
	y: number;
}

export interface IBoundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export namespace Position2D {
	export function contains(box: IBoundingBox, pos: IPosition2D): boolean {
		return pos.x >= box.x && pos.x <= box.x + box.width && pos.y >= box.y && pos.y <= box.y + box.height;
	}

	export function intersects(a: IBoundingBox, b: IBoundingBox): boolean {
		return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
	}
}
