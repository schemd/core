import { append, fromMilli, parseMilli, toMilli, type IRect } from './geom.js';
import { componentExtent } from './layout.js';
import { canonicalName, resolvePlaced } from './symbols/index.js';
import { SchematicSyntaxError, type SchematicComponent, type SchematicPlacementRelation, type SchematicPoint } from './types.js';

export const PLACEMENT_HORIZONTAL_GAP = 160;
export const PLACEMENT_VERTICAL_GAP = 140;

export interface SchematicPlacement {
	readonly id: string;
	readonly line: number;
	readonly resolved: SchematicPoint;
	readonly relations: readonly SchematicPlacementRelation[];
}

export interface PendingPlacement {
	readonly component: SchematicComponent;
	readonly relations: readonly SchematicPlacementRelation[];
	readonly spans?: readonly ({ readonly column: number; readonly endColumn: number } | undefined)[];
}

function milliOf(value: number): number {
	const text = String(value);
	return /e/i.test(text) ? toMilli(value) : parseMilli(text);
}

function refGeom(c: SchematicComponent, rel: SchematicPlacementRelation): IRect & { originX: number; originY: number } {
	if (rel.port === undefined) return { ...componentExtent(c, true), originX: toMilli(c.x), originY: toMilli(c.y) };
	const { x, y } = resolvePlaced(c, rel.port)!.point;
	return { minX: x, maxX: x, minY: y, maxY: y, originX: x, originY: y };
}

export function resolvePlacements(
	components: readonly SchematicComponent[],
	pending: readonly PendingPlacement[],
	placementDepth: number,
	report?: (error: SchematicSyntaxError) => void,
	failedDeclarations?: ReadonlySet<string>
): readonly SchematicPlacement[] {
	const byId = new Map(components.map((c) => [c.id, c]));
	const pendingById = new Map(pending.map((e) => [e.component.id, e]));
	const failed = new Set<string>();
	const fail = (entry: PendingPlacement, msg: string, idx?: number): void => {
		const err = new SchematicSyntaxError(msg, entry.component.line, idx === undefined ? undefined : entry.spans?.[idx], 'placement');
		if (report === undefined) throw err;
		report(err);
		failed.add(entry.component.id);
	};

	const normalized = new Map<string, readonly SchematicPlacementRelation[]>();
	entries: for (const entry of pending) {
		const { component: c, relations } = entry;
		const canonical: SchematicPlacementRelation[] = [];
		for (let idx = 0; idx < relations.length; idx += 1) {
			const rel = relations[idx]!;
			if (rel.gap !== undefined && rel.gap < 0) {
				fail(entry, `${c.id} states a negative by distance of ${rel.gap}. Distances are unsigned; use the opposite direction instead.`, idx);
				continue entries;
			}
			if (rel.ref === c.id) {
				fail(entry, `${c.id} is placed relative to itself. Reference another declaration, or place it with at (x, y).`, idx);
				continue entries;
			}
			const ref = byId.get(rel.ref);
			if (ref === undefined && failedDeclarations?.has(rel.ref) === true) {
				failed.add(c.id);
				continue entries;
			}
			if (ref === undefined) {
				fail(entry, `${c.id} is placed relative to ${rel.ref}, which the document never declares. Declare ${rel.ref} anywhere in the document, or place ${c.id} with at (x, y).`, idx);
				continue entries;
			}
			let at: string | undefined;
			if (rel.at !== undefined) {
				at = canonicalName(c, rel.at);
				if (at === undefined) {
					fail(entry, `${c.id} has no terminal named ${rel.at} to line up with ${rel.ref}. Name one of ${c.id}'s terminals, or remove at ${rel.at} to align its centre.`, idx);
					continue entries;
				}
			}
			const own = at === undefined ? rel : { ...rel, at };
			if (rel.port === undefined) {
				canonical.push(own);
				continue;
			}
			const port = canonicalName(ref, rel.port);
			if (port === undefined) {
				fail(entry, `${rel.ref} has no terminal named ${rel.port}, so ${c.id} cannot be placed against it. Reference ${rel.ref} itself, or name a terminal it declares.`, idx);
				continue entries;
			}
			canonical.push({ ...own, port });
		}
		normalized.set(c.id, canonical);
	}

	const blocking = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	for (const e of pending) {
		const rels = normalized.get(e.component.id);
		if (rels === undefined) continue;
		const unresolved = new Set(rels.map((r) => r.ref).filter((r) => pendingById.has(r)));
		blocking.set(e.component.id, unresolved.size);
		for (const ref of unresolved) append(dependents, ref, e.component.id);
	}
	const abandon = (id: string): void => {
		const q = [id];
		for (let i = 0; i < q.length; i += 1) {
			failed.add(q[i]!);
			for (const dep of dependents.get(q[i]!) ?? []) if (!failed.has(dep)) q.push(dep);
		}
	};
	for (const id of [...failed]) abandon(id);

	const ready = pending.filter((e) => blocking.get(e.component.id) === 0).map((e) => e.component.id);
	const depth = new Map<string, number>();
	const resolved = new Set<string>();
	const placements: SchematicPlacement[] = [];

	for (let i = 0; i < ready.length; i += 1) {
		const id = ready[i]!;
		const entry = pendingById.get(id)!;
		const c = entry.component;
		const originComp = { ...c, x: 0, y: 0 } as SchematicComponent;
		const atOrigin = componentExtent(originComp, true);
		const rels = normalized.get(id)!;
		const seed = refGeom(byId.get(rels[0]!.ref)!, rels[0]!);
		let x = seed.originX;
		let y = seed.originY;
		let chain = 0;
		for (const rel of rels) {
			const rg = refGeom(byId.get(rel.ref)!, rel);
			const gap = rel.gap === undefined ? (rel.kind === 'right-of' || rel.kind === 'left-of' ? PLACEMENT_HORIZONTAL_GAP : PLACEMENT_VERTICAL_GAP) * 1000 : milliOf(rel.gap);
			if (rel.kind === 'right-of') x = rg.maxX + gap - atOrigin.minX;
			else if (rel.kind === 'left-of') x = rg.minX - gap - atOrigin.maxX;
			else if (rel.kind === 'below') y = rg.maxY + gap - atOrigin.minY;
			else if (rel.kind === 'above') y = rg.minY - gap - atOrigin.maxY;
			else if (rel.kind === 'aligned-x') x = rg.originX - (rel.at === undefined ? 0 : resolvePlaced(originComp, rel.at)!.point.x);
			else y = rg.originY - (rel.at === undefined ? 0 : resolvePlaced(originComp, rel.at)!.point.y);
			chain = Math.max(chain, (depth.get(rel.ref) ?? 0) + 1);
		}
		if (chain > placementDepth) {
			fail(entry, `${c.id} sits ${chain} placements deep, past the ${placementDepth.toLocaleString('en-US')} chain budget. Anchor one component in the chain with at (x, y).`);
			abandon(id);
			continue;
		}
		depth.set(id, chain);
		c.x = fromMilli(x);
		c.y = fromMilli(y);
		resolved.add(id);
		placements.push({ id, line: c.line, resolved: { x: c.x, y: c.y }, relations: rels });
		for (const dep of dependents.get(id) ?? []) {
			const rem = blocking.get(dep)! - 1;
			blocking.set(dep, rem);
			if (rem === 0) ready.push(dep);
		}
	}

	for (const entry of pending) {
		const id = entry.component.id;
		if (resolved.has(id) || failed.has(id)) continue;
		const path: string[] = [];
		const seen = new Set<string>();
		let cur = id;
		while (!seen.has(cur)) {
			seen.add(cur);
			path.push(cur);
			cur = pendingById.get(cur)!.relations.find((r) => pendingById.has(r.ref) && !resolved.has(r.ref))!.ref;
		}
		const cycle = [...path.slice(path.indexOf(cur)), cur];
		const idx = normalized.get(id)!.findIndex((r) => pendingById.has(r.ref) && !resolved.has(r.ref));
		fail(entry, `Placement cycle: ${cycle.join(' -> ')}. One component in a cycle must be placed with at (x, y).`, idx);
		for (const m of cycle) abandon(m);
		abandon(id);
	}
	return placements.sort((l, r) => l.line - r.line);
}
