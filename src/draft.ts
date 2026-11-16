/**
 * Draft placement: coordinates for the parts an author did not place.
 *
 * A declaration may leave its position out — `resistor:R1 "1 k" #amber`. This
 * pass gives each such part one, from the wires alone, before anything
 * downstream reads the document. Like relative placement it is a *lowering
 * pass*: the netlist, the router and the renderer only ever see `at (x, y)`.
 *
 * The rule is the one a person follows when sketching a circuit from its
 * netlist. Start from a part that already has a position, or from the first
 * part declared. Follow each of its wires, in source order, to a part that has
 * none, and set that part down so the wire between the two pins is one
 * straight segment: beyond the pin it enters by, facing it. If something is
 * already there, step sideways until there is room. Repeat from the parts just
 * placed, nearest first.
 *
 * It is a draft, not a layout engine. Nothing is optimised, nothing is moved
 * once it is down, and a part an author did place is never touched. Every
 * derived coordinate is reported as a {@link SchematicPlacement}, so a host can
 * write the draft back into the source, where the author owns it.
 *
 * **Determinism.** One breadth-first walk in source order over integer
 * milli-units, and a fixed sequence of candidate positions. No solver, no
 * iteration to a fixed point, no dependence on anything but the document.
 *
 * @packageDocumentation
 */
import { fromMilli, overlaps, toMilli, type IPoint, type IRect } from './geom.js';
import { componentExtent } from './layout.js';
import type { SchematicPlacement } from './placement.js';
import { resolvePlaced } from './symbols/index.js';
import type { SchematicComponent, SchematicConnection } from './types.js';

/** Distance between the two pins of a drafted wire, in viewBox units. */
export const DRAFT_PIN_GAP = 100;
/** Clear space a drafted part keeps from every part already down, in viewBox units. */
export const DRAFT_CLEARANCE = 30;
/** Where the first part of a document with no stated position is set down. */
export const DRAFT_ORIGIN = 80;
/** How wide a row of unconnected groups may grow before the next row starts, in viewBox units. */
export const DRAFT_BAND_WIDTH = 960;

const STEP = 20_000;
const SIDE_STEPS = 60;
const RINGS = 8;

/**
 * Place every component in `drafted`, in place, and report what was derived.
 *
 * @param components - Every declared component, in source order.
 * @param drafted - The components whose declarations stated no position.
 * @param waiting - Components placed by a relation that is resolved after this
 *   pass; they have no position yet, so nothing is measured from them.
 * @param connections - Validated connections, in source order.
 */
export function draftPlacements(
	components: readonly SchematicComponent[],
	drafted: ReadonlySet<SchematicComponent>,
	waiting: ReadonlySet<SchematicComponent>,
	connections: readonly SchematicConnection[]
): SchematicPlacement[] {
	const byId = new Map(components.map((component) => [component.id, component]));
	const wires = new Map<SchematicComponent, { readonly own: string; readonly other: SchematicComponent; readonly otherPort: string; readonly forward: boolean }[]>();
	const link = (a: SchematicComponent, aPort: string, b: SchematicComponent, bPort: string, forward: boolean): void => {
		let list = wires.get(a);
		if (list === undefined) wires.set(a, (list = []));
		list.push({ own: aPort, other: b, otherPort: bPort, forward });
	};
	for (const connection of connections) {
		const from = byId.get(connection.from.componentId)!;
		const to = byId.get(connection.to.componentId)!;
		link(from, connection.from.port, to, connection.to.port, true);
		link(to, connection.to.port, from, connection.from.port, false);
	}

	/* Everything already down, as the rectangle a newcomer must keep clear of. */
	const down: { readonly component: SchematicComponent; readonly rect: IRect }[] = [];
	const settle = (component: SchematicComponent): void => {
		down.push({ component, rect: componentExtent(component) });
	};
	const queue: SchematicComponent[] = [];
	for (const component of components) {
		if (drafted.has(component) || waiting.has(component)) continue;
		settle(component);
		queue.push(component);
	}
	const wholeDocument = down.length === 0 && waiting.size === 0;

	const clearance = DRAFT_CLEARANCE * 1000;
	/** The parts a candidate position would crowd. */
	const crowded = (component: SchematicComponent, x: number, y: number): SchematicComponent[] => {
		component.x = fromMilli(x);
		component.y = fromMilli(y);
		const own = componentExtent(component);
		const rect = { minX: own.minX - clearance, minY: own.minY - clearance, maxX: own.maxX + clearance, maxY: own.maxY + clearance };
		return down.filter((entry) => overlaps(entry.rect, rect)).map((entry) => entry.component);
	};

	/*
	 * A part no wire reaches from anything already down starts a new group.
	 * Groups run left to right along a band, and a band that has grown past
	 * DRAFT_BAND_WIDTH is closed and the next one opened beneath everything.
	 */
	let band = 0;
	const apart = (component: SchematicComponent): IPoint => {
		component.x = 0;
		component.y = 0;
		const own = componentExtent(component);
		if (down.length === 0) return { x: DRAFT_ORIGIN * 1000 - own.minX, y: DRAFT_ORIGIN * 1000 - own.minY };
		let left = Infinity;
		let bottom = -Infinity;
		for (const entry of down) {
			left = Math.min(left, entry.rect.minX);
			bottom = Math.max(bottom, entry.rect.maxY);
		}
		let top = Infinity;
		let right = -Infinity;
		for (const entry of down.slice(band)) {
			top = Math.min(top, entry.rect.minY);
			right = Math.max(right, entry.rect.maxX);
		}
		if (right - left < DRAFT_BAND_WIDTH * 1000) return { x: right + 2 * clearance - own.minX, y: top - own.minY };
		band = down.length;
		return { x: left - own.minX, y: bottom + 2 * clearance - own.minY };
	};

	/** Set `subject` down so its `port` faces `pin`, the placed end of their wire. */
	const beside = (subject: SchematicComponent, port: string, anchor: SchematicComponent, pin: string): IPoint => {
		const fixed = resolvePlaced(anchor, pin)!;
		subject.x = 0;
		subject.y = 0;
		const own = resolvePlaced(subject, port)!;
		/* The subject sits beyond the pin it is entered by. A pin with no facing —
		   a junction's node — follows the wire leaving the anchor instead; so does
		   a pin whose far side is the anchor's own body. */
		const none = (vector: IPoint): boolean => vector.x === 0 && vector.y === 0;
		/* A pin at its part's own centre — a junction's node, a test point — has
		   no side: wires meet it from every direction. */
		const centred = (pin: typeof own, part: SchematicComponent): boolean => pin.point.x === toMilli(part.x) && pin.point.y === toMilli(part.y);
		const beyond: IPoint = centred(own, subject) ? { x: 0, y: 0 } : { x: -own.normal.x, y: -own.normal.y };
		const outward: IPoint = centred(fixed, anchor) ? { x: 0, y: 0 } : fixed.normal;
		let d = beyond;
		/* Two pins with no side between them — one junction wired to another — read left to right. */
		if (none(beyond) || beyond.x * outward.x + beyond.y * outward.y < 0) d = none(outward) ? { x: 1, y: 0 } : outward;
		const side: IPoint = { x: d.y === 0 ? 0 : 1, y: d.y === 0 ? 1 : 0 };
		const at = (distance: number, offset: number): IPoint => ({
			x: fixed.point.x + d.x * distance + side.x * offset - own.point.x,
			y: fixed.point.y + d.y * distance + side.y * offset - own.point.y
		});
		let distance = DRAFT_PIN_GAP * 1000;
		for (let ring = 0; ring < RINGS; ring += 1, distance += 4 * STEP) {
			/* Too close to the anchor alone is a matter of distance, not of room. */
			for (let tries = 0; tries < 20; tries += 1) {
				const point = at(distance, 0);
				const blocking = crowded(subject, point.x, point.y);
				if (blocking.length !== 1 || blocking[0] !== anchor) break;
				distance += STEP;
			}
			for (let step = 0; step <= 2 * SIDE_STEPS; step += 1) {
				const offset = (step % 2 === 1 ? 1 : -1) * Math.ceil(step / 2) * STEP;
				const point = at(distance, offset);
				if (crowded(subject, point.x, point.y).length === 0) return point;
			}
		}
		return apart(subject);
	};

	const placements: SchematicPlacement[] = [];
	const commit = (component: SchematicComponent, point: IPoint): void => {
		component.x = fromMilli(point.x);
		component.y = fromMilli(point.y);
		settle(component);
		queue.push(component);
		placed.add(component);
	};
	const placed = new Set<SchematicComponent>();
	const pendingOrder = components.filter((component) => drafted.has(component));
	const open = (wire: { readonly other: SchematicComponent }): boolean => drafted.has(wire.other) && !placed.has(wire.other);
	let next = 0;
	let seed = 0;
	for (;;) {
		/* Follow every wire the way it was written, `A -> B`, nearest parts first. */
		for (; next < queue.length; next += 1) {
			const anchor = queue[next]!;
			for (const wire of wires.get(anchor) ?? []) {
				if (wire.forward && open(wire)) commit(wire.other, beside(wire.other, wire.otherPort, anchor, wire.own));
			}
		}
		/* Only when nothing is left downstream is a part placed from the far end
		   of its wire, and then one at a time, so its own wires are followed first. */
		let behind = false;
		for (const anchor of queue) {
			const wire = (wires.get(anchor) ?? []).find(open);
			if (wire === undefined) continue;
			commit(wire.other, beside(wire.other, wire.otherPort, anchor, wire.own));
			behind = true;
			break;
		}
		if (behind) continue;
		while (seed < pendingOrder.length && placed.has(pendingOrder[seed]!)) seed += 1;
		if (seed === pendingOrder.length) break;
		commit(pendingOrder[seed]!, apart(pendingOrder[seed]!));
	}

	/* A document that states no position at all starts at a tidy corner. */
	if (wholeDocument) {
		let left = Infinity;
		let top = Infinity;
		for (const entry of down) {
			left = Math.min(left, entry.rect.minX);
			top = Math.min(top, entry.rect.minY);
		}
		const dx = DRAFT_ORIGIN * 1000 - Math.floor(left / 1000) * 1000;
		const dy = DRAFT_ORIGIN * 1000 - Math.floor(top / 1000) * 1000;
		for (const component of pendingOrder) {
			component.x = fromMilli(toMilli(component.x) + dx);
			component.y = fromMilli(toMilli(component.y) + dy);
		}
	}
	for (const component of pendingOrder) {
		placements.push({ id: component.id, line: component.line, resolved: { x: component.x, y: component.y }, relations: [] });
	}
	return placements;
}
