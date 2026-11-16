/**
 * Bounded, dependency-free SVG serializer for validated `schemd` documents.
 *
 * The renderer accepts only parser-provenanced immutable ASTs, performs no DOM
 * measurement, and writes through a UTF-8 byte-budgeted sink. Output modes share
 * identical geometry while progressively adding embedded styles and delegated
 * interaction attributes.
 *
 * @packageDocumentation
 */
import { fmt, toMilli } from './geom.js';
import {
	componentTextAnchors,
	connectionLabelPoint,
	formatNumber as svgNumber,
	isDigitalComponent,
	isQuantumSpecial,
	isUmlComponent,
	PORT_HOTSPOT_RADIUS,
	routeConnections,
	validateSchematicGeometry,
	type RoutedConnection
} from './layout.js';
import {
	MAX_SCHEMATIC_SVG_OUTPUT_BYTES,
	normalizeSchematicCanvas,
	normalizeSchematicTitle,
	resolveSchematicLimits,
	type SchematicResolvedLimits
} from './limits.js';
import { assertParsedSchematicDocument } from './parser.js';
import { parsedSchematicRoutes, parsedSchematicSheet } from './route-cache.js';
import { colorAttributes, TEXT_PAINT } from './symbols/common.js';
import { definition, placedPorts, turnOf } from './symbols/index.js';
import {
	QUANTUM_GATE_KINDS,
	SCHEMD_OUTPUT_MODES,
	SCHEMD_SEMANTIC_HOOKS,
	SchematicSyntaxError,
	type CompileSchematicOptions,
	type QuantumGateComponent,
	type SchematicColor,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicPoint,
	type SchematicSemanticHook,
	type SchematicSignalMarker,
	type SchemdOutputMode,
	type SchematicSheet
} from './types.js';
import { MATH_LABEL_FONT_FAMILY, mathLabelText, renderMathLabelTspans } from './math-label.js';
import { escapeXml } from './xml.js';

/**
 * Legacy alias for the hard SVG allocation ceiling.
 *
 * @deprecated Prefer the root-exported `MAX_SCHEMATIC_SVG_OUTPUT_BYTES`.
 */
export const MAX_SVG_OUTPUT_BYTES = MAX_SCHEMATIC_SVG_OUTPUT_BYTES;

/** Minimal theme-aware vector styles embedded by non-default output modes. */
const STATIC_SVG_STYLES =
	'.schematic-token{fill:none;stroke:var(--schematic-vector,var(--schematic-vector-fallback,currentColor));stroke-linecap:round;stroke-linejoin:round;stroke-width:var(--schematic-stroke-width,1.65);vector-effect:non-scaling-stroke}.schematic-marker-carrier{stroke-width:0!important}.schematic-node-fill{fill:var(--schematic-vector,var(--schematic-vector-fallback,currentColor))}.schematic-designator,.schematic-label,.schematic-gate-symbol,.schematic-quantum-detail,.schematic-pin-label,.schematic-uml-text,.schematic-connection-label{fill:currentColor}.schematic-designator,.schematic-label{stroke:none;text-anchor:middle;font-size:12px}.schematic-uml-row{font-size:12px}.schematic-uml-stereotype{font-size:11px}.schematic-connection-label{font-size:11px;paint-order:stroke;stroke:var(--schematic-surface,#fff);stroke-width:4;stroke-linejoin:round}.schematic-surface{fill:var(--schematic-surface,transparent)}.schematic-grid-line{fill:none;stroke:var(--schematic-grid,currentColor);stroke-width:1;opacity:.12;vector-effect:non-scaling-stroke}';

/** Keyboard and pointer hotspot rules emitted only by `full` mode. */
const HOOK_SVG_STYLES =
	'.schematic-port-hotspot{fill:transparent!important;stroke:transparent!important;stroke-width:8;vector-effect:non-scaling-stroke;pointer-events:all;outline:none}.schematic-port-hotspot:focus-visible{fill:var(--schematic-vector,var(--schematic-vector-fallback,currentColor))!important;fill-opacity:.22!important;stroke:var(--schematic-vector,var(--schematic-vector-fallback,currentColor))!important;stroke-width:2}';

/** Hover, focus, state-class, glow, and reduced-motion rules for styled modes. */
const INTERACTIVE_SVG_STYLES =
	'.schematic-component,.schematic-wire{outline:none;transition:opacity .2s ease,filter .2s ease}.schematic-component .schematic-token,.schematic-wire .schematic-token{transition:stroke .2s ease,fill .2s ease,color .2s ease,opacity .2s ease,stroke-width .2s ease}.schematic-glow-layer{opacity:0;pointer-events:none;transition:opacity .2s ease}.schematic-component:hover>.schematic-glow-layer,.schematic-component:focus>.schematic-glow-layer,.schematic-component:focus-within>.schematic-glow-layer,.schematic-component.is-hovered>.schematic-glow-layer,.schematic-component.is-active>.schematic-glow-layer,.schematic-component.is-selected>.schematic-glow-layer,.schematic-wire:hover>.schematic-glow-layer,.schematic-wire:focus>.schematic-glow-layer,.schematic-wire.is-hovered>.schematic-glow-layer,.schematic-wire.is-active>.schematic-glow-layer,.schematic-wire.is-selected>.schematic-glow-layer{opacity:1}.schematic-component.is-degraded,.schematic-wire.is-degraded{opacity:.45}.schematic-component.is-degraded>.schematic-glow-layer,.schematic-wire.is-degraded>.schematic-glow-layer{opacity:0}.schematic-component:hover .schematic-token,.schematic-component:focus .schematic-token,.schematic-component:focus-within .schematic-token,.schematic-component.is-hovered .schematic-token,.schematic-component.is-active .schematic-token,.schematic-component.is-selected .schematic-token,.schematic-wire:hover .schematic-token,.schematic-wire:focus .schematic-token,.schematic-wire.is-hovered .schematic-token,.schematic-wire.is-active .schematic-token,.schematic-wire.is-selected .schematic-token{stroke-width:var(--schematic-interactive-stroke-width,2.25)}.schematic-port-hotspot{fill:var(--schematic-vector,var(--schematic-vector-fallback,currentColor))!important;fill-opacity:0;transition:fill-opacity .2s ease,opacity .2s ease}.schematic-port-hotspot:hover,.schematic-port-hotspot:focus,.schematic-port-hotspot.is-hovered,.schematic-port-hotspot.is-active,.schematic-port-hotspot.is-selected{fill-opacity:.2}.schematic-port-hotspot.is-degraded{opacity:.45}@media(prefers-reduced-motion:reduce){.schematic-component,.schematic-wire,.schematic-token,.schematic-glow-layer,.schematic-port-hotspot{transition:none}}';

/** Fully validated renderer options with required normalized defaults. */
interface NormalizedCompileOptions extends CompileSchematicOptions {
	/** Integer intrinsic canvas dimensions, or `'auto'` for a measured sheet. */
	bounds: { width: number; height: number } | 'auto';
	/** Non-empty accessible diagram title. */
	title: string;
	/** Explicit output-budget mode. */
	mode: SchemdOutputMode;
	/** Constant-time full-mode hook lookup. */
	semanticHookMask: number;
	/** Budget resolved once, so no pass re-reads a caller's getters. */
	limits: SchematicResolvedLimits;
}


/** Shared geometry of the designator/label pair every component emits. */
const TEXT_LABEL_GEOMETRY = 'text-anchor="middle" font-size="12"';

const NODE_HOOK = 1;
const PORT_HOOK = 2;
const WIRE_HOOK = 4;

function semanticHookBit(hook: SchematicSemanticHook): number {
	if (hook === 'nodes') return NODE_HOOK;
	if (hook === 'ports') return PORT_HOOK;
	return WIRE_HOOK;
}

/** Largest number of UTF-8 bytes one UTF-16 code unit can encode to. */
const MAX_UTF8_BYTES_PER_CODE_UNIT = 3;

/** Smallest buffer a writer allocates, so short documents make one allocation. */
const INITIAL_WRITER_CAPACITY = 1024;

/** Shared encoder. `encodeInto` is re-entrant, so one instance serves every writer. */
const SVG_ENCODER = new TextEncoder();

/** Shared decoder, used exactly once per completed document. */
const SVG_DECODER = new TextDecoder();

/**
 * Append-only SVG sink that enforces the compiler's UTF-8 output ceiling.
 *
 * Fragments are encoded straight into one growable buffer, so measuring a
 * chunk's cost and storing it are the same operation. The previous
 * implementation counted bytes with a hand-written scan over every code unit
 * and then stored the chunk again as a string: on a 512-component document that
 * scan alone measured 1.23 ms of a 6.29 ms render — 20% — for an answer
 * `encodeInto` returns as a side effect of work already being done.
 *
 * Two properties are preserved exactly, because both are load-bearing:
 *
 * - **The budget is exact.** `encodeInto` reports how much it consumed, so a
 *   chunk that does not fit entirely is detected rather than silently truncated.
 * - **A rejected append commits nothing.** The cursor advances only after the
 *   budget check passes, so bytes written past it are unreachable scratch. This
 *   is the atomicity 0.3.2 fixed, and it is now structural rather than
 *   maintained by ordering.
 */
export class BoundedSvgWriter {
	/** Encoded output. Bytes at or past `#at` are scratch and never read. */
	#buffer: Uint8Array;
	/** Committed UTF-8 byte count, and the write cursor. */
	#at = 0;
	/** Ceiling this writer enforces, in UTF-8 bytes. */
	readonly #limit: number;

	/**
	 * @param limitBytes - Output ceiling. The default is the compiler's own, and
	 *   is large enough that a caller reaches it only by generating markup no
	 *   host could hold; a smaller one lets the boundary be exercised without
	 *   allocating it.
	 */
	constructor(limitBytes: number = MAX_SCHEMATIC_SVG_OUTPUT_BYTES) {
		this.#limit = limitBytes;
		this.#buffer = new Uint8Array(Math.min(INITIAL_WRITER_CAPACITY, Math.max(limitBytes, 0) + 1));
	}

	/**
	 * Grow the buffer to hold at least `required` bytes, preserving what is committed.
	 *
	 * @param required - Total capacity the next write needs.
	 */
	#reserve(required: number): void {
		if (required <= this.#buffer.length) return;
		let capacity = Math.max(this.#buffer.length, INITIAL_WRITER_CAPACITY);
		while (capacity < required) capacity *= 2;
		const grown = new Uint8Array(capacity);
		grown.set(this.#buffer.subarray(0, this.#at));
		this.#buffer = grown;
	}

	/** The one diagnostic this writer produces, worded exactly as it always was. */
	#overBudget(): SchematicSyntaxError {
		return new SchematicSyntaxError(
			`Compiled SVG exceeds the ${this.#limit.toLocaleString('en-US')} byte output limit.`
		);
	}

	/**
	 * Add one trusted SVG fragment within the hard output budget.
	 *
	 * @param chunk - Compiler-generated markup fragment.
	 * @throws {SchematicSyntaxError} When the aggregate UTF-8 size exceeds the limit.
	 */
	append(chunk: string): void {
		if (chunk === '') return;
		const remaining = this.#limit - this.#at;
		if (remaining <= 0) throw this.#overBudget();
		/*
		 * Never reserve more than one byte past what the budget can accept. A
		 * chunk whose upper bound overshoots the ceiling cannot be legal however
		 * it encodes, and the extra byte is what makes an overshoot observable:
		 * `encodeInto` stopping short means the chunk needed room the budget does
		 * not have. Without the cap, a hostile document could make the writer
		 * allocate three bytes per code unit far beyond its own output ceiling.
		 */
		const room = Math.min(chunk.length * MAX_UTF8_BYTES_PER_CODE_UNIT, remaining + 1);
		this.#reserve(this.#at + room);
		const { read, written } = SVG_ENCODER.encodeInto(
			chunk,
			this.#buffer.subarray(this.#at, this.#at + room)
		);
		if (read < chunk.length || written > remaining) throw this.#overBudget();
		this.#at += written;
	}

	/**
	 * Decode all accepted fragments into the final SVG figure.
	 *
	 * @returns Complete trusted markup in append order.
	 */
	finish(): string {
		return SVG_DECODER.decode(this.#buffer.subarray(0, this.#at));
	}

	/**
	 * Exact UTF-8 size of what has been accepted.
	 *
	 * The compiler reports this in `metrics`, and previously recomputed it by
	 * scanning the finished document a second time. The writer already knows.
	 */
	get byteLength(): number {
		return this.#at;
	}
}

/**
 * Validate an untrusted renderer-options boundary and apply output-mode defaults.
 *
 * Runtime checks intentionally duplicate TypeScript contracts because JavaScript
 * consumers can call the published package without static typing.
 *
 * @param value - Candidate options supplied by a package consumer.
 * @returns Structurally validated options with an explicit mode.
 * @throws {SchematicSyntaxError} For malformed bounds, title, ID prefix, or mode.
 */
function normalizeCompileOptions(value: unknown): NormalizedCompileOptions {
	if (typeof value !== 'object' || value === null) {
		throw new SchematicSyntaxError('Render options must be an object.');
	}
	const candidate = value as Record<string, unknown>;
	const bounds = normalizeSchematicCanvas(candidate.bounds, 'Render');
	const title = normalizeSchematicTitle(candidate.title, 'Render');
	const idPrefix = candidate.idPrefix;
	if (idPrefix !== undefined && (typeof idPrefix !== 'string' || idPrefix.length > 128)) {
		throw new SchematicSyntaxError('Render idPrefix must be a string of at most 128 characters.');
	}
	const mode = candidate.mode;
	if (
		mode !== undefined &&
		(typeof mode !== 'string' || !SCHEMD_OUTPUT_MODES.includes(mode as SchemdOutputMode))
	) {
		throw new SchematicSyntaxError('Render mode must be one of: default, embedded-css, or full.');
	}
	const normalizedMode = (mode ?? 'default') as SchemdOutputMode;
	const rawSemanticHooks = candidate.semanticHooks;
	let semanticHookMask = NODE_HOOK | PORT_HOOK | WIRE_HOOK;
	if (rawSemanticHooks !== undefined) {
		if (!Array.isArray(rawSemanticHooks)) {
			throw new SchematicSyntaxError('Render semanticHooks must be an array.');
		}
		semanticHookMask = 0;
		for (const hook of rawSemanticHooks) {
			if (
				typeof hook !== 'string' ||
				!SCHEMD_SEMANTIC_HOOKS.includes(hook as SchematicSemanticHook)
			) {
				throw new SchematicSyntaxError(
					'Render semanticHooks may contain only: nodes, ports, or wires.'
				);
			}
			semanticHookMask |= semanticHookBit(hook as SchematicSemanticHook);
		}
	}
	const limits = resolveSchematicLimits(candidate.limits);
	return idPrefix === undefined
		? { bounds, title, mode: normalizedMode, semanticHookMask, limits }
		: { bounds, title, idPrefix, mode: normalizedMode, semanticHookMask, limits };
}

/**
 * Compute a stable compact FNV-1a-style identifier suffix.
 *
 * This is a deterministic namespace helper, not a cryptographic hash.
 */
function stableHash(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

/** Resolve parser-validated quarter turns to compact SVG degrees. */
function componentRotation(component: SchematicComponent): number {
	return turnOf(component) * 90;
}

/** Vectors for any kind, from its registry entry. */
function componentShape(
	component: SchematicComponent,
	paint = colorAttributes(component.color),
	nodePaint = colorAttributes(component.color, 'schematic-node-fill')
): string {
	return definition(component).draw(component, paint, nodePaint);
}

/** Upright glyphs drawn after the rotated vectors. */
function componentInnerText(component: SchematicComponent): string {
	return definition(component).inner?.(component) ?? '';
}

/** Key under which identical geometry is shared through `<use>`. */
function reusableSymbolKey(component: SchematicComponent): string | undefined {
	const symbol = definition(component).symbol;
	return symbol === undefined ? undefined : symbol(component);
}

/** One reusable symbol definition. */
function reusableSymbolDefinition(component: SchematicComponent, symbolId: string): string {
	const vectorPaint =
		'class="schematic-token" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--schematic-vector,currentColor)"';
	const nodePaint = `class="schematic-token schematic-node-fill" ${TEXT_PAINT} style="fill:var(--schematic-vector,currentColor)"`;
	return `<g id="${symbolId}">${componentShape(component, vectorPaint, nodePaint)}</g>`;
}

/**
 * Render a single fully interactive connection group.
 *
 * @param connection - Source AST connection.
 * @param routed - Precomputed path and endpoints.
 * @param index - Source-order connection index.
 * @param idPrefix - Namespaced SVG definition prefix.
 * @param glowId - Diagram-local glow filter ID.
 * @returns Full-mode group with data attributes, accessibility, vector, glow, and endpoint.
 */
function connectionMarkup(
	connection: SchematicConnection,
	routed: RoutedConnection,
	index: number,
	idPrefix: string,
	glowId: string
): string {
	const end = routed.points.at(-1)!;
	const source = escapeXml(`${connection.from.componentId}.${connection.from.port}`);
	const target = escapeXml(`${connection.to.componentId}.${connection.to.port}`);
	const traceId = `${idPrefix}-wire-${index}-vector`;
	const signalKind = connection.signalKind ?? 'electrical';
	const signalClass = connection.signalKind === undefined ? '' : ` schematic-signal--${signalKind}`;
	const dataAttributes = ` data-wire-source="${source}" data-wire-target="${target}" data-source-line="${connection.line}"${connection.netId === undefined ? '' : ` data-net-id="${escapeXml(connection.netId)}"`}${connection.signalKind === undefined ? '' : ` data-signal-kind="${signalKind}"`}${connection.width === undefined ? '' : ` data-bus-width="${connection.width}"`}${connection.trunk === undefined ? '' : ` data-wire-trunk="${connection.trunk}"`}`;
	/* v8 ignore next -- parsed documents always materialize relation; fallback preserves old typed ASTs. */
	const relation = connection.relation ?? 'signal';
	const accessibility = ` tabindex="0" role="group" aria-label="${escapeXml(relation)} from ${source} to ${target}"`;
	const vectorId = ` id="${traceId}"`;
	const markerAttributes = connectionMarkerAttributes(connection, idPrefix, false);
	const markerCarrier = openMarkerCarrier(connection, routed, idPrefix);
	const glow = `<use class="schematic-glow-layer" href="#${traceId}" filter="url(#${glowId})" aria-hidden="true" pointer-events="none" />`;
	const endpoint =
		relation === 'signal' && connection.markerEnd === 'none'
			? `<circle ${colorAttributes(connection.color, 'schematic-node-fill')} cx="${svgNumber(end.x)}" cy="${svgNumber(end.y)}" r="3" />`
			: '';
	const junction = [...(routed.junction === undefined ? [] : [routed.junction]), ...(routed.joins ?? [])]
		.map((point) => `<circle ${colorAttributes(connection.color, 'schematic-node-fill schematic-junction')} cx="${svgNumber(point.x)}" cy="${svgNumber(point.y)}" r="3" />`)
		.join('');
	return `<g class="schematic-wire${signalClass}"${dataAttributes}${accessibility}>${markerCarrier}<path${vectorId} ${colorAttributes(connection.color, `schematic-trace${signalClass}`)} d="${visibleConnectionPath(connection, routed)}"${markerAttributes} />${glow}${endpoint}${junction}${connectionLabelMarkup(connection, routed)}</g>`;
}

/**
 * Serialize optional start and end marker URL attributes.
 *
 * @param connection - Connection marker configuration.
 * @param idPrefix - Diagram-local marker namespace.
 * @returns Zero, one, or two SVG marker attributes.
 */
function isOpenMarker(marker: SchematicSignalMarker): boolean {
	return marker === 'open-arrow' || marker === 'triangle' || marker === 'diamond';
}


function connectionMarkerAttributes(
	connection: SchematicConnection,
	idPrefix: string,
	open: boolean
): string {
	const start = isOpenMarker(connection.markerStart) === open ? connection.markerStart : 'none';
	const end = isOpenMarker(connection.markerEnd) === open ? connection.markerEnd : 'none';
	return `${start === 'none' ? '' : ` marker-start="url(#${idPrefix}-marker-${start})"`}${end === 'none' ? '' : ` marker-end="url(#${idPrefix}-marker-${end})"`}${!open && connection.dashed === true ? ' stroke-dasharray="7 5"' : ''}`;
}

/** Trim the visible trace beneath background-independent open markers. */
function visibleConnectionPath(connection: SchematicConnection, route: RoutedConnection): string {
	const startTrim = isOpenMarker(connection.markerStart)
		? connection.markerStart === 'open-arrow'
			? 9
			: 12
		: 0;
	const endTrim = isOpenMarker(connection.markerEnd)
		? connection.markerEnd === 'open-arrow'
			? 9
			: 12
		: 0;
	if (startTrim === 0 && endTrim === 0) return route.d;
	const inset = (endpoint: SchematicPoint, adjacent: SchematicPoint, distance: number) => {
		const dx = adjacent.x - endpoint.x;
		const dy = adjacent.y - endpoint.y;
		const magnitude = Math.hypot(dx, dy);
		const scale = Math.min(1, distance / magnitude);
		return { x: endpoint.x + dx * scale, y: endpoint.y + dy * scale };
	};
	let path = route.d;
	if (startTrim > 0) {
		const start = inset(route.points[0]!, route.points[1]!, startTrim);
		path = path.replace(/^M -?[\d.]+ -?[\d.]+/, `M ${svgNumber(start.x)} ${svgNumber(start.y)}`);
	}
	if (endTrim > 0) {
		const end = inset(route.points.at(-1)!, route.points.at(-2)!, endTrim);
		if (/ H -?[\d.]+$/.test(path)) path = path.replace(/-?[\d.]+$/, svgNumber(end.x));
		else if (/ V -?[\d.]+$/.test(path)) path = path.replace(/-?[\d.]+$/, svgNumber(end.y));
		else path = path.replace(/-?[\d.]+ -?[\d.]+$/, `${svgNumber(end.x)} ${svgNumber(end.y)}`);
	}
	return path;
}

function openMarkerCarrier(
	connection: SchematicConnection,
	route: RoutedConnection,
	idPrefix: string
): string {
	const markers = connectionMarkerAttributes(connection, idPrefix, true);
	return markers === ''
		? ''
		: `<path ${colorAttributes(connection.color, 'schematic-marker-carrier')} d="${route.d}" stroke-width="0"${markers} />`;
}

/** Render an optional UML or signal connector label with an opaque text halo. */
function connectionLabelMarkup(
	connection: SchematicConnection,
	route: RoutedConnection
): string {
	if (connection.label === undefined) return '';
	const point = connectionLabelPoint(route);
	return `<text class="schematic-connection-label" ${TEXT_PAINT} x="${svgNumber(point.x)}" y="${svgNumber(point.y - 7)}" text-anchor="middle" font-size="11">${renderMathLabelTspans(connection.label)}</text>`;
}

/**
 * Create a collision-free batching key for one sanitized color.
 *
 * @param color - Parsed color record.
 * @returns Kind-qualified stable string key.
 */
function colorKey(color: SchematicColor): string {
	return `${color.kind}:${color.value}`;
}

/**
 * Compound compatible non-interactive connection paths to minimize SVG DOM nodes.
 *
 * Connections batch only when both color and marker attributes match. Styled
 * output adds one focusable group and glow clone per batch; default mode emits
 * only the compound trace and endpoint paths.
 *
 * @param connections - Source connections in route order.
 * @param routes - Precomputed routes aligned by index.
 * @param idPrefix - Diagram-local definition prefix.
 * @param embedVisuals - Whether to add responsive visual hooks and glow clones.
 * @param glowId - Diagram-local glow filter identifier.
 * @returns Compacted SVG connection markup.
 */
function compactConnectionMarkup(
	connections: readonly SchematicConnection[],
	routes: readonly RoutedConnection[],
	idPrefix: string,
	embedVisuals: boolean,
	glowId: string
): string {
	/** One path-compounding bucket sharing identical paint and marker attributes. */
	interface Batch {
		/** Sanitized paint shared by every trace in the bucket. */
		readonly color: SchematicColor;
		/** Serialized marker attributes shared by every trace. */
		readonly markerAttributes: string;
		readonly signalKind: string;
		/** Individual path-data subpaths to compound. */
		traces: string[];
		/** Circular endpoint subpaths aligned with the traces. */
		endpoints: string[];
		/** Individually positioned connector labels. */
		labels: string[];
		/** Zero-width paths that place background-independent open markers. */
		carriers: string[];
	}
	const batches = new Map<string, Batch>();
	for (const [index, connection] of connections.entries()) {
		const markerAttributes = connectionMarkerAttributes(connection, idPrefix, false);
		const signalKind = connection.signalKind ?? 'electrical';
		/*
		 * SVG paints marker-start at a path element's first vertex and marker-end
		 * at its last, not once per subpath, so a compounded trace shows one
		 * arrowhead however many wires it carries. `markerAttributes` names a
		 * marker exactly when one rides on the visible trace — open markers travel
		 * on their own carrier below and batch freely — so a connection that
		 * claims those two slots batches with nothing. No colour key begins with
		 * `#`, which keeps the two key spaces disjoint.
		 */
		const key = markerAttributes.includes('marker-')
			? `#${index}`
			: `${colorKey(connection.color)}|${markerAttributes}|${signalKind}|${connection.width ?? 1}`;
		let batch = batches.get(key);
		if (batch === undefined) {
			batch = { color: connection.color, markerAttributes, signalKind, traces: [], endpoints: [], labels: [], carriers: [] };
			batches.set(key, batch);
		}
		const routed = routes[index]!;
		const end = routed.points.at(-1)!;
		batch.traces.push(visibleConnectionPath(connection, routed));
		const carrier = openMarkerCarrier(connection, routed, idPrefix);
		if (carrier !== '') batch.carriers.push(carrier);
		/* v8 ignore next -- parsed documents always materialize relation; fallback preserves old typed ASTs. */
		if ((connection.relation ?? 'signal') === 'signal' && connection.markerEnd === 'none') {
			batch.endpoints.push(
				`M ${svgNumber(end.x - 3)} ${svgNumber(end.y)} a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0`
			);
		}
		/* A junction is the same dot as an endpoint, so it compounds with them. */
		for (const point of [...(routed.junction === undefined ? [] : [routed.junction]), ...(routed.joins ?? [])]) {
			batch.endpoints.push(`M ${svgNumber(point.x - 3)} ${svgNumber(point.y)} a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0`);
		}
		const label = connectionLabelMarkup(connection, routed);
		if (label !== '') batch.labels.push(label);
	}
	return Array.from(batches.values(), (batch, index) => {
		const tracePaint = colorAttributes(batch.color, `schematic-trace${batch.signalKind === 'electrical' ? '' : ` schematic-signal--${batch.signalKind}`}`);
		const nodePaint = colorAttributes(batch.color, 'schematic-node-fill');
		const traceId = `${idPrefix}-wire-batch-${index}-vector`;
		const trace = `<path${embedVisuals ? ` id="${traceId}"` : ''} ${tracePaint} d="${batch.traces.join(' ')}"${batch.markerAttributes} />`;
		const endpoints = batch.endpoints.length === 0 ? '' : `<path ${nodePaint} d="${batch.endpoints.join(' ')}" />`;
		const labels = batch.labels.join('');
		const carriers = batch.carriers.join('');
		if (!embedVisuals) return carriers + trace + endpoints + labels;
		/* Embedded-css output stays role="img": hover-only groups must not enter the tab order. */
		return `<g class="schematic-wire">${carriers}${trace}<use class="schematic-glow-layer" href="#${traceId}" filter="url(#${glowId})" aria-hidden="true" pointer-events="none" />${endpoints}${labels}</g>`;
	}).join('');
}

/**
 * Build concise accessible metadata for a kind-specific component variant.
 *
 * @param component - Component to describe.
 * @returns Additional label segment, or an empty string when none is required.
 */
function componentMetadata(component: SchematicComponent): string {
	if (isDigitalComponent(component)) {
		return [component.variant, component.width > 1 ? `${component.width} bit` : undefined]
			.filter(Boolean)
			.join(', ');
	}
	if (isQuantumSpecial(component)) {
		return [
			component.operator,
			component.controlType,
			component.controls > 0 ? `${component.controls} controls` : undefined,
			component.targets > 0 ? `${component.targets} targets` : undefined,
			component.width > 1 ? `${component.width} bit` : undefined
		].filter(Boolean).join(', ');
	}
	if ((QUANTUM_GATE_KINDS as readonly string[]).includes(component.kind)) {
		const gate = component as QuantumGateComponent;
		return [gate.parameter, gate.phase, gate.matrix].filter(Boolean).join(', ');
	}
	switch (component.kind) {
		case 'resistor':
		case 'capacitor':
		case 'inductor':
			return component.passiveType ?? 'fixed';
		case 'diode':
			return component.diodeType;
		case 'transistor':
			return component.transistorType;
		case 'ground':
			return component.groundStyle;
		case 'source':
		case 'power':
		case 'switch':
		case 'protection':
		case 'amplifier':
		case 'resonator':
		case 'meter':
		case 'load':
			return String(component.variant);
		case 'ic':
			return `${Object.values(component.pins).reduce((total, pins) => total + pins.length, 0)} pins`;
		default:
			return '';
	}
}

/**
 * Render keyboard-accessible invisible hotspots for every physical component port.
 *
 * @param component - Component whose canonical ports are enumerated.
 * @returns Full-mode circle markup with delegated-event data attributes.
 */
function componentPortMarkup(component: SchematicComponent): string {
	const x0 = toMilli(component.x);
	const y0 = toMilli(component.y);
	return placedPorts(component)
		.map((port) => {
			const portId = escapeXml(port.id);
			const parentId = escapeXml(component.id);
			return `<circle ${colorAttributes(component.color, 'schematic-port-hotspot')} cx="${fmt(port.point.x - x0)}" cy="${fmt(port.point.y - y0)}" r="${PORT_HOTSPOT_RADIUS}" fill="transparent" stroke="transparent" stroke-width="8" vector-effect="non-scaling-stroke" pointer-events="all" data-port-id="${portId}" data-parent-node="${parentId}" tabindex="0" role="button" aria-label="${parentId} port ${portId}" />`;
		})
		.join('');
}

/**
 * Render one positioned component instance for the selected output mode.
 *
 * @param component - Component AST node.
 * @param index - Source-order component index used for namespaced vector IDs.
 * @param idPrefix - Diagram-local definition prefix.
 * @param glowId - Diagram-local glow filter ID.
 * @param mode - Markup and interaction budget.
 * @param symbolId - Optional reusable symbol definition for static geometry.
 * @returns Positioned group with labels and mode-appropriate hooks.
 */
function componentMarkup(
	component: SchematicComponent,
	index: number,
	idPrefix: string,
	glowId: string,
	mode: SchemdOutputMode,
	nodeHooks: boolean,
	portHooks: boolean,
	symbolId: string | undefined
): string {
	const label = escapeXml(component.label);
	const renderedLabel = renderMathLabelTspans(component.label);
	const anchors = componentTextAnchors(component);
	/* Rows set beside the component start at their anchor; the rest are centred. */
	const textX = anchors.textX ?? 0;
	const textStart = anchors.textX === undefined ? '' : ' style="text-anchor:start"';
	const id = escapeXml(component.id);
	const vectorId = `${idPrefix}-node-${index}-vector`;
	const rotation = componentRotation(component);
	const vectorTransform = rotation === 0 ? '' : ` transform="rotate(${rotation})"`;
	const styles = mode === 'embedded-css' || mode === 'full';
	const dataAttributes = nodeHooks
		? ` data-node-id="${id}" data-node-kind="${component.kind}" data-node-label="${label}" data-component="${id}" data-kind="${component.kind}" data-source-line="${component.line}"${'orientation' in component && component.orientation !== undefined ? ` data-orientation="${component.orientation}"` : ''}${'fit' in component && component.fit !== undefined ? ` data-fit="${component.fit}"` : ''}`
		: '';
	let accessibility = '';
	if (mode === 'full') {
		const metadata = componentMetadata(component);
		const ariaLabel = escapeXml(
			`${component.id}, ${component.kind}${component.label === '' ? '' : `, ${mathLabelText(component.label)}`}${metadata === '' ? '' : `, ${metadata}`}`
		);
		/* A focusable group must not contain the full mode's focusable port controls. */
		accessibility = `${portHooks ? '' : ' tabindex="0"'} role="group" aria-label="${ariaLabel}"`;
	}
	const vectorIdAttribute = styles ? ` id="${vectorId}"` : '';
	const glow = styles
		? `<use class="schematic-glow-layer" href="#${vectorId}" filter="url(#${glowId})" aria-hidden="true" pointer-events="none" />`
		: '';
	const hotspots = portHooks ? componentPortMarkup(component) : '';
	const vector =
		symbolId === undefined
			? `<g${vectorIdAttribute} class="schematic-component-vector"${vectorTransform}>${componentShape(component)}</g>`
			: `<use${vectorIdAttribute} ${colorAttributes(component.color, 'schematic-component-vector')} href="#${symbolId}"${vectorTransform} />`;
	const innerText = componentInnerText(component);
	/*
	 * Every component emits these two labels, so their shared paint is the
	 * densest boilerplate in the document. With styles present the stylesheet
	 * already carries it (see STATIC_SVG_STYLES); without styles the attributes
	 * are required, or the labels inherit the root's outline paint.
	 */
	const labels = isUmlComponent(component)
		? ''
		: `<text class="schematic-designator" x="${textX}" y="${svgNumber(anchors.designatorY)}"${textStart}>${id}</text>${component.label === '' ? '' : `<text class="schematic-label" x="${textX}" y="${svgNumber(anchors.labelY)}"${textStart}>${renderedLabel}</text>`}`;
	/* Without a stylesheet the paint travels on one inherited group instead of
	   on each label — same pixels, one shared declaration per component. */
	const externalLabels =
		styles || labels === ''
			? labels
			: `<g ${TEXT_PAINT} ${TEXT_LABEL_GEOMETRY}>${labels}</g>`;
	return `<g class="schematic-component"${dataAttributes} transform="translate(${svgNumber(component.x)} ${svgNumber(component.y)})"${accessibility}>${vector}${glow}${innerText}${externalLabels}${hotspots}</g>`;
}

/** A rendered document and the exact UTF-8 size the writer already measured. */
export interface RenderedSchematic {
	/** Complete trusted `<figure>` markup containing an inline SVG. */
	readonly svg: string;
	/** Exact UTF-8 byte length of {@link svg}. */
	readonly byteLength: number;
	/** The sheet the drawing occupies: declared, or measured for `bounds: 'auto'`. */
	readonly sheet: SchematicSheet;
}

/**
 * Render a validated schematic AST as a bounded, accessible inline SVG figure.
 *
 * Geometry is revalidated against the supplied bounds before serialization.
 * `default` compounds paths with no embedded styles, `embedded-css` adds theme
 * and hover visuals, and `full` emits per-node event delegation attributes.
 *
 * @param document - Immutable AST returned by `parseSchematic` in this module instance.
 * @param options - Intrinsic bounds, title, optional ID namespace, and output mode.
 * @returns Complete trusted `<figure>` markup containing an inline SVG.
 * @throws {TypeError} When `document` lacks parser provenance.
 * @throws {SchematicSyntaxError} For invalid options, geometry, or output-budget overflow.
 */
export function renderSchematic(
	document: SchematicDocument,
	options: CompileSchematicOptions
): string {
	return renderSchematicSized(document, options).svg;
}

/**
 * Render a document and report its exact encoded size.
 *
 * `compileSchematic` publishes `metrics.svgBytes`, and used to derive it by
 * scanning the finished document a second time — on a 512-component figure that
 * is a 748 KB pass for a number the writer counted while producing it. This is
 * the same render, returning what it already knew.
 *
 * @param document - Immutable AST returned by `parseSchematic` in this module instance.
 * @param options - Intrinsic bounds, title, optional ID namespace, and output mode.
 * @returns The markup and its exact UTF-8 byte length.
 */
export function renderSchematicSized(
	document: SchematicDocument,
	options: CompileSchematicOptions
): RenderedSchematic {
	assertParsedSchematicDocument(document);
	const normalized = normalizeCompileOptions(options);
	/*
	 * A route-cache hit proves the parser already validated this exact frozen
	 * document against these exact bounds, so geometry is re-verified (and the
	 * component map materialized) only for uncached bounds.
	 */
	const canvas = normalized.bounds;
	const cached = parsedSchematicRoutes(document, canvas);
	const geometry =
		cached === undefined
			? validateSchematicGeometry(
					document,
					normalized,
					canvas === 'auto'
						? undefined
						: routeConnections(
								document.connections,
								new Map(document.components.map((component) => [component.id, component])),
								canvas,
								normalized.limits.wireCrossings
							)
				)
			: { routes: cached, sheet: parsedSchematicSheet(document, canvas)! };
	const routedConnections = geometry.routes;
	const sheet = geometry.sheet;
	/* A declared canvas starts at the origin, and is written exactly as it always was. */
	const origin = sheet.x === 0 && sheet.y === 0 ? '' : ` x="${sheet.x}" y="${sheet.y}"`;
	/* Hashing serializes the entire AST, so the signature exists only when no idPrefix is supplied. */
	const signatureHash = (): string =>
		stableHash(
			`${canvas === 'auto' ? `${sheet.x},${sheet.y},` : ''}${sheet.width}x${sheet.height}:${normalized.title}:${JSON.stringify(document)}`
		);
	const candidatePrefix = (normalized.idPrefix ?? `schematic-${signatureHash()}`).replace(
		/[^A-Za-z0-9_-]/g,
		'-'
	);
	const safePrefix = /[A-Za-z0-9]/.test(candidatePrefix)
		? candidatePrefix
		: `schematic-${signatureHash()}`;
	const titleId = `${safePrefix}-title`;
	const descriptionId = `${safePrefix}-description`;
	const gridId = `${safePrefix}-grid`;
	// Preserve the documented filter name while namespacing it per diagram so
	// multiple inline schematics cannot resolve each other's SVG definitions.
	const glowId = `${safePrefix}-schematic-glow-filter`;
	const styles = normalized.mode === 'embedded-css' || normalized.mode === 'full';
	const hooks = normalized.mode === 'full';
	const nodeHooks = hooks && (normalized.semanticHookMask & NODE_HOOK) !== 0;
	const portHooks = hooks && (normalized.semanticHookMask & PORT_HOOK) !== 0;
	const wireHooks = hooks && (normalized.semanticHookMask & WIRE_HOOK) !== 0;
	const reusableSymbols = new Map<string, { id: string; component: SchematicComponent }>();
	for (const component of document.components) {
		const key = reusableSymbolKey(component);
		if (key !== undefined && !reusableSymbols.has(key)) {
			reusableSymbols.set(key, { id: `${safePrefix}-symbol-${key}`, component });
		}
	}
	const title = escapeXml(normalized.title);
	const componentCount = document.components.length;
	const description = `${componentCount} component${componentCount === 1 ? '' : 's'} and ${document.connections.length} connection${document.connections.length === 1 ? '' : 's'}.`;
	const writer = new BoundedSvgWriter(normalized.limits.svgOutputBytes);
	const hookStyles = portHooks ? HOOK_SVG_STYLES : '';
	const interactionStyles = styles ? INTERACTIVE_SVG_STYLES : '';
	const glowFilter = styles
		? `<filter id="${glowId}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2.2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>`
		: '';
	const symbolDefinitions = Array.from(reusableSymbols.values(), ({ id, component }) =>
		reusableSymbolDefinition(component, id)
	).join('');
	const usedMarkers = new Set(
		document.connections.flatMap((connection) => [connection.markerStart, connection.markerEnd])
	);
	const markerDefinitions = `${usedMarkers.has('arrow') ? `<marker id="${safePrefix}-marker-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 0 8 4 0 8Z" fill="context-stroke" /></marker>` : ''}${usedMarkers.has('open-arrow') ? `<marker id="${safePrefix}-marker-open-arrow" viewBox="0 0 9 10" refX="9" refY="5" markerWidth="9" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 0 9 5 0 10" fill="none" stroke="context-stroke" stroke-width="1.5" /></marker>` : ''}${usedMarkers.has('dot') ? `<marker id="${safePrefix}-marker-dot" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse"><circle cx="4" cy="4" r="3" fill="context-stroke" /></marker>` : ''}${usedMarkers.has('triangle') ? `<marker id="${safePrefix}-marker-triangle" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 1 11 6 0 11Z" fill="none" stroke="context-stroke" stroke-width="1.5" /></marker>` : ''}${usedMarkers.has('diamond') ? `<marker id="${safePrefix}-marker-diamond" viewBox="0 0 13 12" refX="12" refY="6" markerWidth="13" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 6 6 1 12 6 6 11Z" fill="none" stroke="context-stroke" stroke-width="1.5" /></marker>` : ''}${usedMarkers.has('diamond-filled') ? `<marker id="${safePrefix}-marker-diamond-filled" viewBox="0 0 13 12" refX="12" refY="6" markerWidth="13" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 6 6 1 12 6 6 11Z" fill="context-stroke" stroke="context-stroke" /></marker>` : ''}`;
	const embeddedDefinitions = styles
		? `<style>${STATIC_SVG_STYLES}${hookStyles}${interactionStyles}</style><pattern id="${gridId}" width="20" height="20" patternUnits="userSpaceOnUse"><path class="schematic-grid-line" d="M20 0H0V20" /></pattern>${glowFilter}`
		: '';
	const definitions = `${embeddedDefinitions}${markerDefinitions}${symbolDefinitions}`;
	/* Any full-mode output contains focusable descendants, so the root must not flatten them. */
	const svgRole = hooks ? 'group' : 'img';
	writer.append(
		`<figure class="schematic-frame"${hooks ? ' data-schematic' : ''}><svg class="schematic-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${sheet.x} ${sheet.y} ${sheet.width} ${sheet.height}" width="${sheet.width}" height="${sheet.height}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" font-family="${MATH_LABEL_FONT_FAMILY}" role="${svgRole}" aria-labelledby="${titleId} ${descriptionId}" preserveAspectRatio="xMidYMid meet"><title id="${titleId}">${title}</title><desc id="${descriptionId}">${description}</desc>${definitions === '' ? '' : `<defs>${definitions}</defs>`}${styles ? `<rect class="schematic-surface"${origin} width="100%" height="100%" /><rect class="schematic-grid"${origin} width="100%" height="100%" fill="url(#${gridId})" />` : ''}<g class="schematic-vectors">`
	);
	if (wireHooks) {
		for (const [index, connection] of document.connections.entries()) {
			writer.append(
				connectionMarkup(connection, routedConnections[index]!, index, safePrefix, glowId)
			);
		}
	} else {
		writer.append(
			compactConnectionMarkup(
				document.connections,
				routedConnections,
				safePrefix,
				normalized.mode === 'embedded-css',
				glowId
			)
		);
	}
	for (const [index, component] of document.components.entries()) {
		const key = reusableSymbolKey(component);
		const symbolId = key === undefined ? undefined : reusableSymbols.get(key)?.id;
		writer.append(
			componentMarkup(component, index, safePrefix, glowId, normalized.mode, nodeHooks, portHooks, symbolId)
		);
	}
	writer.append(`</g></svg><figcaption>${title}</figcaption></figure>`);
	return { svg: writer.finish(), byteLength: writer.byteLength, sheet };
}
