/**
 * Compiler budgets shared by the parser and renderer.
 *
 * `parseSchematic` and `renderSchematic` enforce these for one diagram. Each
 * value here is a default a caller may tighten per compilation; see
 * {@link SchematicLimitOptions}.
 *
 * @packageDocumentation
 */
import { SchematicSyntaxError, type SchematicBounds } from './types.js';
/**
 * Smallest canvas a fence may declare, in viewBox units.
 *
 * A component's own body and label rows are tens of units across, so anything
 * smaller cannot hold one.
 */
export const MIN_SCHEMATIC_BOUND = 64;
/**
 * Largest canvas a fence may declare, in viewBox units.
 *
 * This is a memory guard, not a diagram budget: it is three orders of magnitude
 * past what any readable drawing needs, and a canvas this size would hold tens
 * of millions of components long before a host could allocate the markup. It
 * exists so the routing hash's cell keys stay exact doubles.
 */
export const MAX_SCHEMATIC_BOUND = 1_048_576;
/**
 * Maximum UTF-16 source characters accepted in one compilation pass.
 *
 * Sized so the declaration count is never what stops a document — sixteen
 * million characters is roughly half a million component declarations.
 */
export const MAX_SCHEMATIC_SOURCE_CHARACTERS = 16_777_216;
/** Maximum rendered orthogonal intersections before the crossing pass aborts. */
export const MAX_SCHEMATIC_WIRE_CROSSINGS = 32_768;
/**
 * Longest chain of relative placements resolved in one document.
 *
 * A component placed relative to a component placed relative to a component is
 * two deep. Sixty-four is past any diagram a person reads while staying far short
 * of a chain built to make the resolver work: the pass is linear, so this bounds
 * how much a hostile document can ask of it, not how much a real one may.
 */
export const MAX_SCHEMATIC_PLACEMENT_DEPTH = 64;
/**
 * Maximum routing passes over one document before contention is fatal.
 *
 * The first pass is the greedy source-order route; each additional pass reorders
 * by criticality, promotes the trace that failed, and retries. Twelve is chosen by
 * measurement with headroom: the widest reversal bus this router can route at all
 * is twelve wires, and it settles in seven passes.
 *
 * The cost is paid only by documents that fail a pass, and a document that is
 * genuinely unroutable pays it in full before raising the diagnostic — so a host
 * compiling untrusted source should keep this low and pair it with a timeout, as
 * the resource-budget guidance already advises. `1` disables retries exactly,
 * restoring pre-0.5 routing behaviour.
 */
export const MAX_SCHEMATIC_ROUTING_ATTEMPTS = 12;
/** Maximum UTF-8 bytes the bounded SVG writer may emit. */
export const MAX_SCHEMATIC_SVG_OUTPUT_BYTES = 268_435_456;

/**
 * Validate one canvas and return it as a fresh, data-only record.
 *
 * The fence parser, the runtime parser boundary and the renderer each need this
 * and each used to carry its own copy of the condition and the sentence. One
 * copy keeps the three from drifting, and returning the pair rather than
 * asserting on it gives every caller the snapshot it wanted anyway.
 *
 * @param subject - Names the caller in the diagnostic: `Schematic` or `Render`.
 */
export function normalizeSchematicBounds(
	width: unknown,
	height: unknown,
	subject: string
): SchematicBounds {
	if (
		typeof width !== 'number' ||
		!Number.isInteger(width) ||
		typeof height !== 'number' ||
		!Number.isInteger(height) ||
		width < MIN_SCHEMATIC_BOUND ||
		height < MIN_SCHEMATIC_BOUND ||
		width > MAX_SCHEMATIC_BOUND ||
		height > MAX_SCHEMATIC_BOUND
	) {
		throw new SchematicSyntaxError(
			`${subject} bounds must be integers from ${MIN_SCHEMATIC_BOUND} through ${MAX_SCHEMATIC_BOUND.toLocaleString('en-US')}.`
		);
	}
	return { width, height };
}

/** Longest accessible diagram title accepted from a fence or a host. */
const MAX_TITLE_LENGTH = 512;

/**
 * Validate one accessible diagram title.
 *
 * @param subject - Names the caller in the diagnostic: `Schematic` or `Render`.
 */
export function normalizeSchematicTitle(value: unknown, subject: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new SchematicSyntaxError(`${subject} titles cannot be empty.`);
	}
	if (value.length > MAX_TITLE_LENGTH) {
		throw new SchematicSyntaxError(
			`${subject} titles cannot exceed ${MAX_TITLE_LENGTH} characters.`
		);
	}
	return value;
}

/** Every budget resolved to a number, ready to compare against. */
export interface SchematicResolvedLimits {
	/** Maximum component declarations; `Infinity` for no limit. */
	readonly components: number;
	/** Maximum directed connections; `Infinity` for no limit. */
	readonly connections: number;
	/** Maximum UTF-16 source characters read in one pass. */
	readonly sourceCharacters: number;
	/** Maximum orthogonal intersections before the crossing pass gives up. */
	readonly wireCrossings: number;
	/** Maximum UTF-8 bytes of generated markup. */
	readonly svgOutputBytes: number;
	/** Longest relative-placement reference chain; `Infinity` for no limit. */
	readonly placementDepth: number;
	/** Maximum routing passes; `1` disables rip-up retries. */
	readonly routingAttempts: number;
}

/**
 * The budget every compilation starts from.
 *
 * Component and connection counts are unbounded: a document may declare as many
 * of either as it can place. The rest bound allocation, not diagram size — how
 * much text one call reads, how much markup it hands back, and how far the
 * crossing pass goes before giving up — and sit far past any readable drawing.
 */
const LIMIT_DEFAULTS: SchematicResolvedLimits = Object.freeze({
	components: Number.POSITIVE_INFINITY,
	connections: Number.POSITIVE_INFINITY,
	sourceCharacters: MAX_SCHEMATIC_SOURCE_CHARACTERS,
	wireCrossings: MAX_SCHEMATIC_WIRE_CROSSINGS,
	svgOutputBytes: MAX_SCHEMATIC_SVG_OUTPUT_BYTES,
	placementDepth: MAX_SCHEMATIC_PLACEMENT_DEPTH,
	routingAttempts: MAX_SCHEMATIC_ROUTING_ATTEMPTS
});

/** The names a caller may override, derived so the two cannot drift apart. */
const CONFIGURABLE_LIMITS = Object.keys(LIMIT_DEFAULTS);

/**
 * Frozen runtime-readable picture of the compiler's defaults.
 *
 * The two bound values describe the canvas range and are not negotiable,
 * because the routing hash's cell keys stay exact only inside it. Everything
 * else is a default a caller may tighten per compilation through
 * {@link SchematicLimitOptions}.
 */
export const SCHEMATIC_LIMITS = Object.freeze({
	minimumBound: MIN_SCHEMATIC_BOUND,
	maximumBound: MAX_SCHEMATIC_BOUND,
	...LIMIT_DEFAULTS
});

/**
 * Validate a caller's budget and fill every omitted field from the defaults.
 *
 * Resolved once per compilation rather than read where enforced, so a getter
 * that returns one value to the parser and another to the renderer cannot move
 * a ceiling between passes — the same defence `normalizeParserFence` applies to
 * bounds and title.
 *
 * `Infinity` is accepted and means no limit, which is also what an omitted
 * field resolves to for the two counts. Accepting it keeps the function
 * idempotent, so a resolved budget can be handed back in without being
 * mistaken for a malformed one.
 *
 * @param value - Caller-supplied {@link SchematicLimitOptions}, or `undefined`.
 * @returns Defaults, overridden by whichever fields were supplied.
 * @throws {SchematicSyntaxError} For a non-object budget, or a field that is
 *   not a positive integer or `Infinity`.
 */
export function resolveSchematicLimits(value: unknown): SchematicResolvedLimits {
	if (value === undefined) return LIMIT_DEFAULTS;
	if (typeof value !== 'object' || value === null) {
		throw new SchematicSyntaxError('Compiler limits must be an object.');
	}
	const supplied = value as Record<string, unknown>;
	for (const name of Object.keys(supplied)) {
		/* A budget is a safety control, so a misspelled field must fail loudly
		   rather than leave a host believing it set a ceiling it did not. */
		if (!CONFIGURABLE_LIMITS.includes(name)) {
			throw new SchematicSyntaxError(`Unknown compiler limit ${name}.`);
		}
	}
	const resolved = { ...LIMIT_DEFAULTS } as Record<string, number> & SchematicResolvedLimits;
	for (const name of CONFIGURABLE_LIMITS) {
		const limit = supplied[name];
		if (limit === undefined) continue;
		if (
			typeof limit !== 'number' ||
			limit < 1 ||
			!(Number.isInteger(limit) || limit === Number.POSITIVE_INFINITY)
		) {
			throw new SchematicSyntaxError(
				`Compiler limit ${name} must be a positive integer or Infinity.`
			);
		}
		resolved[name] = limit;
	}
	return resolved;
}
