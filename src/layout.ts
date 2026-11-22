import {
	append,
	contains,
	fmt,
	fromMilli,
	inflate,
	overlaps,
	rotate,
	roundDiv,
	segmentContact,
	segmentEntersRect,
	toMilli,
	unions,
	type IPoint,
	type IRect
} from './geom.js';
import { mathLabelTextWidthAt } from './math-label.js';
import { MAX_SCHEMATIC_BOUND, MIN_SCHEMATIC_BOUND, resolveSchematicLimits, SCHEMATIC_LIMITS } from './limits.js';
import { Buckets, compact, MAX_ROUTER_STATES, routeWires, type RouterFixed, type RouterObstacle, type RouterTerminal, type RouterWire } from './route.js';
import { canonicalName, halfExtents, placedPorts, resolvePlaced, turnOf, type PlacedPort } from './symbols/index.js';
import { gateHeight } from './symbols/logic.js';
import { gateDimensions } from './symbols/quantum.js';
import { distributed } from './symbols/common.js';
import { icPin } from './symbols/electrical.js';
import {
	DIGITAL_COMPONENT_KINDS,
	QUANTUM_SPECIAL_KINDS,
	UML_COMPONENT_KINDS,
	SchematicSyntaxError,
	type DigitalComponent,
	type IntegratedCircuitComponent,
	type QuantumSpecialComponent,
	type SchematicBounds,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicFence,
	type SchematicOrientation,
	type SchematicPoint,
	type SchematicQuarterTurn,
	type SchematicSheet,
	type UmlComponent
} from './types.js';

export interface SchematicRectangle {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface SchematicHalfExtents {
	halfWidth: number;
	halfHeight: number;
}

export interface RoutedConnection {
	readonly curve: SchematicConnection['curve'];
	d: string;
	points: readonly [SchematicPoint, SchematicPoint, ...SchematicPoint[]];
	readonly junction?: SchematicPoint;
	readonly joins?: readonly SchematicPoint[];
}

export interface ComponentTextAnchors {
	designatorY: number;
	labelY: number;
	designatorWidth: number;
	labelWidth: number;
	textX?: number;
}

export interface ComponentPort {
	readonly id: string;
	readonly point: SchematicPoint;
	readonly normal: SchematicPoint;
}

export type IcPinSide = 'left' | 'right' | 'top' | 'bottom';

export interface SchematicCongestionCell {
	readonly x: number;
	readonly y: number;
	readonly load: number;
}

export interface SchematicRoutingReport {
	readonly attempts: number;
	readonly rippedUp: readonly { readonly connectionIndex: number; readonly attempt: number }[];
	readonly congestion: readonly SchematicCongestionCell[];
	readonly nudged: boolean;
}

export const PORT_HOTSPOT_RADIUS = 4;
export const SCHEMATIC_OBSTACLE_CLEARANCE = 12;
export const SCHEMATIC_BRIDGE_RADIUS = 5;
export const SCHEMATIC_CONGESTION_CELL_SIZE = 64;

const TEXT_ASCENT_GUTTER = 12;
const TEXT_DESCENT_GUTTER = 5;
const TEXT_SIZE = 12;
const TEXT_HORIZONTAL_GUTTER = 4;
const TEXT_WIRE_CLEARANCE = 4_000;

const TURNS: Readonly<Record<SchematicOrientation, SchematicQuarterTurn>> = { right: 0, down: 1, left: 2, up: 3 };
export const orientationQuarterTurn = (orientation: SchematicOrientation): SchematicQuarterTurn => TURNS[orientation];
export const composeQuarterTurns = (a: SchematicQuarterTurn, b: SchematicQuarterTurn): SchematicQuarterTurn => ((a + b) & 3) as SchematicQuarterTurn;
export const inverseQuarterTurn = (t: SchematicQuarterTurn): SchematicQuarterTurn => ((4 - t) & 3) as SchematicQuarterTurn;
export const rotateQuarterPoint = (p: SchematicPoint, t: SchematicQuarterTurn): SchematicPoint => rotate(p, t);
export const rotateQuarterExtents = (e: SchematicHalfExtents, t: SchematicQuarterTurn): SchematicHalfExtents =>
	t % 2 === 0 ? { halfWidth: e.halfWidth + 0, halfHeight: e.halfHeight + 0 } : { halfWidth: e.halfHeight + 0, halfHeight: e.halfWidth + 0 };

export const formatNumber = (value: number): string => fmt(toMilli(value));
export const distributedCoordinate = (index: number, count: number, span: number): number => fromMilli(distributed(index, count, toMilli(span)));
export const classicalGateHeight = gateHeight;
export const quantumGateDimensions = gateDimensions;

const DIGITAL = new Set<string>(DIGITAL_COMPONENT_KINDS);
const QUANTUM_SPECIAL = new Set<string>(QUANTUM_SPECIAL_KINDS);
const UML = new Set<string>(UML_COMPONENT_KINDS);

export const isDigitalComponent = (c: SchematicComponent): c is DigitalComponent => DIGITAL.has(c.kind);
export const isQuantumSpecial = (c: SchematicComponent): c is QuantumSpecialComponent => QUANTUM_SPECIAL.has(c.kind);
export const isUmlComponent = (c: SchematicComponent): c is UmlComponent => UML.has(c.kind);

const unitPoint = (p: IPoint): SchematicPoint => ({ x: fromMilli(p.x), y: fromMilli(p.y) });
const rectUnits = (r: IRect): SchematicRectangle => ({ minX: fromMilli(r.minX), minY: fromMilli(r.minY), maxX: fromMilli(r.maxX), maxY: fromMilli(r.maxY) });

export function positionIcPin(component: IntegratedCircuitComponent, side: IcPinSide, index: number): SchematicPoint {
	if (!Number.isInteger(index) || index < 0 || index >= component.pins[side].length) {
		throw new RangeError(`IC pin index ${index} is outside ${component.id}.${side}.`);
	}
	const local = icPin(component, side, index);
	const r = rotate({ x: local.x, y: local.y }, turnOf(component));
	return { x: fromMilli(toMilli(component.x) + r.x), y: fromMilli(toMilli(component.y) + r.y) };
}

function requirePort(component: SchematicComponent, port: string): PlacedPort {
	const placed = resolvePlaced(component, port);
	if (placed === undefined) throw new Error(`Validated port ${component.id}.${port} is missing.`);
	return placed;
}

export const resolvePortPoint = (c: SchematicComponent, port: string): SchematicPoint => unitPoint(requirePort(c, port).point);
export const resolvePortGeometry = (c: SchematicComponent, port: string): { readonly point: SchematicPoint; readonly normal: SchematicPoint } => {
	const p = requirePort(c, port);
	return { point: unitPoint(p.point), normal: { x: p.normal.x, y: p.normal.y } };
};
export const enumerateComponentPorts = (c: SchematicComponent): readonly ComponentPort[] =>
	placedPorts(c).map((p) => ({ id: p.id, point: unitPoint(p.point), normal: { x: p.normal.x, y: p.normal.y } }));
export function canonicalPortName(component: SchematicComponent, port: string): string {
	const name = canonicalName(component, port);
	if (name === undefined) throw new Error(`Validated port ${component.id}.${port} is missing.`);
	return name;
}

export function bodyRect(component: SchematicComponent, clearance: number): IRect {
	const [w, h] = halfExtents(component);
	const x = toMilli(component.x);
	const y = toMilli(component.y);
	return { minX: x - w - clearance, minY: y - h - clearance, maxX: x + w + clearance, maxY: y + h + clearance };
}

export function componentObstacleRectangle(component: SchematicComponent, clearance = SCHEMATIC_OBSTACLE_CLEARANCE): SchematicRectangle {
	if (!Number.isFinite(clearance) || clearance < 0) throw new RangeError('Component obstacle clearance must be a finite non-negative number.');
	return rectUnits(bodyRect(component, toMilli(clearance)));
}

function centredTextAnchors(component: SchematicComponent): ComponentTextAnchors {
	const hh = fromMilli(halfExtents(component)[1]);
	return {
		designatorY: -hh - 10,
		labelY: hh + 19,
		designatorWidth: mathLabelTextWidthAt(component.id, TEXT_SIZE),
		labelWidth: mathLabelTextWidthAt(component.label, TEXT_SIZE)
	};
}

export function componentTextAnchors(component: SchematicComponent): ComponentTextAnchors {
	if (component.kind === 'junction') {
		return {
			designatorY: -27,
			labelY: -10,
			designatorWidth: mathLabelTextWidthAt(component.id, TEXT_SIZE),
			labelWidth: mathLabelTextWidthAt(component.label, TEXT_SIZE),
			textX: 10
		};
	}
	return centredTextAnchors(component);
}

export function labelRects(component: SchematicComponent): readonly IRect[] {
	if (UML.has(component.kind)) return [];
	const a = componentTextAnchors(component);
	const x = component.x;
	const y = component.y;
	const start = a.textX;
	const row = (w: number, base: number): IRect => ({
		minX: toMilli((start === undefined ? x - w / 2 : x + start) - TEXT_HORIZONTAL_GUTTER),
		minY: toMilli(y + base - TEXT_ASCENT_GUTTER),
		maxX: toMilli((start === undefined ? x + w / 2 : x + start + w) + TEXT_HORIZONTAL_GUTTER),
		maxY: toMilli(y + base + TEXT_DESCENT_GUTTER)
	});
	const d = row(a.designatorWidth, a.designatorY);
	return component.label === '' ? [d] : [d, row(a.labelWidth, a.labelY)];
}

export function componentExtent(component: SchematicComponent, centred = false): IRect {
	const [w, h] = halfExtents(component);
	const x = toMilli(component.x);
	const y = toMilli(component.y);
	let minX = x - w;
	let minY = y - h;
	let maxX = x + w;
	let maxY = y + h;
	if (!UML.has(component.kind)) {
		const a = centred ? centredTextAnchors(component) : componentTextAnchors(component);
		const half = Math.max(w, toMilli(Math.max(a.designatorWidth, a.labelWidth) / 2 + TEXT_HORIZONTAL_GUTTER));
		minX = x - half;
		maxX = x + half;
		minY = Math.min(minY, y + toMilli(a.designatorY - TEXT_ASCENT_GUTTER));
		maxY = Math.max(maxY, y + toMilli(a.labelY + TEXT_DESCENT_GUTTER));
		if (a.textX !== undefined) {
			for (const t of labelRects(component)) {
				minX = Math.min(minX, t.minX);
				maxX = Math.max(maxX, t.maxX);
			}
		}
	}
	const r = PORT_HOTSPOT_RADIUS * 1000;
	for (const p of placedPorts(component)) {
		if (p.point.x - r < minX) minX = p.point.x - r;
		if (p.point.y - r < minY) minY = p.point.y - r;
		if (p.point.x + r > maxX) maxX = p.point.x + r;
		if (p.point.y + r > maxY) maxY = p.point.y + r;
	}
	return { minX, minY, maxX, maxY };
}

export const componentRectangle = (c: SchematicComponent): SchematicRectangle => rectUnits(componentExtent(c));

function midpoint(points: readonly IPoint[]): IPoint {
	let total = 0;
	for (let i = 1; i < points.length; i += 1) {
		total += Math.abs(points[i]!.x - points[i - 1]!.x) + Math.abs(points[i]!.y - points[i - 1]!.y);
	}
	let rem = total / 2;
	for (let i = 1; i < points.length; i += 1) {
		const a = points[i - 1]!;
		const b = points[i]!;
		const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
		if (rem <= len) {
			return { x: a.x + roundDiv((b.x - a.x) * rem, len || 1), y: a.y + roundDiv((b.y - a.y) * rem, len || 1) };
		}
		rem -= len;
	}
	/* v8 ignore next -- a route always contains its own half-length point. */
	return points[points.length - 1]!;
}

export function connectionLabelPoint(route: RoutedConnection): SchematicPoint {
	if (route.curve === 'bezier' && route.points.length >= 4) {
		const [a, b, c, d] = route.points as unknown as [SchematicPoint, SchematicPoint, SchematicPoint, SchematicPoint];
		return { x: (a.x + 3 * b.x + 3 * c.x + d.x) / 8, y: (a.y + 3 * b.y + 3 * c.y + d.y) / 8 };
	}
	return unitPoint(midpoint(route.points.map((p) => ({ x: toMilli(p.x), y: toMilli(p.y) }))));
}

function labelRectAt(connection: SchematicConnection, pt: IPoint): IRect | undefined {
	if (connection.label === undefined) return undefined;
	const half = toMilli(mathLabelTextWidthAt(connection.label, 11) / 2 + 3);
	return { minX: pt.x - half, minY: pt.y - 20_000, maxX: pt.x + half, maxY: pt.y };
}

export function connectionLabelRectangle(connection: SchematicConnection, route: RoutedConnection): SchematicRectangle | undefined {
	const pt = connectionLabelPoint(route);
	const r = labelRectAt(connection, { x: toMilli(pt.x), y: toMilli(pt.y) });
	return r === undefined ? undefined : rectUnits(r);
}

const EMPTY_REPORT: SchematicRoutingReport = Object.freeze({
	attempts: 0,
	rippedUp: Object.freeze([]),
	congestion: Object.freeze([]),
	nudged: false
});
export const EMPTY_ROUTING_REPORT = EMPTY_REPORT;

function contactIdentities(connections: readonly SchematicConnection[]): Int32Array {
	const set = unions(connections.length);
	const seen = new Map<string, number>();
	const link = (key: string, i: number): void => {
		const o = seen.get(key);
		if (o === undefined) seen.set(key, i);
		else set.join(i, o);
	};
	for (let i = 0; i < connections.length; i += 1) {
		const c = connections[i]!;
		if (c.netId !== undefined) link(`n:${c.netId}`, i);
		if (c.net !== undefined) link(`m:${c.net}`, i);
		link(`t:${c.from.componentId}.${c.from.port}`, i);
		link(`t:${c.to.componentId}.${c.to.port}`, i);
		if (c.from.componentId === c.to.componentId) link(`i:${c.from.componentId}`, i);
	}
	const out = new Int32Array(connections.length);
	for (let i = 0; i < connections.length; i += 1) out[i] = set.find(i);
	return out;
}

function cubicEntersRect(pts: readonly [IPoint, IPoint, IPoint, IPoint], rect: IRect): boolean {
	const [a, b, c, d] = pts;
	const minX = Math.min(a.x, b.x, c.x, d.x);
	const minY = Math.min(a.y, b.y, c.y, d.y);
	const maxX = Math.max(a.x, b.x, c.x, d.x);
	const maxY = Math.max(a.y, b.y, c.y, d.y);
	if (maxX <= rect.minX || minX >= rect.maxX || maxY <= rect.minY || minY >= rect.maxY) return false;
	if (maxX - minX <= 250 && maxY - minY <= 250) return true;
	const mid = (l: IPoint, r: IPoint): IPoint => ({ x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 });
	const ab = mid(a, b);
	const bc = mid(b, c);
	const cd = mid(c, d);
	const abc = mid(ab, bc);
	const bcd = mid(bc, cd);
	const ctr = mid(abc, bcd);
	return cubicEntersRect([a, ab, abc, ctr], rect) || cubicEntersRect([ctr, bcd, cd, d], rect);
}

function flattenCubic(a: IPoint, b: IPoint, c: IPoint, d: IPoint): IPoint[] {
	const out: IPoint[] = new Array(25);
	for (let step = 0; step <= 24; step += 1) {
		const t = step / 24;
		const s = 1 - t;
		out[step] = {
			x: Math.round(s * s * s * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t * t * t * d.x),
			y: Math.round(s * s * s * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t * t * t * d.y)
		};
	}
	return out;
}

const MARKER_SIZES: Readonly<Record<string, readonly [number, number]>> = {
	dot: [4, 4], arrow: [8, 4], 'open-arrow': [9, 5], triangle: [12, 6], diamond: [12, 6], 'diamond-filled': [12, 6]
};

function checkMarkers(c: SchematicConnection, pts: readonly IPoint[], solid: Buckets<{ owner: string; rect: IRect }>): void {
	for (let k = 0; k < 2; k += 1) {
		const marker = k === 0 ? c.markerStart : c.markerEnd;
		const size = MARKER_SIZES[marker];
		if (size === undefined) continue;
		const end = k === 0 ? pts[0]! : pts[pts.length - 1]!;
		const next = k === 0 ? pts[1]! : pts[pts.length - 2]!;
		const dx = next.x - end.x;
		const dy = next.y - end.y;
		const mag = Math.hypot(dx, dy);
		const inward = { x: end.x + Math.round((dx / mag) * size[0] * 1000), y: end.y + Math.round((dy / mag) * size[0] * 1000) };
		const pad = size[1] * 1000;
		const span: IRect = {
			minX: Math.min(end.x, inward.x) - pad,
			minY: Math.min(end.y, inward.y) - pad,
			maxX: Math.max(end.x, inward.x) + pad,
			maxY: Math.max(end.y, inward.y) + pad
		};
		for (const body of solid.query(span)) {
			if (body.owner === c.from.componentId || body.owner === c.to.componentId) continue;
			if (segmentEntersRect(end, inward, inflate(body.rect, pad))) {
				throw new SchematicSyntaxError(`${marker} marker intersects ${body.owner}; use ortho or move the obstacle.`, c.line, undefined, 'routing');
			}
		}
	}
}

function orthogonalPathData(
	pts: readonly IPoint[],
	crossings: ReadonlyMap<number, readonly number[]>,
	room: (x: number, y: number) => number,
	line: number
): { d: string; extrema: IPoint[] } {
	let d = `M ${fmt(pts[0]!.x)} ${fmt(pts[0]!.y)}`;
	const extrema: IPoint[] = [pts[0]!];
	for (let i = 1; i < pts.length; i += 1) {
		const a = pts[i - 1]!;
		const b = pts[i]!;
		if (a.y === b.y) {
			d += ` H ${fmt(b.x)}`;
			extrema.push(b);
			continue;
		}
		const dir = b.y > a.y ? 1 : -1;
		const list = crossings.get(i - 1);
		if (list !== undefined) {
			const ys = [...list].sort((l, r) => dir * (l - r));
			let cur = a.y;
			for (let pos = 0; pos < ys.length; pos += 1) {
				const y = ys[pos]!;
				const r = Math.min(
					room(a.x, y),
					Math.abs(y - a.y),
					Math.abs(b.y - y),
					pos === 0 ? Infinity : Math.floor(Math.abs(y - ys[pos - 1]!) / 2),
					pos === ys.length - 1 ? Infinity : Math.floor(Math.abs(ys[pos + 1]! - y) / 2)
				);
				if (r < 1) throw new SchematicSyntaxError('Wire crossings are too close to render distinct bridge arcs.', line, undefined, 'routing');
				if (y - dir * r !== cur) d += ` V ${fmt(y - dir * r)}`;
				d += ` A ${fmt(r)} ${fmt(r)} 0 0 ${dir > 0 ? 0 : 1} ${fmt(a.x)} ${fmt(y + dir * r)}`;
				cur = y + dir * r;
				extrema.push({ x: a.x, y: y - dir * r }, { x: a.x - r, y }, { x: a.x, y: y + dir * r });
			}
			if (cur !== b.y) d += ` V ${fmt(b.y)}`;
		} else {
			d += ` V ${fmt(b.y)}`;
		}
		extrema.push(b);
	}
	return { d, extrema };
}

export function routeSchematicConnections(
	connections: readonly SchematicConnection[],
	components: ReadonlyMap<string, SchematicComponent>,
	bounds?: SchematicBounds,
	wireCrossings: number = SCHEMATIC_LIMITS.wireCrossings,
	routingAttempts: number = SCHEMATIC_LIMITS.routingAttempts
): { readonly routes: readonly RoutedConnection[]; readonly report: SchematicRoutingReport } {
	if (connections.length === 0) return { routes: [], report: EMPTY_REPORT };

	const list = [...components.values()];
	const owners = new Map<string, number>();
	const clearance = SCHEMATIC_OBSTACLE_CLEARANCE * 1000;
	const obstacles: RouterObstacle[] = [];
	const hasNonOrtho = connections.some((c) => c.curve !== 'ortho');
	const occupied = new Buckets<{ owner: string; rect: IRect }>();
	const solid = new Buckets<{ owner: string; rect: IRect }>();
	const wired = new Set<string>();
	const identity = contactIdentities(connections);
	const netTerminals = hasNonOrtho ? new Map<number, Set<string>>() : undefined;
	for (let i = 0; i < connections.length; i += 1) {
		const c = connections[i]!;
		const fk = `${c.from.componentId}.${c.from.port}`;
		const tk = `${c.to.componentId}.${c.to.port}`;
		wired.add(fk);
		wired.add(tk);
		if (netTerminals !== undefined) {
			let set = netTerminals.get(identity[i]!);
			if (set === undefined) {
				set = new Set();
				netTerminals.set(identity[i]!, set);
			}
			set.add(fk);
			set.add(tk);
		}
	}
	const freePins = new Buckets<{ owner: string; name: string; point: IPoint }>();
	for (let i = 0; i < list.length; i += 1) {
		const c = list[i]!;
		owners.set(c.id, i);
		const body = bodyRect(c, 0);
		obstacles.push({ owner: i, kind: c.kind === 'junction' ? 'node' : 'body', rect: body }, { owner: i, kind: 'expanded', rect: inflate(body, clearance) });
		const bEntry = { owner: c.id, rect: body };
		solid.add(bEntry, body);
		occupied.add(bEntry, body);
		for (const rect of labelRects(c)) {
			obstacles.push({ owner: i, kind: 'label', rect: inflate(rect, TEXT_WIRE_CLEARANCE) });
			occupied.add({ owner: c.id, rect }, rect);
		}
		for (const p of placedPorts(c)) {
			const key = `${c.id}.${p.id}`;
			if (wired.has(key)) continue;
			const rect = inflate({ minX: p.point.x, minY: p.point.y, maxX: p.point.x, maxY: p.point.y }, 1);
			obstacles.push({ owner: i, kind: 'label', rect });
			freePins.add({ owner: c.id, name: key, point: p.point }, rect);
		}
	}

	const endpoint = (cid: string, port: string): PlacedPort => {
		const c = components.get(cid);
		if (c === undefined) throw new Error(`Validated component ${cid} is missing.`);
		return requirePort(c, port);
	};

	const routes: RoutedConnection[] = new Array(connections.length);
	const points: IPoint[][] = new Array(connections.length);
	const fixed: RouterFixed[] = [];
	const fixedChords: { index: number; a: IPoint; b: IPoint }[] = [];
	const orthogonal: number[] = [];

	for (let i = 0; i < connections.length; i += 1) {
		const c = connections[i]!;
		if (c.curve === 'ortho') {
			orthogonal.push(i);
			continue;
		}
		const start = endpoint(c.from.componentId, c.from.port).point;
		const end = endpoint(c.to.componentId, c.to.port).point;
		let chords: IPoint[];
		const reach: IRect = {
			minX: Math.min(start.x, end.x),
			minY: Math.min(start.y, end.y),
			maxX: Math.max(start.x, end.x),
			maxY: Math.max(start.y, end.y)
		};
		const candidates = occupied.query(reach);
		if (c.curve === 'bezier') {
			const mx = roundDiv(start.x + end.x, 2);
			const cA = { x: mx, y: start.y };
			const cB = { x: mx, y: end.y };
			for (const e of candidates) {
				if (e.owner !== c.from.componentId && e.owner !== c.to.componentId && cubicEntersRect([start, cA, cB, end], e.rect)) {
					throw new SchematicSyntaxError(`Bézier route intersects ${e.owner}; use an orthogonal route or move the obstacle.`, c.line, undefined, 'routing');
				}
			}
			points[i] = [start, cA, cB, end];
			routes[i] = {
				curve: 'bezier',
				d: `M ${fmt(start.x)} ${fmt(start.y)} C ${fmt(cA.x)} ${fmt(cA.y)}, ${fmt(cB.x)} ${fmt(cB.y)}, ${fmt(end.x)} ${fmt(end.y)}`,
				points: [unitPoint(start), unitPoint(cA), unitPoint(cB), unitPoint(end)]
			};
			chords = flattenCubic(start, cA, cB, end);
		} else {
			for (const e of candidates) {
				if (e.owner !== c.from.componentId && e.owner !== c.to.componentId && segmentEntersRect(start, end, e.rect)) {
					throw new SchematicSyntaxError(`Line route intersects ${e.owner}; use an orthogonal route or move the obstacle.`, c.line, undefined, 'routing');
				}
			}
			points[i] = [start, end];
			routes[i] = { curve: 'line', d: `M ${fmt(start.x)} ${fmt(start.y)} L ${fmt(end.x)} ${fmt(end.y)}`, points: [unitPoint(start), unitPoint(end)] };
			chords = [start, end];
		}
		checkMarkers(c, points[i]!, solid);
		const myNet = netTerminals!.get(identity[i]!)!;
		for (const comp of list) {
			if (comp.id === c.from.componentId || comp.id === c.to.componentId) continue;
			for (const p of placedPorts(comp)) {
				const at = p.point;
				if (at.x < reach.minX || at.x > reach.maxX || at.y < reach.minY || at.y > reach.maxY) continue;
				if (myNet.has(`${comp.id}.${p.id}`)) continue;
				for (let s = 1; s < chords.length; s += 1) {
					if (segmentContact(chords[s - 1]!, chords[s]!, at, at) !== undefined) {
						throw new SchematicSyntaxError(
							`${c.curve === 'bezier' ? 'Bézier' : 'Line'} route passes through ${comp.id}.${p.id}, which it does not connect; use an orthogonal route or move ${comp.id}.`,
							c.line,
							undefined,
							'routing'
						);
					}
				}
			}
		}
		for (let s = 1; s < chords.length; s += 1) {
			const a = chords[s - 1]!;
			const b = chords[s]!;
			if (a.x === b.x && a.y === b.y) continue;
			fixed.push({ net: identity[i]!, a, b });
			fixedChords.push({ index: i, a, b });
		}
	}

	for (let l = 0; l < fixedChords.length; l += 1) {
		const a = fixedChords[l]!;
		for (let r = l + 1; r < fixedChords.length; r += 1) {
			const b = fixedChords[r]!;
			if (a.index === b.index || identity[a.index] === identity[b.index]) continue;
			if (segmentContact(a.a, a.b, b.a, b.b) !== undefined) {
				throw new SchematicSyntaxError(
					'Separate nets touch or cross without an orthogonal bridge; use ortho, a shared net, or an explicit junction.',
					connections[Math.max(a.index, b.index)]!.line,
					undefined,
					'routing'
				);
			}
		}
	}

	if (orthogonal.length === 0) return { routes, report: EMPTY_REPORT };

	const groups = unions(connections.length);
	const termOwner = new Map<string, number>();
	const termCache = new Map<string, { placed: PlacedPort; term: RouterTerminal }>();
	const getTerm = (cid: string, port: string): { placed: PlacedPort; term: RouterTerminal } => {
		const key = `${cid}.${port}`;
		const hit = termCache.get(key);
		if (hit !== undefined) return hit;
		const placed = endpoint(cid, port);
		const comp = components.get(cid)!;
		const owner = owners.get(cid)!;
		if (comp.kind === 'junction') {
			const res = { placed, term: { owner, point: placed.point, escape: placed.point } };
			termCache.set(key, res);
			return res;
		}
		const exp = bodyRect(comp, clearance);
		let esc: IPoint = {
			x: placed.normal.x < 0 ? exp.minX : placed.normal.x > 0 ? exp.maxX : placed.point.x,
			y: placed.normal.y < 0 ? exp.minY : placed.normal.y > 0 ? exp.maxY : placed.point.y
		};
		const orig = esc;
		if (placed.normal.x === 0) {
			for (const t of labelRects(comp)) {
				const r = inflate(t, TEXT_WIRE_CLEARANCE);
				if (esc.x <= r.minX || esc.x >= r.maxX) continue;
				if (placed.normal.y < 0 && r.minY < esc.y && r.maxY > esc.y - clearance) esc = { x: esc.x, y: r.minY };
				if (placed.normal.y > 0 && r.maxY > esc.y && r.minY < esc.y + clearance) esc = { x: esc.x, y: r.maxY };
			}
		}
		const outB = bounds !== undefined && (esc.x < 0 || esc.y < 0 || esc.x > toMilli(bounds.width) || esc.y > toMilli(bounds.height));
		const walled =
			outB ||
			occupied
				.query({ minX: esc.x, minY: esc.y, maxX: esc.x, maxY: esc.y })
				.some((e) => e.owner !== cid && esc.x > e.rect.minX && esc.x < e.rect.maxX && esc.y > e.rect.minY && esc.y < e.rect.maxY);
		const res = { placed, term: { owner, point: placed.point, escape: walled ? orig : esc } };
		termCache.set(key, res);
		return res;
	};

	const stubs: { index: number; owner: string; name: string; a: IPoint; b: IPoint; minX: number; maxX: number }[] = [];
	const wireEnds: { from: { placed: PlacedPort; term: RouterTerminal }; to: { placed: PlacedPort; term: RouterTerminal } }[] = new Array(orthogonal.length);
	for (let p = 0; p < orthogonal.length; p += 1) {
		const i = orthogonal[p]!;
		const c = connections[i]!;
		const f = getTerm(c.from.componentId, c.from.port);
		const t = getTerm(c.to.componentId, c.to.port);
		wireEnds[p] = { from: f, to: t };
		const fk = `${c.from.componentId}.${c.from.port}`;
		const tk = `${c.to.componentId}.${c.to.port}`;
		if (c.relation === 'signal') {
			for (const k of [fk, tk]) {
				const o = termOwner.get(k);
				if (o === undefined) termOwner.set(k, i);
				else groups.join(i, o);
			}
		}
		stubs.push(
			{ index: i, owner: c.from.componentId, name: fk, a: f.term.point, b: f.term.escape, minX: Math.min(f.term.point.x, f.term.escape.x), maxX: Math.max(f.term.point.x, f.term.escape.x) },
			{ index: i, owner: c.to.componentId, name: tk, a: t.term.point, b: t.term.escape, minX: Math.min(t.term.point.x, t.term.escape.x), maxX: Math.max(t.term.point.x, t.term.escape.x) }
		);
	}

	const sortedStubs = [...stubs].sort((l, r) => l.minX - r.minX || l.index - r.index);
	const active: typeof stubs = [];
	for (const s of sortedStubs) {
		let kept = 0;
		for (let j = 0; j < active.length; j += 1) if (active[j]!.maxX >= s.minX) active[kept++] = active[j]!;
		active.length = kept;
		for (let j = 0; j < active.length; j += 1) {
			const o = active[j]!;
			if (identity[o.index] !== identity[s.index] && segmentContact(s.a, s.b, o.a, o.b) !== undefined) {
				const [first, second] = s.index > o.index ? [o, s] : [s, o];
				throw new SchematicSyntaxError(
					`${first.name} and ${second.name} sit too close to route apart as separate nets: the wires leaving them would touch. Move one of them away, or join them with a shared net.`,
					connections[second.index]!.line,
					undefined,
					'routing'
				);
			}
		}
		active.push(s);
	}

	/* Stubs are already in source order! */
	for (let si = 0; si < stubs.length; si += 1) {
		const s = stubs[si]!;
		const c = connections[s.index]!;
		const pair = wireEnds[si >> 1]!;
		const p0 = pair.from.placed;
		const p1 = pair.to.placed;
		const facing =
			(p0.point.x === p1.point.x || p0.point.y === p1.point.y) &&
			Math.sign(p1.point.x - p0.point.x) === p0.normal.x &&
			Math.sign(p1.point.y - p0.point.y) === p0.normal.y &&
			p1.normal.x === -p0.normal.x &&
			p1.normal.y === -p0.normal.y;
		const span: IRect = { minX: s.minX, maxX: s.maxX, minY: Math.min(s.a.y, s.b.y), maxY: Math.max(s.a.y, s.b.y) };
		for (const body of solid.query(span)) {
			if (body.owner === s.owner || (facing && (body.owner === c.from.componentId || body.owner === c.to.componentId)) || !segmentEntersRect(s.a, s.b, body.rect)) continue;
			throw new SchematicSyntaxError(`${s.name} sits against ${body.owner}: the wire leaving it would run straight through ${body.owner}. Move one of them away.`, c.line, undefined, 'routing');
		}
		for (const free of freePins.query(span)) {
			if (free.owner !== s.owner && segmentContact(s.a, s.b, free.point, free.point) !== undefined) {
				throw new SchematicSyntaxError(
					`${s.name} sits against ${free.name}, which nothing is wired to: the wire leaving ${s.name} would read as joined to it. Move one of them away, or wire ${free.name}.`,
					c.line,
					undefined,
					'routing'
				);
			}
		}
	}

	const wires: RouterWire[] = orthogonal.map((i, pos) => {
		const c = connections[i]!;
		const sig = c.relation === 'signal';
		const ends = wireEnds[pos]!;
		return {
			from: ends.from.term,
			to: ends.to.term,
			net: identity[i]!,
			group: sig ? groups.find(i) : -1,
			joinFrom: sig && c.markerStart === 'none',
			joinTo: sig && c.markerEnd === 'none',
			meetFrom: components.get(c.from.componentId)!.kind === 'junction',
			meetTo: components.get(c.to.componentId)!.kind === 'junction',
			label: c.label === undefined ? undefined : (route) => labelRectAt(c, midpoint(route))
		};
	});

	const result = routeWires({
		bounds: bounds === undefined ? undefined : { width: bounds.width * 1000, height: bounds.height * 1000 },
		obstacles,
		wires,
		fixed,
		attempts: routingAttempts
	});
	if (result.failed !== undefined) {
		const c = connections[orthogonal[result.failed]!]!;
		if (result.reason === 'complexity') {
			throw new SchematicSyntaxError(`Orthogonal routing complexity exceeds ${MAX_ROUTER_STATES.toLocaleString('en-US')} search states.`, c.line, undefined, 'routing');
		}
		throw new SchematicSyntaxError(
			`No orthogonal route from ${c.from.componentId}.${c.from.port} to ${c.to.componentId}.${c.to.port} clears every component and earlier trace: move one of them apart, widen the fence bounds, or join the traces that meet with a shared net.`,
			c.line,
			undefined,
			'routing'
		);
	}

	const junctions = new Map<number, IPoint>();
	const byNet = new Map<number, number[]>();
	const horizontals: { index: number; y: number; low: number; high: number }[] = [];
	const verticals: { index: number; x: number; low: number; high: number }[] = [];
	const ends = new Map<number, Map<number, number[]>>();
	const cells = new Map<number, { x: number; y: number; load: number }>();
	const cellSize = SCHEMATIC_CONGESTION_CELL_SIZE * 1000;

	for (let pos = 0; pos < orthogonal.length; pos += 1) {
		const i = orthogonal[pos]!;
		const routed = result.wires[pos]!;
		const pts = compact(routed.points);
		points[i] = pts;
		if (routed.junction !== undefined) junctions.set(i, routed.junction);
		checkMarkers(connections[i]!, pts, solid);
		const net = identity[i]!;
		append(byNet, net, i);
		let cols = ends.get(net);
		if (cols === undefined) {
			cols = new Map();
			ends.set(net, cols);
		}
		append(cols, pts[0]!.x, pts[0]!.y);
		append(cols, pts[pts.length - 1]!.x, pts[pts.length - 1]!.y);
		for (let s = 1; s < pts.length; s += 1) {
			const a = pts[s - 1]!;
			const b = pts[s]!;
			if (a.y === b.y) horizontals.push({ index: i, y: a.y, low: Math.min(a.x, b.x), high: Math.max(a.x, b.x) });
			else verticals.push({ index: i, x: a.x, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y) });
			const c0 = Math.floor(Math.min(a.x, b.x) / cellSize);
			const c1 = Math.floor(Math.max(a.x, b.x) / cellSize);
			const r0 = Math.floor(Math.min(a.y, b.y) / cellSize);
			const r1 = Math.floor(Math.max(a.y, b.y) / cellSize);
			for (let col = c0; col <= c1; col += 1) {
				const base = (col + 1_048_576) * 2_097_152 + 1_048_576;
				for (let row = r0; row <= r1; row += 1) {
					const k = base + row;
					const e = cells.get(k);
					if (e === undefined) cells.set(k, { x: col * SCHEMATIC_CONGESTION_CELL_SIZE, y: row * SCHEMATIC_CONGESTION_CELL_SIZE, load: 1 });
					else e.load += 1;
				}
			}
		}
	}

	const joins = new Map<number, IPoint[]>();
	const seenJoins = new Set<string>();
	for (const peers of byNet.values()) {
		if (peers.length < 2) continue;
		for (const i of peers) {
			const route = points[i]!;
			for (let s = 1; s < route.length; s += 1) {
				const a = route[s - 1]!;
				const b = route[s]!;
				if (a.x !== b.x) continue;
				const loY = Math.min(a.y, b.y);
				const hiY = Math.max(a.y, b.y);
				for (const o of peers) {
					if (o === i) continue;
					const peer = points[o]!;
					for (let k = 1; k < peer.length; k += 1) {
						const c = peer[k - 1]!;
						const d = peer[k]!;
						if (c.y !== d.y || !(loY < c.y && c.y < hiY && Math.min(c.x, d.x) < a.x && a.x < Math.max(c.x, d.x))) continue;
						const key = `${a.x},${c.y}`;
						if (seenJoins.has(key)) continue;
						seenJoins.add(key);
						append(joins, i > o ? i : o, { x: a.x, y: c.y });
					}
				}
			}
		}
	}

	horizontals.sort((l, r) => l.y - r.y);
	const radius = SCHEMATIC_BRIDGE_RADIUS * 1000;
	let crossingCount = 0;
	for (const i of orthogonal) {
		const route = points[i]!;
		const crossings = new Map<number, number[]>();
		for (let s = 1; s < route.length; s += 1) {
			const a = route[s - 1]!;
			const b = route[s]!;
			if (a.x !== b.x) continue;
			const lo = Math.min(a.y, b.y);
			const hi = Math.max(a.y, b.y);
			let first = 0;
			let last = horizontals.length;
			while (first < last) {
				const mid = (first + last) >> 1;
				if (horizontals[mid]!.y <= lo) first = mid + 1;
				else last = mid;
			}
			for (let cur = first; cur < horizontals.length && horizontals[cur]!.y < hi; cur += 1) {
				const run = horizontals[cur]!;
				if (identity[run.index] === identity[i] || !(run.low < a.x && a.x < run.high)) continue;
				if (crossings.get(s - 1)?.includes(run.y) === true) continue;
				if (++crossingCount > wireCrossings) {
					throw new SchematicSyntaxError(`Wire crossing complexity exceeds ${wireCrossings.toLocaleString('en-US')} intersections.`, connections[i]!.line, undefined, 'routing');
				}
				append(crossings, s - 1, run.y);
			}
		}
		const touches = ends.get(identity[i]!)!;
		const room = (x: number, y: number): number => {
			let limit = radius;
			for (const ty of touches.get(x) ?? []) {
				const d = Math.abs(ty - y);
				if (d <= radius) limit = Math.min(limit, Math.floor((d - 1) / 1000) * 1000);
			}
			for (const run of verticals) {
				if (identity[run.index] === identity[i] || run.x >= x || run.x <= x - 2 * radius) continue;
				if (run.low < y + radius && run.high > y - radius) limit = Math.min(limit, Math.floor((x - run.x) / 2));
			}
			return limit;
		};
		const { d, extrema } = orthogonalPathData(route, crossings, room, connections[i]!.line);
		const junction = junctions.get(i);
		const dots = joins.get(i);
		routes[i] = {
			curve: 'ortho',
			d,
			points: extrema.map(unitPoint) as unknown as [SchematicPoint, SchematicPoint, ...SchematicPoint[]],
			...(junction === undefined ? {} : { junction: unitPoint(junction) }),
			...(dots === undefined ? {} : { joins: dots.map(unitPoint) })
		};
	}

	return {
		routes,
		report: {
			attempts: result.attempts,
			rippedUp: result.rippedUp.map((e) => ({ connectionIndex: orthogonal[e.wire]!, attempt: e.attempt })),
			congestion: [...cells.values()].sort((l, r) => l.x - r.x || l.y - r.y),
			nudged: false
		}
	};
}

export const routeConnections = (
	connections: readonly SchematicConnection[],
	components: ReadonlyMap<string, SchematicComponent>,
	bounds?: SchematicBounds,
	wireCrossings: number = SCHEMATIC_LIMITS.wireCrossings
): readonly RoutedConnection[] => routeSchematicConnections(connections, components, bounds, wireCrossings).routes;

export const routeConnection = (connection: SchematicConnection, components: ReadonlyMap<string, SchematicComponent>, bounds?: SchematicBounds): RoutedConnection =>
	routeSchematicConnections([connection], components, bounds).routes[0]!;

const CONTAINERS = new Set(['package', 'component', 'node', 'device', 'system', 'partition', 'fragment', 'interaction', 'region']);
const PINNED = new Set(['activation', 'execution', 'destruction']);

function overlapAllowed(l: { component: SchematicComponent; rect: IRect }, r: { component: SchematicComponent; rect: IRect }): boolean {
	for (const [box, child] of [[l, r], [r, l]] as const) {
		if (!CONTAINERS.has(box.component.kind)) continue;
		if (contains(box.rect, child.rect)) return true;
		if (child.component.kind === 'component-port' || child.component.kind === 'gate') {
			const x = toMilli(child.component.x);
			const y = toMilli(child.component.y);
			if (x >= box.rect.minX && x <= box.rect.maxX && y >= box.rect.minY && y <= box.rect.maxY) return true;
		}
	}
	return (l.component.kind === 'lifeline' && PINNED.has(r.component.kind)) || (r.component.kind === 'lifeline' && PINNED.has(l.component.kind));
}

function separationAdvice(m: IRect, f: IRect, origin: SchematicComponent): string {
	const ox = (m.minX + m.maxX - f.minX - f.maxX) / 2;
	const oy = (m.minY + m.maxY - f.minY - f.maxY) / 2;
	const h = Math.abs(ox) >= Math.abs(oy);
	const shift = h ? (ox >= 0 ? f.maxX - m.minX : f.minX - m.maxX) : oy >= 0 ? f.maxY - m.minY : f.minY - m.maxY;
	const ov = h ? Math.min(m.maxX, f.maxX) - Math.max(m.minX, f.minX) : Math.min(m.maxY, f.maxY) - Math.max(m.minY, f.minY);
	const amt = roundDiv(ov, 1000);
	const target = roundDiv(toMilli(h ? origin.x : origin.y) + shift, 1000);
	return `by ${amt} unit${amt === 1 ? '' : 's'} ${h ? 'horizontally' : 'vertically'}; move ${origin.id} to ${h ? 'x' : 'y'} ${shift > 0 ? '>=' : '<='} ${target}`;
}

export const SCHEMATIC_SHEET_MARGIN = 24;

function measureSheet(document: SchematicDocument, routes: readonly RoutedConnection[]): SchematicSheet {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const note = (x0: number, y0: number, x1: number, y1: number): void => {
		if (x0 < minX) minX = x0;
		if (y0 < minY) minY = y0;
		if (x1 > maxX) maxX = x1;
		if (y1 > maxY) maxY = y1;
	};
	for (const c of document.components) {
		const ext = componentExtent(c);
		note(ext.minX, ext.minY, ext.maxX, ext.maxY);
	}
	for (let i = 0; i < routes.length; i += 1) {
		const route = routes[i]!;
		for (const p of route.points) {
			const px = toMilli(p.x);
			const py = toMilli(p.y);
			note(px, py, px, py);
		}
		const cn = document.connections[i]!;
		if (cn.label !== undefined) {
			const mid = connectionLabelPoint(route);
			const lb = labelRectAt(cn, { x: toMilli(mid.x), y: toMilli(mid.y) })!;
			note(lb.minX, lb.minY, lb.maxX, lb.maxY);
		}
	}
	const margin = SCHEMATIC_SHEET_MARGIN * 1000;
	let x = Math.floor((minX - margin) / 1000);
	let y = Math.floor((minY - margin) / 1000);
	let width = Math.ceil((maxX + margin) / 1000) - x;
	let height = Math.ceil((maxY + margin) / 1000) - y;
	const wider = Math.max(0, MIN_SCHEMATIC_BOUND - width);
	const taller = Math.max(0, MIN_SCHEMATIC_BOUND - height);
	x -= Math.floor(wider / 2);
	y -= Math.floor(taller / 2);
	width += wider;
	height += taller;
	if (width > MAX_SCHEMATIC_BOUND || height > MAX_SCHEMATIC_BOUND) {
		throw new SchematicSyntaxError(
			`The drawing spans ${width}x${height}, which is more than the ${MAX_SCHEMATIC_BOUND.toLocaleString('en-US')} units a sheet may measure on a side; move the parts closer together.`,
			undefined,
			undefined,
			'geometry'
		);
	}
	return { x, y, width, height };
}

export function validateSchematicGeometry(
	document: SchematicDocument,
	fence: SchematicFence,
	routedConnections?: readonly RoutedConnection[]
): { readonly routes: readonly RoutedConnection[]; readonly report: SchematicRoutingReport; readonly sheet: SchematicSheet } {
	const rects = document.components.map((c) => bodyRect(c, 0));
	const ordered = document.components
		.map((component, i) => ({ component, rect: rects[i]! }))
		.sort((l, r) => l.rect.minX - r.rect.minX || l.rect.minY - r.rect.minY || l.component.line - r.component.line);
	const active: typeof ordered = [];
	for (const cur of ordered) {
		let kept = 0;
		for (let i = 0; i < active.length; i += 1) if (active[i]!.rect.maxX > cur.rect.minX) active[kept++] = active[i]!;
		active.length = kept;
		for (let i = 0; i < active.length; i += 1) {
			const prev = active[i]!;
			if (overlaps(prev.rect, cur.rect) && !overlapAllowed(prev, cur)) {
				throw new SchematicSyntaxError(
					`${cur.component.id} overlaps ${prev.component.id} ${separationAdvice(cur.rect, prev.rect, cur.component)}, or use a UML container.`,
					cur.component.line,
					undefined,
					'geometry'
				);
			}
		}
		active.push(cur);
	}
	const bounds = fence.bounds ?? 'auto';
	const limits = resolveSchematicLimits(fence.limits);
	const route = () =>
		routedConnections !== undefined
			? { routes: routedConnections, report: EMPTY_REPORT }
			: document.connections.length === 0
				? { routes: [], report: EMPTY_REPORT }
				: routeSchematicConnections(
						document.connections,
						new Map(document.components.map((c) => [c.id, c])),
						bounds === 'auto' ? undefined : bounds,
						limits.wireCrossings,
						limits.routingAttempts
					);
	if (bounds === 'auto') {
		const routed = route();
		return { ...routed, sheet: measureSheet(document, routed.routes) };
	}
	const width = toMilli(bounds.width);
	const height = toMilli(bounds.height);
	for (let i = 0; i < document.components.length; i += 1) {
		const c = document.components[i]!;
		const rect = rects[i]!;
		const maxText = Math.max(c.id.length, c.label.length) * 7_000 + 8_000;
		if (c.kind !== 'junction' && c.kind !== 'ic' && rect.minX >= maxText && rect.maxX <= width - maxText && rect.minY >= 30_000 && rect.maxY <= height - 30_000) continue;
		const ext = componentExtent(c);
		if (ext.minX >= 0 && ext.minY >= 0 && ext.maxX <= width && ext.maxY <= height) continue;
		const x = toMilli(c.x);
		const y = toMilli(c.y);
		const u = (v: number) => roundDiv(v, 1000);
		const ov: string[] = [];
		if (ext.minX < 0) ov.push(`extends ${u(-ext.minX)} left of x=0; move ${c.id} to x >= ${u(x - ext.minX)}`);
		if (ext.maxX > width) ov.push(`extends ${u(ext.maxX - width)} past x=${bounds.width}; move ${c.id} to x <= ${u(x - (ext.maxX - width))}`);
		if (ext.minY < 0) ov.push(`extends ${u(-ext.minY)} above y=0; move ${c.id} to y >= ${u(y - ext.minY)}`);
		if (ext.maxY > height) ov.push(`extends ${u(ext.maxY - height)} past y=${bounds.height}; move ${c.id} to y <= ${u(y - (ext.maxY - height))}`);
		throw new SchematicSyntaxError(
			`${c.id} geometry exceeds the declared ${bounds.width}x${bounds.height} bounds: ${ov.join(', and ')}. Widen the fence bounds if the diagram needs the room.`,
			c.line,
			undefined,
			'geometry'
		);
	}
	const routed = route();
	if (routed.routes.length !== document.connections.length) throw new TypeError('Routed connection count does not match the schematic document.');
	for (let i = 0; i < document.connections.length; i += 1) {
		if (!routed.routes[i]!.points.every((p) => p.x >= 0 && p.y >= 0 && p.x <= bounds.width && p.y <= bounds.height)) {
			throw new SchematicSyntaxError('Connection trace exceeds the declared schematic bounds.', document.connections[i]!.line, undefined, 'routing');
		}
	}
	return { ...routed, sheet: { x: 0, y: 0, width: bounds.width, height: bounds.height } };
}

export const validateDocumentGeometry = (
	document: SchematicDocument,
	fence: SchematicFence,
	routedConnections?: readonly RoutedConnection[]
): readonly RoutedConnection[] => validateSchematicGeometry(document, fence, routedConnections).routes;
