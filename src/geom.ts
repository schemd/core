export const UNIT = 1000;

export interface IPoint {
	readonly x: number;
	readonly y: number;
}

export interface IRect {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

export type Turn = 0 | 1 | 2 | 3;

export function roundDiv(numerator: number, denominator: number): number {
	const rounded = Math.floor(Math.abs(numerator) / denominator + 0.5);
	return numerator < 0 ? -rounded : rounded;
}

export function toMilli(value: number): number {
	return roundDiv(value * UNIT, 1);
}

export function fromMilli(value: number): number {
	return value / UNIT;
}

export function fmt(value: number): string {
	if (value % UNIT === 0) return value === 0 ? '0' : String(value / UNIT);
	const neg = value < 0;
	const mag = neg ? -value : value;
	const whole = (mag / UNIT) | 0;
	let frac = mag - whole * UNIT;
	let d = String(frac).padStart(3, '0');
	while (d.endsWith('0')) d = d.slice(0, -1);
	return `${neg ? '-' : ''}${whole}.${d}`;
}

export function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key);
	if (list === undefined) map.set(key, [value]);
	else list.push(value);
}

export function unions(count: number): { find(index: number): number; join(left: number, right: number): void } {
	const parent = new Int32Array(count);
	for (let i = 0; i < count; i += 1) parent[i] = i;
	const find = (i: number): number => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]!]!;
			i = parent[i]!;
		}
		return i;
	};
	return {
		find,
		join(l, r) {
			const a = find(l);
			const b = find(r);
			if (a !== b) parent[a > b ? a : b] = a < b ? a : b;
		}
	};
}

export function rotate(point: IPoint, turn: Turn): IPoint {
	const x = point.x + 0;
	const y = point.y + 0;
	return turn === 0 ? { x, y } : turn === 1 ? { x: 0 - y, y: x } : turn === 2 ? { x: 0 - x, y: 0 - y } : { x: y, y: 0 - x };
}

export function overlaps(l: IRect, r: IRect): boolean {
	return l.minX < r.maxX && l.maxX > r.minX && l.minY < r.maxY && l.maxY > r.minY;
}

export function contains(outer: IRect, inner: IRect): boolean {
	return outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
}

export function inflate(rect: IRect, margin: number): IRect {
	return { minX: rect.minX - margin, minY: rect.minY - margin, maxX: rect.maxX + margin, maxY: rect.maxY + margin };
}

export function axisSegmentEntersRect(a: IPoint, b: IPoint, rect: IRect): boolean {
	return a.y === b.y
		? a.y > rect.minY && a.y < rect.maxY && Math.max(a.x, b.x) > rect.minX && Math.min(a.x, b.x) < rect.maxX
		: a.x > rect.minX && a.x < rect.maxX && Math.max(a.y, b.y) > rect.minY && Math.min(a.y, b.y) < rect.maxY;
}

export function segmentEntersRect(a: IPoint, b: IPoint, rect: IRect): boolean {
	if (a.y === b.y || a.x === b.x) return axisSegmentEntersRect(a, b, rect);
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const x1 = (rect.minX - a.x) / dx;
	const x2 = (rect.maxX - a.x) / dx;
	const y1 = (rect.minY - a.y) / dy;
	const y2 = (rect.maxY - a.y) / dy;
	const low = Math.max(0, Math.min(x1, x2), Math.min(y1, y2));
	const high = Math.min(1, Math.max(x1, x2), Math.max(y1, y2));
	return low < high && high > 0 && low < 1;
}

export function orientation(a: IPoint, b: IPoint, c: IPoint): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const acx = c.x - a.x;
	const acy = c.y - a.y;
	const limit = 67_108_864;
	if (Math.abs(abx) < limit && Math.abs(aby) < limit && Math.abs(acx) < limit && Math.abs(acy) < limit) {
		const v = abx * acy - aby * acx;
		return v > 0 ? 1 : v < 0 ? -1 : 0;
	}
	const v = BigInt(abx) * BigInt(acy) - BigInt(aby) * BigInt(acx);
	return v > 0n ? 1 : v < 0n ? -1 : 0;
}

function onSegment(a: IPoint, b: IPoint, p: IPoint): boolean {
	return Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
}

export function segmentContact(a: IPoint, b: IPoint, c: IPoint, d: IPoint): 'cross' | 'touch' | undefined {
	const o1 = orientation(a, b, c);
	const o2 = orientation(a, b, d);
	const o3 = orientation(c, d, a);
	const o4 = orientation(c, d, b);
	if (o1 !== o2 && o3 !== o4) return o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0 ? 'touch' : 'cross';
	if ((o1 === 0 && onSegment(a, b, c)) || (o2 === 0 && onSegment(a, b, d)) || (o3 === 0 && onSegment(c, d, a)) || (o4 === 0 && onSegment(c, d, b))) {
		return 'touch';
	}
	return undefined;
}

export function parseMilli(text: string): number {
	const point = text.indexOf('.');
	if (point < 0) {
		const v = Number(text) * UNIT;
		return v === 0 ? 0 : v;
	}
	const neg = text.charCodeAt(0) === 45;
	const start = neg || text.charCodeAt(0) === 43 ? 1 : 0;
	const whole = start === point ? 0 : Number(text.slice(start, point));
	const frac = text.slice(point + 1);
	let val = whole * UNIT + Number((frac + '000').slice(0, 3));
	if (frac.length > 3 && frac.charCodeAt(3) >= 53) val += 1;
	return neg && val !== 0 ? -val : val;
}
