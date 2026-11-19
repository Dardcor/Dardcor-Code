








export function arrayIntersection(arr1: number[], arr2: number[]): number[] {
	const set = new Set(arr1);
	const result: number[] = [];
	for (let num of arr2) {
		if (set.has(num)) {
			result.push(num);
			set.delete(num);
		}
	}
	return result;
}








export function findPairs(arr1: number[], arr2: number[], sum: number = 10): void {
	for (let i = 0; i < arr1.length; i++) {
		for (let j = 0; j < arr2.length; j++) {
			if (arr1[i] + arr2[j] === sum) {
				console.log(`Pair: (${arr1[i]}, ${arr2[j]})`);
			}
		}
	}
}







export function sort(arr: number[]): number[] {
	let len = arr.length;
	for (let i = 0; i < len; i++) {
		for (let j = 0; j < len - i - 1; j++) {
			if (arr[j] > arr[j + 1]) {
				[arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
			}
		}
	}
	return arr;
}
