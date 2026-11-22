import { append, axisSegmentEntersRect, segmentContact, type IPoint, type IRect } from './geom.js';

export const PITCH = 12_000;
const BEND = 100_000;
const CROSS = 48_000;
const MAX_AVOIDABLE_CROSSINGS = 2;
const CONTACT = 2_000_000;
const HISTORY = 1_000_000;
const SAME_NET_CROSSING = 20 * BEND;
const WINDOW_MARGIN = 8 * PITCH;
export const MAX_ROUTER_STATES = 2_000_000;

export interface RouterObstacle {
	readonly owner: number;
	readonly kind: 'body' | 'node' | 'expanded' | 'label';
	readonly rect: IRect;
}

export interface RouterTerminal {
	readonly owner: number;
	readonly point: IPoint;
	readonly escape: IPoint;
}

export interface RouterWire {
	readonly from: RouterTerminal;
	readonly to: RouterTerminal;
	readonly net: number;
	readonly group: number;
	readonly joinFrom: boolean;
	readonly joinTo: boolean;
	readonly meetFrom?: boolean;
	readonly meetTo?: boolean;
	readonly label?: ((points: readonly IPoint[]) => IRect | undefined) | undefined;
}

export interface RouterFixed {
	readonly net: number;
	readonly a: IPoint;
	readonly b: IPoint;
}

export interface RouterInput {
	readonly bounds?: { readonly width: number; readonly height: number } | undefined;
	readonly obstacles: readonly RouterObstacle[];
	readonly wires: readonly RouterWire[];
	readonly fixed: readonly RouterFixed[];
	readonly attempts: number;
	readonly states?: number;
}

export interface RoutedWire {
	readonly points: readonly IPoint[];
	readonly junction?: IPoint;
}

export interface RouterResult {
	readonly wires: readonly RoutedWire[];
	readonly attempts: number;
	readonly rippedUp: readonly { readonly wire: number; readonly attempt: number }[];
	readonly failed?: number;
	readonly reason?: 'unroutable' | 'contention' | 'complexity';
}

interface Copper {
	readonly a: IPoint;
	readonly b: IPoint;
	readonly net: number;
	readonly unit: number;
	readonly stub: boolean;
	dead?: boolean;
}

const CELL = 256_000;
const CELL_OFFSET = 2 ** 20;

export class Buckets<T> {
	private readonly cells = new Map<number, number[]>();
	readonly items: T[] = [];
	private stamps = new Uint32Array(64);
	private epoch = 0;

	add(item: T, rect: IRect): void {
		const id = this.items.push(item) - 1;
		if (id >= this.stamps.length) {
			const g = new Uint32Array(this.stamps.length * 2);
			g.set(this.stamps);
			this.stamps = g;
		}
		const x1 = Math.floor(rect.maxX / CELL);
		const y0 = Math.floor(rect.minY / CELL);
		const y1 = Math.floor(rect.maxY / CELL);
		for (let x = Math.floor(rect.minX / CELL); x <= x1; x += 1) {
			const base = (x + CELL_OFFSET) * 2 ** 21 + CELL_OFFSET;
			for (let y = y0; y <= y1; y += 1) append(this.cells, base + y, id);
		}
	}

	query(rect: IRect): readonly T[] {
		const len = this.items.length;
		if (len === 0) return this.items;
		const x0 = Math.floor(rect.minX / CELL);
		const x1 = Math.floor(rect.maxX / CELL);
		const y0 = Math.floor(rect.minY / CELL);
		const y1 = Math.floor(rect.maxY / CELL);
		if ((x1 - x0 + 1) * (y1 - y0 + 1) * 2 >= len) return this.items;
		const ep = ++this.epoch;
		const ids: number[] = [];
		const stamps = this.stamps;
		let prev = -1;
		let unsorted = false;
		for (let x = x0; x <= x1; x += 1) {
			const base = (x + CELL_OFFSET) * 2 ** 21 + CELL_OFFSET;
			for (let y = y0; y <= y1; y += 1) {
				const bucket = this.cells.get(base + y);
				if (bucket === undefined) continue;
				for (let i = 0; i < bucket.length; i += 1) {
					const id = bucket[i]!;
					if (stamps[id] === ep) continue;
					stamps[id] = ep;
					if (id < prev) unsorted = true;
					prev = id;
					ids.push(id);
				}
			}
		}
		if (unsorted) ids.sort((a, b) => a - b);
		const out: T[] = new Array(ids.length);
		for (let i = 0; i < ids.length; i += 1) out[i] = this.items[ids[i]!]!;
		return out;
	}
}

type Axes = readonly [number, number, number, number];
interface Unit {
	readonly index: number;
	readonly net: number;
	readonly wires: readonly number[];
	readonly tree: boolean;
}

const axisOf = (t: RouterTerminal): number => (t.point.y !== t.escape.y ? 2 : t.point.x !== t.escape.x ? 1 : 0);
const faceOf = (t: RouterTerminal): number => Math.sign(t.escape.x - t.point.x + t.escape.y - t.point.y);
const axesOf = (from: RouterTerminal | undefined, to: RouterTerminal): Axes => [
	from === undefined ? 0 : axisOf(from),
	axisOf(to),
	faceOf(to),
	from === undefined ? 0 : faceOf(from)
];
const spanOf = (a: IPoint, b: IPoint): IRect => ({
	minX: a.x < b.x ? a.x : b.x,
	minY: a.y < b.y ? a.y : b.y,
	maxX: a.x > b.x ? a.x : b.x,
	maxY: a.y > b.y ? a.y : b.y
});
const pointKey = (p: IPoint): string => `${p.x},${p.y}`;
const sameAs = (a: IPoint, b: IPoint): boolean => a.x === b.x && a.y === b.y;
const cmpPt = (a: IPoint, b: IPoint): number => a.x - b.x || a.y - b.y;

function lowerBound(values: ArrayLike<number>, target: number, low = 0): number {
	let high = values.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (values[mid]! < target) low = mid + 1;
		else high = mid;
	}
	return low;
}

function uniqueSorted(values: number[]): number[] {
	values.sort((a, b) => a - b);
	return [...new Set(values)];
}

function axisCoordinates(specials: readonly number[], low: number, high: number, keepGap: number): number[] {
	const half = PITCH / 2;
	const sLen = specials.length;
	const out: number[] = [];
	let sp = lowerBound(specials, low);
	let near = sp;
	while (near > 0 && specials[near - 1]! > low - half) near -= 1;
	let prevSp = sp > 0 ? specials[sp - 1]! : low;
	for (let val = Math.ceil(low / PITCH) * PITCH; ; val += PITCH) {
		const mult = val <= high;
		while (sp < sLen && specials[sp]! <= high && (!mult || specials[sp]! < val)) {
			prevSp = specials[sp]!;
			out.push(specials[sp++]!);
		}
		if (!mult) return out;
		if (keepGap > 0 && val > prevSp + keepGap) {
			const nextSp = sp < sLen && specials[sp]! < high ? specials[sp]! : high;
			const target = Math.floor((nextSp - keepGap) / PITCH) * PITCH;
			if (target > val) val = target;
		}
		while (near < sLen && specials[near]! <= val - half) near += 1;
		if (near < sLen && specials[near]! < val + half) continue;
		out.push(val);
	}
}

const OTHER_H = 1;
const OTHER_V = 2;
const OTHER_END = 4;
const OWN = 8;
const SAME = 16;
const AVOID = 32;
const OTHER_ANY = OTHER_H | OTHER_V | OTHER_END;

let sNode = new Uint8Array(0);
let sBlockH = new Uint8Array(0);
let sBlockV = new Uint8Array(0);
let sOccH = new Uint8Array(0);
let sOccV = new Uint8Array(0);
let sHistory = new Float64Array(0);
let sG = new Float64Array(0);
let sCross = new Int32Array(0);
let sPrev = new Int32Array(0);
let sStamp = new Int32Array(0);
let sPaid = new Uint8Array(0);
let sEpoch = 0;
let hState = new Int32Array(64);
let hF = new Float64Array(64);
let hG = new Float64Array(64);
let hSize = 0;

function beginScratch(cells: number, hasHistory: boolean): void {
	if (cells > sNode.length) {
		sNode = new Uint8Array(cells);
		sBlockH = new Uint8Array(cells);
		sBlockV = new Uint8Array(cells);
		sOccH = new Uint8Array(cells);
		sOccV = new Uint8Array(cells);
		sHistory = new Float64Array(cells);
		sG = new Float64Array(cells * 4);
		sCross = new Int32Array(cells * 4);
		sPrev = new Int32Array(cells * 4);
		sStamp = new Int32Array(cells * 4);
		sPaid = new Uint8Array(cells * 4);
		sEpoch = 0;
	} else {
		sNode.fill(0, 0, cells);
		sBlockH.fill(0, 0, cells);
		sBlockV.fill(0, 0, cells);
		sOccH.fill(0, 0, cells);
		sOccV.fill(0, 0, cells);
		if (hasHistory) sHistory.fill(0, 0, cells);
	}
}

const heapLt = (f1: number, g1: number, s1: number, f2: number, g2: number, s2: number): boolean =>
	f1 < f2 || (f1 === f2 && (g1 > g2 || (g1 === g2 && s1 < s2)));

function heapPush(st: number, g: number, f: number): void {
	let hs = hState;
	let hf = hF;
	let hg = hG;
	if (hSize === hs.length) {
		const cap = hSize * 2;
		const ns = new Int32Array(cap);
		const nf = new Float64Array(cap);
		const ng = new Float64Array(cap);
		ns.set(hs);
		nf.set(hf);
		ng.set(hg);
		hs = hState = ns;
		hf = hF = nf;
		hg = hG = ng;
	}
	let i = hSize++;
	while (i > 0) {
		const p = (i - 1) >> 1;
		if (!heapLt(f, g, st, hf[p]!, hg[p]!, hs[p]!)) break;
		hs[i] = hs[p]!;
		hf[i] = hf[p]!;
		hg[i] = hg[p]!;
		i = p;
	}
	hs[i] = st;
	hf[i] = f;
	hg[i] = g;
}

function heapPop(): number {
	const hs = hState;
	const hf = hF;
	const hg = hG;
	const top = hs[0]!;
	const sz = --hSize;
	if (sz > 0) {
		const ls = hs[sz]!;
		const lf = hf[sz]!;
		const lg = hg[sz]!;
		let i = 0;
		for (;;) {
			const l = i * 2 + 1;
			if (l >= sz) break;
			const r = l + 1;
			const c = r < sz && heapLt(hf[r]!, hg[r]!, hs[r]!, hf[l]!, hg[l]!, hs[l]!) ? r : l;
			if (!heapLt(hf[c]!, hg[c]!, hs[c]!, lf, lg, ls)) break;
			hs[i] = hs[c]!;
			hf[i] = hf[c]!;
			hg[i] = hg[c]!;
			i = c;
		}
		hs[i] = ls;
		hf[i] = lf;
		hg[i] = lg;
	}
	return top;
}

export class RouterComplexityError extends Error {
	constructor(readonly wire: number) {
		super('router state budget exhausted');
	}
}

export function compact(points: readonly IPoint[]): IPoint[] {
	const out: IPoint[] = [];
	for (const p of points) {
		const last = out[out.length - 1];
		if (last !== undefined && last.x === p.x && last.y === p.y) continue;
		if (out.length >= 2) {
			const prev = out[out.length - 2]!;
			if ((prev.x === last!.x && last!.x === p.x) || (prev.y === last!.y && last!.y === p.y)) {
				out[out.length - 1] = p;
				continue;
			}
		}
		out.push(p);
	}
	return out;
}

export function routeWires(input: RouterInput): RouterResult {
	const wires = input.wires;
	const xsRaw: number[] = [];
	const ysRaw: number[] = [];
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const note = (x: number, y: number): void => {
		xsRaw.push(x);
		ysRaw.push(y);
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	};
	let maxLabel = 0;
	const obstacles = new Buckets<RouterObstacle>();
	for (const ob of input.obstacles) {
		obstacles.add(ob, ob.rect);
		if (ob.kind === 'label') {
			const d = Math.max(ob.rect.maxX - ob.rect.minX, ob.rect.maxY - ob.rect.minY);
			if (d > maxLabel) maxLabel = d;
		} else {
			note(ob.rect.minX, ob.rect.minY);
			note(ob.rect.maxX, ob.rect.maxY);
		}
	}
	const gapKeep = Math.max((wires.length + 4) * PITCH, maxLabel + 2 * PITCH);
	for (const w of wires) {
		note(w.from.point.x, w.from.point.y);
		note(w.from.escape.x, w.from.escape.y);
		note(w.to.point.x, w.to.point.y);
		note(w.to.escape.x, w.to.escape.y);
	}
	const canvas: IRect =
		input.bounds !== undefined
			? (note(0, 0), note(input.bounds.width, input.bounds.height), { minX: 0, minY: 0, maxX: input.bounds.width, maxY: input.bounds.height })
			: { minX: minX - 4 * WINDOW_MARGIN, minY: minY - 4 * WINDOW_MARGIN, maxX: maxX + 4 * WINDOW_MARGIN, maxY: maxY + 4 * WINDOW_MARGIN };
	const specialsX = uniqueSorted(xsRaw);
	const specialsY = uniqueSorted(ysRaw);
	const routes: (RoutedWire | undefined)[] = new Array(wires.length);
	const labels: (RouterObstacle | undefined)[] = new Array(wires.length);
	const unitOf = new Int32Array(wires.length);
	const copper = new Buckets<Copper>();
	const unitCopper: Copper[][] = [];
	const fixed = new Buckets<RouterFixed>();
	const labelIndex = new Buckets<RouterObstacle>();
	const history = new Map<string, number>();
	const contested = new Set<string>();
	let contact = Infinity;

	for (const f of input.fixed) fixed.add(f, spanOf(f.a, f.b));

	const groups = new Map<number, number[]>();
	const drafts: { net: number; wires: number[]; tree: boolean; key: [number, number, number, number]; sig: string }[] = [];
	const makeDraft = (members: number[], tree: boolean): void => {
		let best: IPoint | undefined;
		let second: IPoint | undefined;
		const sigs: string[] = [];
		for (const i of members) {
			const w = wires[i]!;
			sigs.push(`${w.from.point.x},${w.from.point.y},${w.to.point.x},${w.to.point.y}`);
			const swap = cmpPt(w.from.escape, w.to.escape) > 0;
			const low = swap ? w.to.escape : w.from.escape;
			const high = swap ? w.from.escape : w.to.escape;
			if (best === undefined || cmpPt(low, best) < 0 || (cmpPt(low, best) === 0 && cmpPt(high, second!) < 0)) {
				best = low;
				second = high;
			}
		}
		sigs.sort();
		drafts.push({ net: wires[members[0]!]!.net, wires: members, tree, key: [best!.x, best!.y, second!.x, second!.y], sig: sigs.join(';') });
	};
	for (let i = 0; i < wires.length; i += 1) {
		const g = wires[i]!.group;
		if (g < 0) makeDraft([i], false);
		else append(groups, g, i);
	}
	for (const members of groups.values()) makeDraft(members, true);
	drafts.sort(
		(a, b) =>
			a.key[0] - b.key[0] ||
			a.key[1] - b.key[1] ||
			a.key[2] - b.key[2] ||
			a.key[3] - b.key[3] ||
			(a.sig > b.sig ? 1 : a.sig < b.sig ? -1 : 0) ||
			a.wires[0]! - b.wires[0]!
	);
	const units: Unit[] = drafts.map((d, index) => {
		unitCopper.push([]);
		for (const w of d.wires) unitOf[w] = index;
		return { index, net: d.net, wires: d.wires, tree: d.tree };
	});

	const lay = (piece: Copper): void => {
		copper.add(piece, spanOf(piece.a, piece.b));
		unitCopper[piece.unit]!.push(piece);
	};

	const ripUp = (unit: Unit): void => {
		const kept: Copper[] = [];
		for (const p of unitCopper[unit.index]!) {
			if (p.stub) kept.push(p);
			else p.dead = true;
		}
		unitCopper[unit.index] = kept;
		for (const i of unit.wires) {
			routes[i] = undefined;
			labels[i] = undefined;
		}
	};

	const facing = (unit: Unit, wire: RouterWire): IPoint[] | undefined => {
		const a = wire.from.point;
		const b = wire.to.point;
		if ((a.x !== b.x && a.y !== b.y) || sameAs(a, b) || history.size > 0) return undefined;
		const toward = (t: RouterTerminal, at: IPoint) =>
			Math.sign(t.escape.x - t.point.x) === Math.sign(at.x - t.point.x) && Math.sign(t.escape.y - t.point.y) === Math.sign(at.y - t.point.y);
		if (!toward(wire.from, b) || !toward(wire.to, a)) return undefined;
		const span = spanOf(a, b);
		for (const ob of obstacles.query(span)) {
			if ((ob.kind === 'body' || (ob.owner !== wire.from.owner && ob.owner !== wire.to.owner)) && axisSegmentEntersRect(a, b, ob.rect)) return undefined;
		}
		for (const lb of labelIndex.query(span)) {
			if (labels[-1 - lb.owner] === lb && axisSegmentEntersRect(a, b, lb.rect)) return undefined;
		}
		let crosses = 0;
		for (const p of copper.query(span)) {
			/* v8 ignore next -- facing only runs when history is empty, where dead copper only exists after a soft pass-1 retry. */
			if (p.dead) continue;
			if (p.net === unit.net) {
				if (p.unit !== unit.index && segmentContact(a, b, p.a, p.b) !== undefined) return undefined;
				continue;
			}
			const c = segmentContact(a, b, p.a, p.b);
			if (c === undefined) continue;
			if (p.stub || c === 'touch') return undefined;
			crosses += 1;
		}
		if (crosses > 0 && crosses <= MAX_AVOIDABLE_CROSSINGS) return undefined;
		for (const f of fixed.query(span)) {
			if (f.net !== unit.net && segmentContact(a, b, f.a, f.b) !== undefined) return undefined;
		}
		return [a, b];
	};

	const searchWindow = (
		unit: Unit,
		win: IRect,
		sources: readonly IPoint[],
		target: IPoint,
		avoid: readonly Copper[],
		wireIndex: number,
		mode: 'tree' | 'point',
		connected: ReadonlySet<string>,
		cap: number,
		axes: Axes,
		tryAvoidCross: boolean
	): { path: IPoint[]; crossings: number; expanded: number; cost: number; priced: boolean } | undefined => {
		const hasHistory = history.size > 0;
		const kg = !hasHistory && labelIndex.items.length === 0 && fixed.items.length === 0 ? gapKeep : 0;
		const xs = axisCoordinates(specialsX, win.minX, win.maxX, kg);
		const ys = axisCoordinates(specialsY, win.minY, win.maxY, kg);
		const width = xs.length;
		const height = ys.length;
		const cells = width * height;
		beginScratch(cells, hasHistory);
		const idxOf = (arr: readonly number[], v: number): number => {
			const i = lowerBound(arr, v);
			return i < arr.length && arr[i] === v ? i : -1;
		};
		const col = (x: number): number => idxOf(xs, x);
		const row = (y: number): number => idxOf(ys, y);

		const relaxed = new Set<number>();
		const own = new Set<number>();
		const escapes: IPoint[] = [];
		for (const wi of unit.wires) {
			const w = wires[wi]!;
			own.add(w.from.owner);
			own.add(w.to.owner);
			escapes.push(w.from.escape, w.to.escape);
		}
		const block = (r: IRect, val = 1): void => {
			if (r.maxX <= win.minX || r.minX >= win.maxX || r.maxY <= win.minY || r.minY >= win.maxY) return;
			const x0 = lowerBound(xs, r.minX + 1);
			const x1 = lowerBound(xs, r.maxX, x0);
			const y0 = lowerBound(ys, r.minY + 1);
			const y1 = lowerBound(ys, r.maxY, y0);
			const v1 = Math.min(height - 2, y1 - 1);
			for (let sp = y0 > 0 ? y0 - 1 : 0; sp <= v1; sp += 1) {
				const base = sp * width;
				for (let l = x0; l < x1; l += 1) if (val === 1 || sBlockV[base + l] === 0) sBlockV[base + l] = val;
			}
			const h1 = Math.min(width - 2, x1 - 1);
			for (let l = y0; l < y1; l += 1) {
				const base = l * width;
				for (let sp = x0 > 0 ? x0 - 1 : 0; sp <= h1; sp += 1) if (val === 1 || sBlockH[base + sp] === 0) sBlockH[base + sp] = val;
			}
		};
		const holdsEscape = (r: IRect): boolean => escapes.some((at) => at.x > r.minX && at.x < r.maxX && at.y > r.minY && at.y < r.maxY);
		const obs = obstacles.query(win);
		for (const ob of obs) if (ob.kind === 'expanded' && holdsEscape(ob.rect)) relaxed.add(ob.owner);
		for (const ob of obs) {
			if (ob.kind === 'body') {
				if (relaxed.has(ob.owner) || own.has(ob.owner)) block(ob.rect);
			} else if (ob.kind === 'node') {
				if (!own.has(ob.owner)) block(ob.rect);
			} else if (ob.kind === 'label') {
				if (!holdsEscape(ob.rect)) block(ob.rect);
			} else if (!relaxed.has(ob.owner)) block(ob.rect, own.has(ob.owner) ? 2 : 1);
		}
		for (const lb of labelIndex.query(win)) {
			if (labels[-1 - lb.owner] === lb && !holdsEscape(lb.rect)) block(lb.rect);
		}

		const mark = (piece: Copper, role: number): void => {
			const horiz = piece.a.y === piece.b.y;
			const along = horiz ? xs : ys;
			const line = horiz ? row(piece.a.y) : col(piece.a.x);
			if (line < 0) return;
			const p0 = horiz ? piece.a.x : piece.a.y;
			const p1 = horiz ? piece.b.x : piece.b.y;
			const low = p0 < p1 ? p0 : p1;
			const high = p0 > p1 ? p0 : p1;
			const flag = horiz ? OTHER_H : OTHER_V;
			const occ = horiz ? sOccH : sOccV;
			for (let idx = lowerBound(along, low); idx < along.length && along[idx]! <= high; idx += 1) {
				const cell = horiz ? line * width + idx : idx * width + line;
				const at = along[idx]!;
				if (role === 3) sNode[cell] = sNode[cell]! | AVOID;
				else if (role === 1 && !piece.stub) sNode[cell] = sNode[cell]! | OWN;
				else if (role !== 0) sNode[cell] = sNode[cell]! | SAME;
				else sNode[cell] = sNode[cell]! | (piece.stub || at === low || at === high ? OTHER_END : flag);
				if (at < high && idx + 1 < along.length) occ[cell] = role === 0 ? 1 : 2;
			}
		};
		for (const p of copper.query(win)) {
			if (p.dead || (p.a.x < win.minX && p.b.x < win.minX) || (p.a.x > win.maxX && p.b.x > win.maxX) || (p.a.y < win.minY && p.b.y < win.minY) || (p.a.y > win.maxY && p.b.y > win.maxY)) continue;
			if (p.net !== unit.net) mark(p, 0);
			else if (mode === 'tree' && p.unit === unit.index && (!p.stub || connected.has(pointKey(p.a)))) mark(p, 1);
			else mark(p, 2);
		}
		for (const p of avoid) mark(p, 3);
		for (const p of unitCopper[unit.index]!) {
			if (!p.stub) continue;
			const isEnd = sameAs(p.b, target) || (mode === 'point' && sameAs(p.b, sources[0]!));
			if (mode !== 'tree' && !isEnd) continue;
			const vert = p.a.x === p.b.x;
			const along = vert ? ys : xs;
			const line = vert ? col(p.a.x) : row(p.a.y);
			if (line < 0) continue;
			const from = vert ? p.a.y : p.a.x;
			const to = vert ? p.b.y : p.b.x;
			const lo = from < to ? from : to;
			const hi = from > to ? from : to;
			for (let idx = lowerBound(along, lo); idx < along.length && along[idx]! <= hi; idx += 1) {
				const cell = vert ? idx * width + line : line * width + idx;
				if (mode === 'tree') sNode[cell] = (sNode[cell]! & ~OWN) | SAME;
				if (isEnd && along[idx] !== to) sNode[cell] = sNode[cell]! | AVOID;
			}
		}
		for (const f of fixed.query(win)) {
			if (f.net === unit.net) continue;
			const sp = spanOf(f.a, f.b);
			if (sp.maxX < win.minX || sp.minX > win.maxX || sp.maxY < win.minY || sp.minY > win.maxY) continue;
			const c0 = Math.max(0, lowerBound(xs, sp.minX) - 1);
			const c1 = Math.min(width - 1, lowerBound(xs, sp.maxX + 1));
			const r0 = Math.max(0, lowerBound(ys, sp.minY) - 1);
			const r1 = Math.min(height - 1, lowerBound(ys, sp.maxY + 1));
			for (let r = r0; r <= r1; r += 1) {
				for (let c = c0; c <= c1; c += 1) {
					const here = { x: xs[c]!, y: ys[r]! };
					if (c + 1 < width && segmentContact(here, { x: xs[c + 1]!, y: ys[r]! }, f.a, f.b) !== undefined) sOccH[r * width + c] = 1;
					if (r + 1 < height && segmentContact(here, { x: xs[c]!, y: ys[r + 1]! }, f.a, f.b) !== undefined) sOccV[r * width + c] = 1;
				}
			}
		}
		if (hasHistory) {
			for (const [key, val] of history) {
				const comma = key.indexOf(',');
				const c = col(Number(key.slice(0, comma)));
				const r = row(Number(key.slice(comma + 1)));
				if (c >= 0 && r >= 0) sHistory[r * width + c] = val;
			}
		}

		const targetCol = col(target.x);
		const targetRow = row(target.y);
		/* v8 ignore next */
		if (targetCol < 0 || targetRow < 0) return undefined;
		const targetCell = targetRow * width + targetCol;
		const targetX = target.x;
		const targetY = target.y;
		const startCells: number[] = [];
		if (mode === 'point') {
			for (const src of sources) startCells.push(row(src.y) * width + col(src.x));
		} else {
			const pins: IPoint[] = [];
			for (const wi of unit.wires) {
				const w = wires[wi]!;
				pins.push(w.from.point, w.to.point);
			}
			for (let cell = 0; cell < cells; cell += 1) {
				if ((sNode[cell]! & OWN) === 0) continue;
				const c = cell % width;
				const r = (cell - c) / width;
				let deg = 0;
				if (c > 0 && sOccH[cell - 1] === 2) deg += 1;
				if (c + 1 < width && sOccH[cell] === 2) deg += 1;
				if (r > 0 && sOccV[cell - width] === 2) deg += 1;
				if (r + 1 < height && sOccV[cell] === 2) deg += 1;
				if (deg >= 3) continue;
				const x = xs[c]!;
				const y = ys[r]!;
				let crowded = false;
				for (let i = 0; i < pins.length; i += 1) {
					const pin = pins[i]!;
					if (Math.abs(pin.x - x) + Math.abs(pin.y - y) < 2 * PITCH) {
						crowded = true;
						break;
					}
				}
				if (!crowded) startCells.push(cell);
			}
		}

		const end = axes[1];
		const face = axes[2];
		const heuristic = (c: number, r: number, dir: number): number => {
			const dx = xs[c]! - targetX;
			const dy = ys[r]! - targetY;
			if (dx === 0 && dy === 0) return 0;
			let bends: number;
			if (end === 0) {
				bends = dir === 0 ? (dx !== 0 && dy !== 0 ? 1 : 0) : dir === 1 ? (dy !== 0 ? 1 : 0) : dx !== 0 ? 1 : 0;
			} else {
				const ahead = (end === 1 ? dx : dy) * face;
				const aside = end === 1 ? dy : dx;
				const along = dir === end;
				const across = dir !== 0 && !along;
				if (aside === 0) bends = ahead > 0 ? (across ? 1 : 0) : along ? 4 : 3;
				else if (ahead >= 0) bends = along ? 2 : 1;
				else bends = across ? 3 : 2;
			}
			return Math.abs(dx) + Math.abs(dy) + bends * BEND;
		};

		const heading = mode === 'point' ? axes[0] : 0;
		const node = sNode;
		const blockH = sBlockH;
		const blockV = sBlockV;
		const occH = sOccH;
		const occV = sOccV;
		const histArr = sHistory;
		const gArr = sG;
		const crossArr = sCross;
		const prevArr = sPrev;
		const stampArr = sStamp;
		const paidArr = sPaid;
		const run = (crossCost: number, limit: number, maxF = Infinity) => {
			const ep = ++sEpoch;
			hSize = 0;
			for (let i = 0; i < startCells.length; i += 1) {
				const cell = startCells[i]!;
				const st = (cell << 2) | heading;
				const c = cell % width;
				gArr[st] = 0;
				crossArr[st] = 0;
				prevArr[st] = -1;
				stampArr[st] = ep;
				paidArr[st] = 0;
				heapPush(st, 0, heuristic(c, (cell - c) / width, heading));
			}
			let expanded = 0;
			let found = -1;
			let hotSt = -1;
			let hotG = 0;
			let hotF = 0;
			while (hotSt >= 0 || hSize > 0) {
				let st: number;
				let g: number;
				let f: number;
				if (hotSt >= 0) {
					st = hotSt;
					g = hotG;
					f = hotF;
					hotSt = -1;
				} else {
					g = hG[0]!;
					f = hF[0]!;
					st = heapPop();
				}
				if (gArr[st] !== g) continue;
				const cell = st >>> 2;
				if (cell === targetCell) {
					found = st;
					break;
				}
				if (++expanded > limit) {
					if (crossCost > 0) return undefined;
					throw new RouterComplexityError(wireIndex);
				}
				const dir = st & 3;
				const c = cell % width;
				const r = (cell - c) / width;
				const flags = node[cell]!;
				const prevSt = prevArr[st]!;
				const prevCell = prevSt < 0 ? -1 : prevSt >>> 2;

				for (let step = 0; step < 4; step += 1) {
					const horiz = step < 2;
					const neg = (step & 1) === 0;
					if (horiz ? (neg ? c === 0 : c + 1 === width) : neg ? r === 0 : r + 1 === height) continue;
					const next = horiz ? (neg ? cell - 1 : cell + 1) : neg ? cell - width : cell + width;
					if (next === prevCell) continue;
					const ndir = horiz ? 1 : 2;
					const edge = neg ? next : cell;
					const soft = horiz ? blockH[edge]! : blockV[edge]!;
					const occ = horiz ? occH[edge]! : occV[edge]!;
					if (soft === 1 || occ === 2) continue;
					const nf = node[next]!;
					if ((nf & AVOID) !== 0) continue;
					const nc = horiz ? (neg ? c - 1 : c + 1) : c;
					const nr = horiz ? r : neg ? r - 1 : r + 1;
					const len = horiz ? (neg ? xs[c]! - xs[nc]! : xs[nc]! - xs[c]!) : neg ? ys[r]! - ys[nr]! : ys[nr]! - ys[r]!;
					const hist = hasHistory ? histArr[next]! : 0;
					let cost = g + len * (soft === 2 ? 2 : 1) + hist;
					let crossed = crossArr[st]!;
					let pen = occ === 1 ? contact : 0;
					if (dir !== 0 && dir !== ndir) {
						cost += BEND;
						if ((flags & OTHER_ANY) !== 0) pen += contact;
					} else if (dir === ndir) {
						if ((flags & OTHER_END) !== 0) pen += contact;
						else if ((flags & (horiz ? OTHER_V : OTHER_H)) !== 0) {
							crossed += 1;
							cost += crossCost;
						}
					} else if ((flags & OTHER_ANY) !== 0) {
						pen += contact;
					}
					if ((nf & (OWN | SAME)) !== 0 && next !== targetCell) cost += SAME_NET_CROSSING;
					if (next === targetCell) {
						if ((nf & OTHER_ANY) !== 0) pen += contact;
						if (end !== 0 && ndir !== end) cost += BEND;
					}
					if (pen > 0) {
						if (pen === Infinity) continue;
						cost += pen;
					}
					const nst = (next << 2) | ndir;
					if (stampArr[nst] === ep) {
						const known = gArr[nst]!;
						if (cost > known || (cost === known && crossed >= crossArr[nst]!)) continue;
					}
					const fNext = cost + heuristic(nc, nr, ndir);
					if (fNext > maxF) continue;
					gArr[nst] = cost;
					crossArr[nst] = crossed;
					prevArr[nst] = st;
					stampArr[nst] = ep;
					paidArr[nst] = pen > 0 || hist > 0 ? 1 : paidArr[st]!;
					if ((fNext < f || (fNext === f && cost > g)) && (hotSt < 0 || heapLt(fNext, cost, nst, hotF, hotG, hotSt))) {
						if (hotSt >= 0) heapPush(hotSt, hotG, hotF);
						hotSt = nst;
						hotG = cost;
						hotF = fNext;
					} else {
						heapPush(nst, cost, fNext);
					}
				}
			}
			if (found < 0) return undefined;
			const rev: IPoint[] = [];
			for (let st = found; st !== -1; st = prevArr[st]!) {
				const cell = st >>> 2;
				const c = cell % width;
				rev.push({ x: xs[c]!, y: ys[(cell - c) / width]! });
			}
			return { path: compact(rev.reverse()), crossings: crossArr[found]!, expanded, cost: gArr[found]!, priced: paidArr[found] === 1 };
		};
		const first = run(0, cap);
		if (first === undefined) return undefined;
		if (tryAvoidCross && !first.priced && first.crossings > 0 && first.crossings <= MAX_AVOIDABLE_CROSSINGS) {
			const better = run(CROSS, 1_000 + first.expanded, first.cost + first.crossings * CROSS);
			if (better !== undefined && better.crossings < first.crossings) return better;
		}
		return first;
	};

	const search = (
		unit: Unit,
		sources: readonly IPoint[],
		target: IPoint,
		avoid: readonly Copper[],
		wireIndex: number,
		mode: 'tree' | 'point',
		connected: ReadonlySet<string> = new Set(),
		axes: Axes = [0, 0, 0, 0]
	): IPoint[] | undefined => {
		let flip = false;
		if (mode === 'point' && history.size === 0 && axes[1] !== 0) {
			const src = sources[0]!;
			const aside = axes[1] === 1 ? src.y - target.y : src.x - target.x;
			const toAhead = (axes[1] === 1 ? src.x - target.x : src.y - target.y) * axes[2];
			const fromAhead = axes[0] === 0 ? 1 : (axes[0] === 1 ? target.x - src.x : target.y - src.y) * axes[3];
			if (aside === 0 && toAhead < 0 && fromAhead > 0) {
				flip = true;
				sources = [target];
				target = src;
				axes = [axes[1], axes[0], axes[3], axes[2]];
			}
		}
		let bMinX = target.x;
		let bMinY = target.y;
		let bMaxX = target.x;
		let bMaxY = target.y;
		for (const s of sources) {
			if (s.x < bMinX) bMinX = s.x;
			if (s.y < bMinY) bMinY = s.y;
			if (s.x > bMaxX) bMaxX = s.x;
			if (s.y > bMaxY) bMaxY = s.y;
		}
		const win: IRect = {
			minX: Math.min(bMinX, Math.max(canvas.minX, bMinX - WINDOW_MARGIN)),
			minY: Math.min(bMinY, Math.max(canvas.minY, bMinY - WINDOW_MARGIN)),
			maxX: Math.max(bMaxX, Math.min(canvas.maxX, bMaxX + WINDOW_MARGIN)),
			maxY: Math.max(bMaxY, Math.min(canvas.maxY, bMaxY + WINDOW_MARGIN))
		};
		const whole: IRect = {
			minX: Math.min(bMinX, canvas.minX),
			minY: Math.min(bMinY, canvas.minY),
			maxX: Math.max(bMaxX, canvas.maxX),
			maxY: Math.max(bMaxY, canvas.maxY)
		};
		const cap = input.states ?? MAX_ROUTER_STATES;
		let found = searchWindow(unit, win, sources, target, avoid, wireIndex, mode, connected, cap, axes, true);
		if (found === undefined) found = searchWindow(unit, whole, sources, target, avoid, wireIndex, mode, connected, cap, axes, true);
		if (found === undefined) return undefined;
		if (found.priced) {
			const wide = searchWindow(unit, whole, sources, target, avoid, wireIndex, mode, connected, cap, axes, true)!;
			if (wide.cost < found.cost) found = wide;
			else if (found.crossings > 0 && found.crossings <= MAX_AVOIDABLE_CROSSINGS) {
				const better = searchWindow(unit, win, sources, target, avoid, wireIndex, mode, connected, cap, axes, true);
				/* v8 ignore next */
				if (better !== undefined && better.crossings < found.crossings) found = better;
			}
		}
		return flip ? found.path.reverse() : found.path;
	};

	const commit = (index: number, path: readonly IPoint[], jStart: boolean, jEnd: boolean): void => {
		const unit = units[unitOf[index]!]!;
		for (let i = 1; i < path.length; i += 1) lay({ a: path[i - 1]!, b: path[i]!, net: unit.net, unit: unit.index, stub: false });
		const w = wires[index]!;
		let points: IPoint[];
		if (jStart) points = compact([...path, w.to.point]);
		else if (jEnd) points = compact([w.from.point, ...[...path].reverse()]);
		else {
			const start = path[0]!;
			const oriented = sameAs(start, w.from.escape) || sameAs(start, w.from.point) ? path : [...path].reverse();
			points = compact([w.from.point, ...oriented, w.to.point]);
		}
		routes[index] = jStart ? { points, junction: points[0]! } : { points };
		const rect = w.label?.(points);
		if (rect === undefined) labels[index] = undefined;
		else {
			const lb: RouterObstacle = { owner: -1 - index, kind: 'label', rect };
			labels[index] = lb;
			labelIndex.add(lb, rect);
		}
	};

	const copperPaths = (unit: Unit, ends: readonly IPoint[]) => {
		const pieces = unitCopper[unit.index]!;
		const pts = new Map<string, IPoint>();
		for (const p of pieces) {
			pts.set(pointKey(p.a), p.a);
			pts.set(pointKey(p.b), p.b);
		}
		for (const p of ends) pts.set(pointKey(p), p);
		const edges = new Map<string, { to: string; length: number }[]>();
		const allPts = [...pts.values()];
		for (const p of pieces) {
			const on = allPts.filter((pt) => segmentContact(p.a, p.b, pt, pt) !== undefined);
			on.sort((a, b) => Math.abs(a.x - p.a.x) + Math.abs(a.y - p.a.y) - (Math.abs(b.x - p.a.x) + Math.abs(b.y - p.a.y)));
			for (let i = 1; i < on.length; i += 1) {
				const a = on[i - 1]!;
				const b = on[i]!;
				const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
				const ka = pointKey(a);
				const kb = pointKey(b);
				append(edges, ka, { to: kb, length });
				append(edges, kb, { to: ka, length });
			}
		}
		return (from: IPoint, to: IPoint): IPoint[] | undefined => {
			const start = pointKey(from);
			const goal = pointKey(to);
			const dist = new Map<string, number>([[start, 0]]);
			const prev = new Map<string, string>();
			const open = new Set([start]);
			while (open.size > 0) {
				let cur = '';
				let curD = Infinity;
				for (const k of open) {
					const d = dist.get(k)!;
					if (cur === '' || d < curD || (d === curD && k < cur)) {
						cur = k;
						curD = d;
					}
				}
				open.delete(cur);
				if (cur === goal) {
					const path: IPoint[] = [];
					for (let k: string | undefined = cur; k !== undefined; k = prev.get(k)) path.push(pts.get(k)!);
					return compact(path.reverse());
				}
				for (const e of edges.get(cur)!) {
					const nd = curD + e.length;
					if (nd < (dist.get(e.to) ?? Infinity)) {
						dist.set(e.to, nd);
						prev.set(e.to, cur);
						open.add(e.to);
					}
				}
			}
			/* v8 ignore next */
			return undefined;
		};
	};

	const routeUnit = (unit: Unit): number => {
		if (!unit.tree) {
			const idx = unit.wires[0]!;
			const w = wires[idx]!;
			const path = facing(unit, w) ?? search(unit, [w.from.escape], w.to.escape, [], idx, 'point', undefined, axesOf(w.from, w.to));
			if (path === undefined) return idx;
			commit(idx, path, false, false);
			return -1;
		}
		let root: RouterTerminal | undefined;
		for (const i of unit.wires) {
			const w = wires[i]!;
			if (root === undefined || cmpPt(w.from.escape, root.escape) < 0) root = w.from;
			if (cmpPt(w.to.escape, root.escape) < 0) root = w.to;
		}
		const connected = new Set<string>([pointKey(root!.point)]);
		const pending = new Set(unit.wires);
		const loops: number[] = [];
		while (pending.size > 0) {
			let chosen = -1;
			let anchor: RouterTerminal | undefined;
			let free: RouterTerminal | undefined;
			let forward = false;
			for (const i of pending) {
				const w = wires[i]!;
				const fromIn = connected.has(pointKey(w.from.point));
				const toIn = connected.has(pointKey(w.to.point));
				if (fromIn && toIn) {
					loops.push(i);
					pending.delete(i);
					continue;
				}
				if (fromIn === toIn) continue;
				const cFree = fromIn ? w.to : w.from;
				const cAnc = fromIn ? w.from : w.to;
				const cw = chosen >= 0 ? wires[chosen]! : undefined;
				const ord =
					free === undefined
						? -1
						: cmpPt(cFree.escape, free.escape) ||
							cmpPt(cAnc.escape, anchor!.escape) ||
							cmpPt(cFree.point, free.point) ||
							cmpPt(cAnc.point, anchor!.point) ||
							(fromIn ? 0 : 1) - (forward ? 0 : 1) ||
							((fromIn ? w.joinFrom : w.joinTo) ? 0 : 1) - ((forward ? cw!.joinFrom : cw!.joinTo) ? 0 : 1) ||
							(w.label === undefined ? 0 : 1) - (cw!.label === undefined ? 0 : 1) ||
							i - chosen;
				if (ord < 0) {
					chosen = i;
					free = cFree;
					anchor = cAnc;
					forward = fromIn;
				}
			}
			if (chosen < 0) break;
			pending.delete(chosen);
			const w = wires[chosen]!;
			const freeIsTo = free === w.to;
			const mayJoin = freeIsTo ? w.joinFrom : w.joinTo;
			const first = connected.size === 1;
			const meet = (freeIsTo ? w.meetFrom : w.meetTo) === true;
			let branch = mayJoin && !first && !meet;
			const avoid = unitCopper[unit.index]!.filter((p) => p.stub && !connected.has(pointKey(p.a)) && !sameAs(p.a, free!.point));
			const grow = () => {
				const srcs: IPoint[] = [];
				for (const p of unitCopper[unit.index]!) if (!p.stub || connected.has(pointKey(p.a))) srcs.push(p.a, p.b);
				return search(unit, srcs, free!.escape, avoid, chosen, 'tree', connected, axesOf(undefined, free!));
			};
			let path = branch ? grow() : (facing(unit, w) ?? search(unit, [anchor!.escape], free!.escape, avoid, chosen, 'point', undefined, axesOf(anchor!, free!)));
			if (path === undefined && meet && mayJoin && !first) {
				branch = true;
				path = grow();
			}
			if (path === undefined) return chosen;
			commit(chosen, path, branch && freeIsTo, branch && !freeIsTo);
			connected.add(pointKey(free!.point));
			for (const i of pending) {
				const ow = wires[i]!;
				for (const [end, meets] of [
					[ow.from, ow.meetFrom],
					[ow.to, ow.meetTo]
				] as const) {
					if (meets === true && path.some((pt, at) => at > 0 && segmentContact(path[at - 1]!, pt, end.point, end.point) !== undefined)) {
						connected.add(pointKey(end.point));
					}
				}
			}
		}
		if (loops.length > 0) {
			const along = copperPaths(
				unit,
				loops.flatMap((i) => [wires[i]!.from.point, wires[i]!.to.point])
			);
			for (const i of loops) {
				const w = wires[i]!;
				const path = along(w.from.point, w.to.point);
				/* v8 ignore next */
				if (path === undefined) return i;
				routes[i] = { points: path };
			}
		}
		return -1;
	};

	const contacts = (): Set<number> => {
		const involved = new Set<number>();
		const maps: [Map<number, Copper[]>, Map<number, Copper[]>] = [new Map(), new Map()];
		const live = copper.items.filter((p) => !p.dead);
		for (const p of live) {
			const h = p.a.y === p.b.y;
			append(maps[h ? 0 : 1], h ? p.a.y : p.a.x, p);
		}
		const flag = (l: Copper, r: Copper, at: IPoint): void => {
			involved.add(l.unit);
			involved.add(r.unit);
			contested.add(pointKey(at));
		};
		const lo = (p: Copper, h: boolean) => (h ? Math.min(p.a.x, p.b.x) : Math.min(p.a.y, p.b.y));
		const hi = (p: Copper, h: boolean) => (h ? Math.max(p.a.x, p.b.x) : Math.max(p.a.y, p.b.y));
		for (let m = 0; m < 2; m += 1) {
			const h = m === 0;
			for (const [line, list] of maps[m]!) {
				list.sort((a, b) => lo(a, h) - lo(b, h));
				for (let i = 0; i < list.length; i += 1) {
					const hiI = hi(list[i]!, h);
					for (let j = i + 1; j < list.length; j += 1) {
						const lj = lo(list[j]!, h);
						if (lj > hiI) break;
						if (list[i]!.net === list[j]!.net) continue;
						flag(list[i]!, list[j]!, h ? { x: lj, y: line } : { x: line, y: lj });
					}
				}
			}
		}
		for (const p of live) {
			const h = p.a.y === p.b.y;
			const perp = maps[h ? 1 : 0];
			for (const end of [p.a, p.b]) {
				const others = perp.get(h ? end.x : end.y);
				if (others === undefined) continue;
				const along = h ? end.y : end.x;
				for (const o of others) {
					if (o.net !== p.net && along >= lo(o, !h) && along <= hi(o, !h)) flag(p, o, end);
				}
			}
		}
		for (const f of input.fixed) {
			for (const p of copper.query(spanOf(f.a, f.b))) {
				if (!p.dead && p.net !== f.net && segmentContact(p.a, p.b, f.a, f.b) !== undefined) {
					involved.add(p.unit);
					contested.add(pointKey(p.a));
				}
			}
		}
		return involved;
	};

	const seen = new Set<string>();
	for (const u of units) {
		for (const i of u.wires) {
			const w = wires[i]!;
			for (const t of [w.from, w.to]) {
				const k = `${u.index}|${pointKey(t.point)}`;
				if (seen.has(k) || sameAs(t.point, t.escape)) continue;
				seen.add(k);
				lay({ a: t.point, b: t.escape, net: u.net, unit: u.index, stub: true });
			}
		}
	}

	const rippedUp: { wire: number; attempt: number }[] = [];
	const fail = (wire: number, reason: NonNullable<RouterResult['reason']>, attempts: number): RouterResult => ({
		wires: [],
		attempts,
		rippedUp,
		failed: wire,
		reason
	});

	for (let i = 0; i < wires.length; i += 1) {
		const w = wires[i]!;
		for (const t of [w.from, w.to]) {
			for (const ob of obstacles.query(spanOf(t.point, t.escape))) {
				if (ob.kind === 'body' && ob.owner !== w.from.owner && ob.owner !== w.to.owner && axisSegmentEntersRect(t.point, t.escape, ob.rect)) {
					return fail(i, 'unroutable', 0);
				}
			}
		}
	}

	try {
		const soft: Unit[] = [];
		for (const u of units) {
			contact = Infinity;
			const failed = routeUnit(u);
			if (failed < 0) continue;
			ripUp(u);
			if (input.attempts <= 1) return fail(failed, 'contention', 0);
			contact = CONTACT;
			const retry = routeUnit(u);
			if (retry >= 0) return fail(retry, 'unroutable', 0);
			soft.push(u);
		}
		let involved = soft.length > 0 || input.fixed.length > 0 ? contacts() : new Set<number>();
		let attempt = 1;
		while (involved.size > 0) {
			if (attempt >= input.attempts) {
				const ws = [...involved].flatMap((u) => units[u]!.wires);
				return fail(Math.min(...ws), 'contention', attempt);
			}
			for (const k of contested) history.set(k, (history.get(k) ?? 0) + HISTORY * attempt);
			contested.clear();
			const redo = [...involved].sort((a, b) => a - b).map((i) => units[i]!);
			for (const u of redo) {
				ripUp(u);
				for (const w of u.wires) rippedUp.push({ wire: w, attempt });
			}
			contact = CONTACT * 2 ** attempt;
			for (const u of redo) {
				const failed = routeUnit(u);
				/* v8 ignore next */
				if (failed >= 0) return fail(failed, 'unroutable', attempt);
			}
			attempt += 1;
			involved = contacts();
		}
		return { wires: routes as RoutedWire[], attempts: attempt - 1, rippedUp };
	} catch (error) {
		/* v8 ignore else */
		if (error instanceof RouterComplexityError) return fail(error.wire, 'complexity', 0);
		/* v8 ignore next */
		throw error;
	}
}
