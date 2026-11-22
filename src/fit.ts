import { fromMilli, roundDiv, toMilli } from './geom.js';
import { distributed } from './symbols/common.js';
import { definition, resolvePlaced } from './symbols/index.js';
import {
	SchematicSyntaxError,
	type DigitalComponent,
	type IcComponent,
	type QuantumGateComponent,
	type QuantumSpecialComponent,
	type SchematicComponent,
	type SchematicConnection
} from './types.js';

export const FIT_GAP = 16;

type Fitted = (IcComponent | DigitalComponent | QuantumGateComponent | QuantumSpecialComponent) & { fit: 'wires' };
const isFitted = (c: SchematicComponent): c is Fitted => 'fit' in c && c.fit === 'wires';
const u = (m: number): string => String(fromMilli(m));

function arrival(c: SchematicComponent, port: string, connections: readonly SchematicConnection[], byId: ReadonlyMap<string, SchematicComponent>, pending: ReadonlySet<string>): number | undefined {
	let bestDx = Infinity;
	let bestY = 0;
	let bestKey = '';
	const cx = toMilli(c.x);
	for (const cn of connections) {
		const far =
			cn.from.componentId === c.id && cn.from.port === port
				? cn.to
				: cn.to.componentId === c.id && cn.to.port === port
					? cn.from
					: undefined;
		if (far === undefined || far.componentId === c.id || pending.has(far.componentId)) continue;
		const pt = resolvePlaced(byId.get(far.componentId)!, far.port)!.point;
		const dx = Math.abs(pt.x - cx);
		const key = `${far.componentId}.${far.port}`;
		if (dx < bestDx || (dx === bestDx && (pt.y < bestY || (pt.y === bestY && key < bestKey)))) {
			bestDx = dx;
			bestY = pt.y;
			bestKey = key;
		}
	}
	return bestDx === Infinity ? undefined : bestY;
}

function fill(known: readonly (number | undefined)[], pitch: number): number[] | undefined {
	const wired: number[] = [];
	for (let i = 0; i < known.length; i += 1) if (known[i] !== undefined) wired.push(i);
	if (wired.length === 0) return undefined;
	const first = wired[0]!;
	const last = wired.at(-1)!;
	return known.map((v, i) => {
		if (v !== undefined) return v;
		if (i < first) return known[first]! - (first - i) * pitch;
		if (i > last) return known[last]! + (i - last) * pitch;
		const lo = wired.filter((e) => e < i).at(-1)!;
		const hi = wired.find((e) => e > i)!;
		return known[lo]! + roundDiv((known[hi]! - known[lo]!) * (i - lo), hi - lo);
	});
}

function fitRails(c: QuantumGateComponent | QuantumSpecialComponent, connections: readonly SchematicConnection[], byId: ReadonlyMap<string, SchematicComponent>, pending: ReadonlySet<string>): void {
	const ports = definition(c).ports(c);
	const ins = ports.filter((e) => e.nx < 0 && e.ny === 0);
	const outs = ports.filter((e) => e.nx > 0 && e.ny === 0);
	const rails = fill(
		ins.map((p, i) => arrival(c, p.id, connections, byId, pending) ?? arrival(c, outs[i]!.id, connections, byId, pending)),
		18_000
	);
	if (rails === undefined) return;
	const order = rails.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
	for (let i = 1; i < order.length; i += 1) {
		const [uv, ui] = order[i - 1]!;
		const [lv, li] = order[i]!;
		if (lv - uv < FIT_GAP * 1000) {
			throw new SchematicSyntaxError(
				`${c.id} cannot line up rails ${ui + 1} and ${li + 1} with their wires: they arrive ${u(lv - uv)} units apart, and rails need at least ${FIT_GAP}. Move the wire on rail ${li + 1} to y >= ${u(uv + FIT_GAP * 1000)}, or remove fit=wires.`,
				c.line,
				undefined,
				'geometry'
			);
		}
	}
	const centre = roundDiv(order[0]![0] + order.at(-1)![0], 2);
	c.y = fromMilli(centre);
	c.rails = rails.map((v) => fromMilli(v - centre));
}

function fitRows(c: IcComponent | DigitalComponent, connections: readonly SchematicConnection[], byId: ReadonlyMap<string, SchematicComponent>, pending: ReadonlySet<string>): void {
	const ports = definition(c).ports(c);
	const pitch = c.kind === 'ic' ? 18_000 : 16_000;
	const sides = (['left', 'right'] as const).map((side) => {
		const terms = ports.filter((e) => e.ny === 0 && (side === 'left' ? e.nx < 0 : e.nx > 0));
		return { side, terms, rows: fill(terms.map((e) => arrival(c, e.id, connections, byId, pending)), pitch) };
	});
	const wired = sides.flatMap((e) => e.rows ?? []);
	if (wired.length === 0) return;
	for (const { side, terms, rows } of sides) {
		for (let i = 1; rows !== undefined && i < rows.length; i += 1) {
			const up = rows[i - 1]!;
			const lo = rows[i]!;
			if (lo - up >= FIT_GAP * 1000) continue;
			const above = terms[i - 1]!.id;
			const below = terms[i]!.id;
			throw new SchematicSyntaxError(
				lo <= up
					? `${c.id} cannot line up ${below} with its wire: it arrives at y=${u(lo)}, ${lo === up ? 'level with' : 'above'} ${above}'s at y=${u(up)}, but ${below} sits below ${above} on ${c.id}'s ${side} side. Swap the wires, reorder the pins, or remove fit=wires.`
					: `${c.id} cannot line up ${below} with its wire: it arrives ${u(lo - up)} units below ${above}'s, and pins need at least ${FIT_GAP}. Move the wire on ${below} to y >= ${u(up + FIT_GAP * 1000)}, or remove fit=wires.`,
				c.line,
				undefined,
				'geometry'
			);
		}
	}
	const centre = roundDiv(Math.min(...wired) + Math.max(...wired), 2);
	let reach = 0;
	for (const v of wired) reach = Math.max(reach, Math.abs(v - centre));
	const height = Math.max(c.bodyHeight * 1000, 2 * (reach + pitch));
	const placed = sides.map(({ terms, rows }) =>
		(rows === undefined ? terms.map((_, i) => distributed(i, terms.length, height)) : rows.map((v) => v - centre)).map(fromMilli)
	);
	c.y = fromMilli(centre);
	c.bodyHeight = fromMilli(height);
	c.rows = { left: placed[0]!, right: placed[1]! };
}

export function fitComponents(components: readonly SchematicComponent[], connections: readonly SchematicConnection[], report: (error: unknown) => void): void {
	if (!components.some(isFitted)) return;
	const byId = new Map(components.map((c) => [c.id, c]));
	const order = components
		.filter(isFitted)
		.sort((a, b) => toMilli(a.x) - toMilli(b.x) || toMilli(a.y) - toMilli(b.y) || (a.id < b.id ? -1 : 1));
	const pending = new Set(order.map((c) => c.id));
	for (const c of order) {
		pending.delete(c.id);
		try {
			if (c.kind === 'ic' || 'bodyHeight' in c) fitRows(c as IcComponent | DigitalComponent, connections, byId, pending);
			else fitRails(c, connections, byId, pending);
		} catch (error) {
			report(error);
		}
	}
}
