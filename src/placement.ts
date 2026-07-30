/**
 * Relative placement: a constraint front-end that lowers to absolute coordinates.
 *
 * Every declaration used to require coordinates the author computed by hand, and
 * moving one part meant recomputing its neighbours. This module accepts the
 * relationships an author already has in mind — `right-of R1 by 190`,
 * `aligned-y with VIN` — and resolves them to exactly one `at (x, y)` before the
 * AST is finished. It is a *lowering pass*, not a layout engine: the netlist, the
 * source map, the renderer, and the design rules never learn that relative
 * placement exists, because by the time they run it does not.
 *
 * An axis no relation constrains inherits it from the first reference, so
 * `right-of R1 by 190` places a part beside R1 *and level with it* — what an
 * author reading that line means. Stating an alignment as well overrides the
 * inherited axis, which is how a part takes its column from one component and its
 * row from another.
 *
 * That distinction is the whole design. Auto-layout would decide where parts go;
 * this decides nothing. Every coordinate is a consequence of a relation the
 * author wrote, so the output stays as predictable as the absolute form and the
 * "you control the geometry" property survives.
 *
 * **Determinism.** One Kahn topological sort and one linear evaluation, with no
 * solver, no relaxation, and no iteration to a fixed point. A cycle is a compile
 * error rather than an under-constrained system to be minimised. Evaluation
 * order provably cannot reach the output — a component's position is a function
 * of its references' positions alone, never of when it was visited — so the only
 * place order is observable is the reported {@link SchematicPlacement} array,
 * which is sorted by source line for exactly that reason.
 *
 * @packageDocumentation
 */
import { canonicalPortName, componentRectangle, resolvePortPoint } from './layout.js';
import {
	SchematicSyntaxError,
	type SchematicComponent,
	type SchematicPlacementRelation,
	type SchematicPoint
} from './types.js';

/**
 * Default clear space between two horizontally related bodies, in viewBox units.
 *
 * Wide enough that two label rows on facing edges do not collide. Pinned by
 * `tests/placement.test.ts` rather than described in prose, because a default a
 * caller can observe is part of the contract.
 */
export const PLACEMENT_HORIZONTAL_GAP = 160;
/** Default clear space between two vertically related bodies, in viewBox units. */
export const PLACEMENT_VERTICAL_GAP = 140;

/** Coordinates the placement pass derived for one declaration, and from what. */
export interface SchematicPlacement {
	/** Document-unique component identifier. */
	readonly id: string;
	/** One-based source line that declared the component. */
	readonly line: number;
	/** Absolute coordinates this declaration's relations resolved to. */
	readonly resolved: SchematicPoint;
	/** The relations as written, in reading order. */
	readonly relations: readonly SchematicPlacementRelation[];
}

/**
 * A declaration whose coordinates are not yet known, handed over by the parser.
 *
 * `component` is the partly built AST node: every field except `x` and `y` is
 * final, and those two are assigned in place once the sort reaches it.
 */
export interface PendingPlacement {
	/** AST node awaiting coordinates. */
	readonly component: SchematicComponent;
	/** Relations parsed from the declaration, in reading order. */
	readonly relations: readonly SchematicPlacementRelation[];
}

/** Round to the three decimals the SVG writer emits, so no float noise reaches it. */
function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/**
 * The reference point or edge a relation measures from.
 *
 * A bare id measures from the referenced body's rectangle, which is what an
 * author means by "to the right of R1" and is orientation-correct without asking
 * about orientation. An `id.port` reference measures from that terminal instead,
 * so `below U1.pin3` lines a part up with a pin rather than with a package.
 */
function referenceGeometry(
	component: SchematicComponent,
	relation: SchematicPlacementRelation
): {
	readonly minX: number;
	readonly maxX: number;
	readonly minY: number;
	readonly maxY: number;
	readonly originX: number;
	readonly originY: number;
} {
	if (relation.port === undefined) {
		const rectangle = componentRectangle(component);
		return { ...rectangle, originX: component.x, originY: component.y };
	}
	/* Safe unvalidated: the reference pass below rejects a terminal that does not
	   exist before any relation is evaluated, so every port reaching here resolves. */
	const point = resolvePortPoint(component, relation.port);
	return {
		minX: point.x,
		maxX: point.x,
		minY: point.y,
		maxY: point.y,
		originX: point.x,
		originY: point.y
	};
}

/**
 * Apply one relation to a running position.
 *
 * Directions place the subject's *edge* against the reference's edge with the
 * gap between them, which is why the subject's own extents are needed: they are
 * measured once at the origin by the caller and passed in, since they do not
 * depend on where the subject ends up.
 */
function applyRelation(
	position: SchematicPoint,
	relation: SchematicPlacementRelation,
	reference: ReturnType<typeof referenceGeometry>,
	selfAtOrigin: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }
): SchematicPoint {
	const gap =
		relation.gap ??
		(relation.kind === 'right-of' || relation.kind === 'left-of'
			? PLACEMENT_HORIZONTAL_GAP
			: PLACEMENT_VERTICAL_GAP);
	switch (relation.kind) {
		case 'right-of':
			return { x: reference.maxX + gap - selfAtOrigin.minX, y: position.y };
		case 'left-of':
			return { x: reference.minX - gap - selfAtOrigin.maxX, y: position.y };
		case 'below':
			return { x: position.x, y: reference.maxY + gap - selfAtOrigin.minY };
		case 'above':
			return { x: position.x, y: reference.minY - gap - selfAtOrigin.maxY };
		case 'aligned-x':
			return { x: reference.originX, y: position.y };
		/* v8 ignore next -- the parser admits no seventh kind; this is the pair to aligned-x. */
		default:
			return { x: position.x, y: reference.originY };
	}
}

/**
 * Report a cycle as the path an author can actually follow.
 *
 * Walking from the lowest unresolved line and following the first still-pending
 * reference at each step reaches a repeat, and the segment from that repeat
 * onward is a genuine cycle. Naming its members beats "a cycle exists", which is
 * the class of diagnostic this compiler has spent several releases removing.
 */
function describeCycle(
	start: string,
	pendingById: ReadonlyMap<string, PendingPlacement>,
	resolved: ReadonlySet<string>
): string[] {
	const path: string[] = [];
	const seen = new Set<string>();
	/*
	 * The walk is total by construction, which is why there is no exit for running
	 * out of references. `start` is stuck, so it has at least one reference that is
	 * pending and unresolved; the same is true of whatever that reference is, or it
	 * would have resolved. Every step therefore has a successor, the id space is
	 * finite, and the loop can only end by revisiting a node.
	 */
	let cursor = start;
	while (!seen.has(cursor)) {
		seen.add(cursor);
		path.push(cursor);
		cursor = pendingById
			.get(cursor)!
			.relations.find(
				(relation) => pendingById.has(relation.ref) && !resolved.has(relation.ref)
			)!.ref;
	}
	return [...path.slice(path.indexOf(cursor)), cursor];
}

/**
 * Lower every relative declaration to absolute coordinates.
 *
 * Coordinates are assigned onto the supplied AST nodes in place; the parser
 * validates them against the fence afterwards, so an unsatisfiable relation
 * reaches the same out-of-bounds diagnostic a bad `at (x, y)` would.
 *
 * @param components - Every component in the document, in source order.
 * @param pending - The subset awaiting coordinates, in source order.
 * @param placementDepth - Longest reference chain permitted.
 * @returns One record per resolved declaration, in source order.
 * @throws {SchematicSyntaxError} For an undeclared or self reference, a cycle, a
 *   negative gap, a terminal that does not exist, or a chain past the budget.
 */
export function resolvePlacements(
	components: readonly SchematicComponent[],
	pending: readonly PendingPlacement[],
	placementDepth: number
): readonly SchematicPlacement[] {
	const byId = new Map(components.map((component) => [component.id, component]));
	const pendingById = new Map(pending.map((entry) => [entry.component.id, entry]));

	/*
	 * Validate and canonicalize every reference before resolving any of them, so a
	 * typo is reported against the line that contains it rather than surfacing
	 * later as a phantom cycle, and so the terminal diagnostic has exactly one
	 * home. Port aliases are folded to the terminal the compiler uses for the same
	 * reason connection endpoints are: `R1.r` and `R1.out` are one lead, and a
	 * reported relation that echoed the author's spelling would disagree with the
	 * netlist about what it anchored to.
	 */
	const normalized = new Map<string, readonly SchematicPlacementRelation[]>();
	for (const entry of pending) {
		const { component, relations } = entry;
		const canonical: SchematicPlacementRelation[] = [];
		for (const relation of relations) {
			if (relation.gap !== undefined && relation.gap < 0) {
				throw new SchematicSyntaxError(
					`${component.id} states a negative by distance of ${relation.gap}. Distances are unsigned; use the opposite direction instead.`,
					component.line
				);
			}
			if (relation.ref === component.id) {
				throw new SchematicSyntaxError(
					`${component.id} is placed relative to itself. Reference another declaration, or place it with at (x, y).`,
					component.line
				);
			}
			const reference = byId.get(relation.ref);
			if (reference === undefined) {
				/* Declaration order is deliberately not the fix: the sort resolves a
				   forward reference, so the advice is to declare the target at all. */
				throw new SchematicSyntaxError(
					`${component.id} is placed relative to ${relation.ref}, which the document never declares. Declare ${relation.ref} anywhere in the document, or place ${component.id} with at (x, y).`,
					component.line
				);
			}
			if (relation.port === undefined) {
				canonical.push(relation);
				continue;
			}
			let port: string;
			try {
				port = canonicalPortName(reference, relation.port);
				resolvePortPoint(reference, port);
			} catch {
				/* Both throw a bare Error for a terminal that does not exist, because
				   every other caller validated the endpoint first. A placement
				   reference is the one path that reaches them unvalidated. */
				throw new SchematicSyntaxError(
					`${relation.ref} has no terminal named ${relation.port}, so ${component.id} cannot be placed against it. Reference ${relation.ref} itself, or name a terminal it declares.`,
					component.line
				);
			}
			canonical.push({ ...relation, port });
		}
		normalized.set(component.id, canonical);
	}

	/* Kahn, seeded in source order. Only references that are themselves pending
	   constrain the order; a reference to an absolute declaration is already
	   satisfied and contributes no edge. */
	const blocking = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	for (const entry of pending) {
		const unresolvedRefs = new Set(
			normalized
				.get(entry.component.id)!
				.map((relation) => relation.ref)
				.filter((ref) => pendingById.has(ref))
		);
		blocking.set(entry.component.id, unresolvedRefs.size);
		for (const ref of unresolvedRefs) {
			const list = dependents.get(ref) ?? [];
			list.push(entry.component.id);
			dependents.set(ref, list);
		}
	}

	const ready = pending
		.filter((entry) => blocking.get(entry.component.id) === 0)
		.map((entry) => entry.component.id);
	const depth = new Map<string, number>();
	const resolved = new Set<string>();
	const placements: SchematicPlacement[] = [];

	for (let cursor = 0; cursor < ready.length; cursor += 1) {
		const id = ready[cursor]!;
		const entry = pendingById.get(id)!;
		const component = entry.component;

		/* Extents are measured at the origin because they do not depend on where
		   the component lands, and asking for them after positioning would make
		   the arithmetic circular. UML port hotspots make them asymmetric, so the
		   two edges are carried separately rather than as one half-width. */
		const atOrigin = componentRectangle({ ...component, x: 0, y: 0 } as SchematicComponent);

		const relations = normalized.get(id)!;
		/*
		 * The first reference seeds both axes, so an axis no relation constrains
		 * inherits it. `right-of A` therefore means what an author reading it means —
		 * beside A, level with A — instead of sliding the part to y=0 and usually
		 * failing the bounds check. An explicit `aligned-y with B` still overrides,
		 * because relations are applied after the seed and in reading order.
		 */
		const seed = referenceGeometry(byId.get(relations[0]!.ref)!, relations[0]!);
		let position: SchematicPoint = { x: seed.originX, y: seed.originY };
		let chain = 0;
		for (const relation of relations) {
			const reference = byId.get(relation.ref)!;
			position = applyRelation(
				position,
				relation,
				referenceGeometry(reference, relation),
				atOrigin
			);
			chain = Math.max(chain, (depth.get(relation.ref) ?? 0) + 1);
		}
		if (chain > placementDepth) {
			throw new SchematicSyntaxError(
				`${component.id} sits ${chain} placements deep, past the ${placementDepth.toLocaleString('en-US')} chain budget. Anchor one component in the chain with at (x, y).`,
				component.line
			);
		}
		depth.set(id, chain);

		component.x = round(position.x);
		component.y = round(position.y);
		resolved.add(id);
		placements.push({
			id,
			line: component.line,
			resolved: { x: component.x, y: component.y },
			relations
		});

		for (const dependent of dependents.get(id) ?? []) {
			const remaining = blocking.get(dependent)! - 1;
			blocking.set(dependent, remaining);
			if (remaining === 0) ready.push(dependent);
		}
	}

	if (resolved.size !== pending.length) {
		const stuck = pending.find((entry) => !resolved.has(entry.component.id))!;
		const cycle = describeCycle(stuck.component.id, pendingById, resolved);
		throw new SchematicSyntaxError(
			`Placement cycle: ${cycle.join(' -> ')}. One component in a cycle must be placed with at (x, y).`,
			stuck.component.line
		);
	}

	/* Evaluation order cannot reach the coordinates, but it can reach this array,
	   so it is sorted by the only order an author can predict. */
	return placements.sort((left, right) => left.line - right.line);
}
