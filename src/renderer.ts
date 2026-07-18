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
import {
	classicalGateHeight,
	componentTextAnchors,
	distributedCoordinate,
	enumerateComponentPorts,
	positionIcPin,
	PORT_HOTSPOT_RADIUS,
	routeConnections,
	validateDocumentGeometry,
	type IcPinSide,
	type RoutedConnection
} from './layout.js';
import { MAX_SCHEMATIC_SVG_OUTPUT_BYTES, utf8ByteLength } from './limits.js';
import { assertParsedSchematicDocument } from './parser.js';
import { parsedSchematicRoutes } from './route-cache.js';
import {
	CLASSICAL_GATE_KINDS,
	SCHEMD_OUTPUT_MODES,
	SCHEMD_SEMANTIC_HOOKS,
	UML_COMPONENT_KINDS,
	SchematicSyntaxError,
	type ClassicalGateComponent,
	type CompileSchematicOptions,
	type DiodeComponent,
	type GroundComponent,
	type IntegratedCircuitComponent,
	type QuantumGateComponent,
	type SchematicColor,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicSemanticHook,
	type SchemdOutputMode,
	type TransistorComponent,
	type UmlClassComponent,
	type UmlComponent,
	type UmlStateComponent
} from './types.js';
import { mathLabelTextWidth, renderMathLabelTspans } from './math-label.js';
import { escapeXml } from './xml.js';

/**
 * Legacy alias for the hard SVG allocation ceiling.
 *
 * @deprecated Prefer the root-exported `MAX_SCHEMATIC_SVG_OUTPUT_BYTES`.
 */
export const MAX_SVG_OUTPUT_BYTES = MAX_SCHEMATIC_SVG_OUTPUT_BYTES;

/** Minimal theme-aware vector styles embedded by non-default output modes. */
const STATIC_SVG_STYLES =
	'.schematic-token{fill:none;stroke:var(--schematic-vector,var(--schematic-vector-fallback,currentColor));stroke-linecap:round;stroke-linejoin:round;stroke-width:var(--schematic-stroke-width,1.65);vector-effect:non-scaling-stroke}.schematic-node-fill{fill:var(--schematic-vector,var(--schematic-vector-fallback,currentColor))}.schematic-designator,.schematic-label,.schematic-gate-symbol,.schematic-quantum-detail,.schematic-pin-label,.schematic-uml-text,.schematic-connection-label{fill:currentColor}.schematic-uml-row{font-size:12px}.schematic-uml-stereotype{font-size:11px}.schematic-connection-label{font-size:11px;paint-order:stroke;stroke:var(--schematic-surface,#fff);stroke-width:4;stroke-linejoin:round}.schematic-surface{fill:var(--schematic-surface,transparent)}.schematic-grid-line{fill:none;stroke:var(--schematic-grid,currentColor);stroke-width:1;opacity:.12;vector-effect:non-scaling-stroke}';

/** Keyboard and pointer hotspot rules emitted only by `full` mode. */
const HOOK_SVG_STYLES =
	'.schematic-port-hotspot{fill:transparent!important;stroke:transparent!important;stroke-width:8;vector-effect:non-scaling-stroke;pointer-events:all;outline:none}.schematic-port-hotspot:focus-visible{fill:var(--schematic-vector,var(--schematic-vector-fallback,currentColor))!important;fill-opacity:.22!important;stroke:var(--schematic-vector,var(--schematic-vector-fallback,currentColor))!important;stroke-width:2}';

/** Hover, focus, state-class, glow, and reduced-motion rules for styled modes. */
const INTERACTIVE_SVG_STYLES =
	'.schematic-component,.schematic-wire{outline:none;transition:opacity .2s ease,filter .2s ease}.schematic-component .schematic-token,.schematic-wire .schematic-token{transition:stroke .2s ease,fill .2s ease,color .2s ease,opacity .2s ease,stroke-width .2s ease}.schematic-glow-layer{opacity:0;pointer-events:none;transition:opacity .2s ease}.schematic-component:hover>.schematic-glow-layer,.schematic-component:focus>.schematic-glow-layer,.schematic-component:focus-within>.schematic-glow-layer,.schematic-component.is-hovered>.schematic-glow-layer,.schematic-component.is-active>.schematic-glow-layer,.schematic-component.is-selected>.schematic-glow-layer,.schematic-wire:hover>.schematic-glow-layer,.schematic-wire:focus>.schematic-glow-layer,.schematic-wire.is-hovered>.schematic-glow-layer,.schematic-wire.is-active>.schematic-glow-layer,.schematic-wire.is-selected>.schematic-glow-layer{opacity:1}.schematic-component.is-degraded,.schematic-wire.is-degraded{opacity:.45}.schematic-component.is-degraded>.schematic-glow-layer,.schematic-wire.is-degraded>.schematic-glow-layer{opacity:0}.schematic-component:hover .schematic-token,.schematic-component:focus .schematic-token,.schematic-component:focus-within .schematic-token,.schematic-component.is-hovered .schematic-token,.schematic-component.is-active .schematic-token,.schematic-component.is-selected .schematic-token,.schematic-wire:hover .schematic-token,.schematic-wire:focus .schematic-token,.schematic-wire.is-hovered .schematic-token,.schematic-wire.is-active .schematic-token,.schematic-wire.is-selected .schematic-token{stroke-width:var(--schematic-interactive-stroke-width,2.25)}.schematic-port-hotspot{fill:var(--schematic-vector,var(--schematic-vector-fallback,currentColor))!important;fill-opacity:0;transition:fill-opacity .2s ease,opacity .2s ease}.schematic-port-hotspot:hover,.schematic-port-hotspot:focus,.schematic-port-hotspot.is-hovered,.schematic-port-hotspot.is-active,.schematic-port-hotspot.is-selected{fill-opacity:.2}.schematic-port-hotspot.is-degraded{opacity:.45}@media(prefers-reduced-motion:reduce){.schematic-component,.schematic-wire,.schematic-token,.schematic-glow-layer,.schematic-port-hotspot{transition:none}}';

/** Fully validated renderer options with required normalized defaults. */
interface NormalizedCompileOptions extends CompileSchematicOptions {
	/** Integer intrinsic canvas dimensions. */
	bounds: { width: number; height: number };
	/** Non-empty accessible diagram title. */
	title: string;
	/** Explicit output-budget mode. */
	mode: SchemdOutputMode;
	/** Constant-time full-mode hook lookup. */
	semanticHookMask: number;
}

const NODE_HOOK = 1;
const PORT_HOOK = 2;
const WIRE_HOOK = 4;

function semanticHookBit(hook: SchematicSemanticHook): number {
	if (hook === 'nodes') return NODE_HOOK;
	if (hook === 'ports') return PORT_HOOK;
	return WIRE_HOOK;
}

/**
 * Append-only SVG sink that enforces the compiler's UTF-8 output ceiling.
 *
 * The writer tracks encoded byte cost incrementally without allocating an
 * intermediate `TextEncoder` buffer. Chunks are joined only after successful
 * completion, so partial oversized output is never returned.
 */
export class BoundedSvgWriter {
	/** Ordered compiler-owned fragments awaiting final serialization. */
	readonly #chunks: string[] = [];
	/** Running exact UTF-8 byte count for appended fragments. */
	#bytes = 0;

	/**
	 * Add one trusted SVG fragment within the hard output budget.
	 *
	 * @param chunk - Compiler-generated markup fragment.
	 * @throws {SchematicSyntaxError} When the aggregate UTF-8 size exceeds the limit.
	 */
	append(chunk: string): void {
		this.#bytes += utf8ByteLength(chunk);
		if (this.#bytes > MAX_SCHEMATIC_SVG_OUTPUT_BYTES) {
			throw new SchematicSyntaxError(
				`Compiled SVG exceeds the ${MAX_SCHEMATIC_SVG_OUTPUT_BYTES.toLocaleString('en-US')} byte output limit.`
			);
		}
		this.#chunks.push(chunk);
	}

	/**
	 * Join all accepted fragments into the final SVG figure.
	 *
	 * @returns Complete trusted markup in append order.
	 */
	finish(): string {
		return this.#chunks.join('');
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
	const rawBounds = candidate.bounds;
	if (typeof rawBounds !== 'object' || rawBounds === null) {
		throw new SchematicSyntaxError('Render options require bounds.');
	}
	const bounds = rawBounds as Record<string, unknown>;
	const width = bounds.width;
	const height = bounds.height;
	if (
		typeof width !== 'number' ||
		!Number.isInteger(width) ||
		typeof height !== 'number' ||
		!Number.isInteger(height) ||
		width < 64 ||
		height < 64 ||
		width > 4096 ||
		height > 4096
	) {
		throw new SchematicSyntaxError('Render bounds must be integers from 64 through 4096.');
	}
	const title = candidate.title;
	if (typeof title !== 'string' || title.trim() === '' || title.length > 512) {
		throw new SchematicSyntaxError(
			'Render title must be a non-empty string of at most 512 characters.'
		);
	}
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
	return idPrefix === undefined
		? { bounds: { width, height }, title, mode: normalizedMode, semanticHookMask }
		: { bounds: { width, height }, title, idPrefix, mode: normalizedMode, semanticHookMask };
}

/**
 * Serialize a computed SVG number with at most three fractional digits.
 *
 * @param value - Finite layout coordinate.
 * @returns Compact decimal string.
 */
function svgNumber(value: number): string {
	return String(Number(value.toFixed(3)));
}

/**
 * Estimate a bounded SVG `textLength` using Unicode code points.
 *
 * @param value - Text being fitted.
 * @param maximum - Maximum permitted length in viewBox units.
 * @param advance - Estimated width per Unicode code point.
 * @returns Length clamped to the inclusive range from one to `maximum`.
 */
function fittedTextLength(value: string, maximum: number, advance: number): number {
	return Math.max(1, Math.min(Math.ceil(mathLabelTextWidth(value, advance)), maximum));
}

/**
 * Compute a stable compact FNV-1a-style identifier suffix.
 *
 * This is a deterministic namespace helper, not a cryptographic hash.
 *
 * @param value - Diagram signature to hash.
 * @returns Unsigned base-36 hash text.
 */
function stableHash(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

/**
 * Narrow a component union to a classical gate.
 *
 * @param component - Component to classify.
 * @returns Whether its kind belongs to the classical gate registry.
 */
function isClassicalGate(component: SchematicComponent): component is ClassicalGateComponent {
	return CLASSICAL_GATE_KINDS.includes(component.kind as ClassicalGateComponent['kind']);
}

/** Narrow a component to the UML renderer union. */
function isUmlComponent(component: SchematicComponent): component is UmlComponent {
	return UML_COMPONENT_KINDS.includes(component.kind as UmlComponent['kind']);
}

/**
 * Convert a sanitized color record into compact theme-aware SVG attributes.
 *
 * @param color - Parser-validated semantic token, CSS color, or custom alias.
 * @param extraClass - Optional compiler-owned class suffixes.
 * @returns Escaped class, fill, and safe style attributes.
 */
function colorAttributes(color: SchematicColor, extraClass = ''): string {
	const suffix = extraClass === '' ? '' : ` ${extraClass}`;
	const fill = extraClass.split(' ').includes('schematic-node-fill') ? ' fill="currentColor"' : '';
	if (color.kind === 'token') {
		return `class="schematic-token schematic-token--${color.value}${suffix}"${fill}`;
	}
	if (color.kind === 'css') {
		return `class="schematic-token schematic-token--custom${suffix}"${fill} style="color:${escapeXml(color.value)};--schematic-vector:${escapeXml(color.value)}"`;
	}
	const safeAlias = color.value.replace(/[^a-z0-9-]/gi, '-');
	return `class="schematic-token schematic-token--alias schematic-color--${safeAlias}${suffix}"${fill} style="color:var(--schematic-color-${safeAlias},var(--schematic-vector-fallback,currentColor));--schematic-vector:var(--schematic-color-${safeAlias},var(--schematic-vector-fallback,currentColor))"`;
}

/**
 * Approximate the concave input contour of IEEE OR-family gates at one Y coordinate.
 *
 * @param kind - Gate kind; XOR receives its additional left offset.
 * @param y - Relative terminal Y coordinate.
 * @param height - Dynamic gate height.
 * @returns Relative X coordinate on the input boundary.
 */
function orInputBoundaryX(kind: ClassicalGateComponent['kind'], y: number, height: number): number {
	const halfHeight = height / 2;
	const progress = (1 - y / halfHeight) / 2;
	const start = kind === 'xor' ? -38 : -32;
	return start + 40 * progress * (1 - progress);
}

/**
 * Approximate the convex output contour of an IEEE OR-family gate.
 *
 * @param y - Relative terminal Y coordinate.
 * @param height - Dynamic gate height.
 * @returns Relative X coordinate on the output curve.
 */
function orOutputBoundaryX(y: number, height: number): number {
	const halfHeight = height / 2;
	const progress = Math.sqrt(Math.max(0, 1 - Math.abs(y) / halfHeight));
	const inverse = 1 - progress;
	return -32 * inverse * inverse + 6 * inverse * progress + 32 * progress * progress;
}

/**
 * Resolve the physical gate contour X coordinate for a distributed terminal.
 *
 * @param component - Classical gate with standard and dimensions.
 * @param direction - Input or output side.
 * @param y - Relative terminal Y coordinate.
 * @returns Relative contour coordinate used to terminate a pin stub.
 */
function gateBoundaryX(
	component: ClassicalGateComponent,
	direction: 'input' | 'output',
	y: number
): number {
	if (component.standard === 'iec') return direction === 'input' ? -32 : 32;
	const height = classicalGateHeight(component);
	if (direction === 'input') {
		if (component.kind === 'or' || component.kind === 'nor' || component.kind === 'xor') {
			return orInputBoundaryX(component.kind, y, height);
		}
		return component.kind === 'not' ? -30 : -32;
	}
	if (component.kind === 'and' || component.kind === 'nand') {
		const normalized = y / (height / 2);
		return 32 * Math.sqrt(Math.max(0, 1 - normalized * normalized));
	}
	if (component.kind === 'or' || component.kind === 'nor' || component.kind === 'xor') {
		return orOutputBoundaryX(y, height);
	}
	return 30 - 60 * (Math.abs(y) / (height / 2));
}

/**
 * Identify gates whose outputs carry an inversion bubble.
 *
 * @param component - Classical gate to inspect.
 * @returns Whether every output receives an inversion marker.
 */
function hasOutputInversion(component: ClassicalGateComponent): boolean {
	return component.kind === 'nand' || component.kind === 'nor' || component.kind === 'not';
}

/**
 * Render dynamically distributed input and output terminal stubs.
 *
 * @param component - Gate controlling terminal counts and contour geometry.
 * @param paint - Trusted compiler-generated SVG paint attributes.
 * @returns Concatenated path markup for all terminal stubs.
 */
function gateStubs(component: ClassicalGateComponent, paint: string): string {
	const height = classicalGateHeight(component);
	const inputs = Array.from({ length: component.inputs }, (_, index) => {
		const y = distributedCoordinate(index, component.inputs, height);
		return `<path ${paint} d="M -48 ${svgNumber(y)} H ${svgNumber(gateBoundaryX(component, 'input', y))}" />`;
	}).join('');
	const outputs = Array.from({ length: component.outputs }, (_, index) => {
		const y = distributedCoordinate(index, component.outputs, height);
		const boundary = gateBoundaryX(component, 'output', y);
		const start = boundary + (hasOutputInversion(component) ? 8 : 0);
		return `<path ${paint} d="M ${svgNumber(start)} ${svgNumber(y)} H 48" />`;
	}).join('');
	return inputs + outputs;
}

/**
 * Render one inversion bubble for each output of NAND, NOR, or NOT gates.
 *
 * @param component - Gate to inspect and distribute.
 * @param paint - Trusted SVG paint attributes.
 * @returns Concatenated circle markup, or an empty string for non-inverting gates.
 */
function inversionBubbles(component: ClassicalGateComponent, paint: string): string {
	if (!hasOutputInversion(component)) return '';
	const height = classicalGateHeight(component);
	return Array.from({ length: component.outputs }, (_, index) => {
		const y = distributedCoordinate(index, component.outputs, height);
		const center = gateBoundaryX(component, 'output', y) + 4;
		return `<circle ${paint} cx="${svgNumber(center)}" cy="${svgNumber(y)}" r="4" />`;
	}).join('');
}

/**
 * Render an IEC rectangular logic block with its standard operator glyph.
 *
 * @param component - IEC classical gate.
 * @param paint - Trusted SVG paint attributes.
 * @returns Complete local-coordinate gate markup.
 */
function iecGate(component: ClassicalGateComponent, paint: string): string {
	const height = classicalGateHeight(component);
	const symbol: Readonly<Record<ClassicalGateComponent['kind'], string>> = {
		and: '&amp;',
		nand: '&amp;',
		or: '≥1',
		nor: '≥1',
		xor: '=1',
		not: '1'
	};
	return `<rect ${paint} x="-32" y="${-height / 2}" width="64" height="${height}" rx="2" /><text class="schematic-gate-symbol" fill="currentColor" stroke="none" x="0" y="4" text-anchor="middle" font-size="14">${symbol[component.kind]}</text>${inversionBubbles(component, paint)}${gateStubs(component, paint)}`;
}

/**
 * Render an IEEE gate contour scaled to arbitrary terminal counts.
 *
 * @param component - IEEE classical gate.
 * @param paint - Trusted SVG paint attributes.
 * @returns Complete local-coordinate gate markup.
 */
function ieeeGate(component: ClassicalGateComponent, paint: string): string {
	const height = classicalGateHeight(component);
	const top = -height / 2;
	const bottom = height / 2;
	let contour: string;
	if (component.kind === 'not') {
		contour = `<path ${paint} d="M -30 ${top} L 30 0 L -30 ${bottom} Z" />`;
	} else if (component.kind === 'and' || component.kind === 'nand') {
		contour = `<path ${paint} d="M -32 ${top} H 0 A 32 ${height / 2} 0 0 1 0 ${bottom} H -32 Z" />`;
	} else {
		const xorArc =
			component.kind === 'xor' ? `<path ${paint} d="M -38 ${top} Q -18 0 -38 ${bottom}" />` : '';
		contour = `<path ${paint} d="M -32 ${top} Q 3 ${top} 32 0 Q 3 ${bottom} -32 ${bottom} Q -12 0 -32 ${top} Z" />${xorArc}`;
	}
	return `${contour}${inversionBubbles(component, paint)}${gateStubs(component, paint)}`;
}

/**
 * Render a qgate label and optional parameter, phase, and matrix rows.
 *
 * @param component - Quantum gate containing micro-math-capable text fields.
 * @returns Centered SVG text rows in deterministic metadata order.
 */
function quantumText(component: QuantumGateComponent): string {
	const details = [component.parameter, component.phase, component.matrix].filter(
		(value): value is string => value !== undefined && value !== ''
	);
	const rows = [component.label, ...details];
	const start = -((rows.length - 1) * 12) / 2 + 4;
	return rows
		.map(
			(value, index) =>
				`<text class="${index === 0 ? 'schematic-gate-symbol' : 'schematic-quantum-detail'}" fill="currentColor" stroke="none" x="0" y="${start + index * 12}" text-anchor="middle" font-size="${index === 0 ? 14 : 10}" textLength="${fittedTextLength(value, 56, index === 0 ? 7 : 5)}" lengthAdjust="spacingAndGlyphs">${renderMathLabelTspans(value)}</text>`
		)
		.join('');
}

/**
 * Render standard, Schottky, Zener, or LED diode vectors.
 *
 * @param component - Diode selecting the physical variant.
 * @param paint - Trusted SVG paint attributes.
 * @returns Local-coordinate SVG paths.
 */
function diodeShape(component: DiodeComponent, paint: string): string {
	const junction = `<path ${paint} d="M -42 0 H -14 M -14 -16 L 10 0 L -14 16 Z M 10 -16 V 16 M 10 0 H 42" />`;
	switch (component.diodeType) {
		case 'standard':
			return junction;
		case 'schottky':
			return `${junction}<path ${paint} d="M 10 -16 H 16 V -10 M 10 16 H 4 V 10" />`;
		case 'zener':
			return `${junction}<path ${paint} d="M 4 -20 L 10 -16 M 10 16 L 16 20" />`;
		case 'led':
			return `${junction}<path ${paint} d="M -1 -18 L 11 -30 M 6 -30 H 11 V -25 M 8 -14 L 20 -26 M 15 -26 H 20 V -21" />`;
	}
}

/**
 * Render a bipolar-junction transistor with polarity-correct emitter arrow.
 *
 * @param component - NPN or PNP transistor.
 * @param paint - Trusted SVG paint attributes.
 * @returns Local-coordinate circle and path markup.
 */
function bjtShape(component: TransistorComponent, paint: string): string {
	const emitterArrow =
		component.transistorType === 'npn' ? 'M 12 17 L 24 25 L 20 12' : 'M 0 7 L 12 17 L 0 20';
	return `<circle ${paint} cx="0" cy="0" r="30" /><path ${paint} d="M -42 0 H -9 M -9 -18 V 18 M -9 -10 L 20 -22 H 42 M -9 10 L 20 22 H 42 ${emitterArrow}" />`;
}

/**
 * Render an enhancement MOSFET with polarity-specific gate and arrow treatment.
 *
 * @param component - NMOS or PMOS transistor.
 * @param paint - Trusted SVG paint attributes.
 * @returns Local-coordinate vector markup.
 */
function mosfetShape(component: TransistorComponent, paint: string): string {
	const pChannel = component.transistorType === 'pmos';
	const control = pChannel
		? `<path ${paint} d="M -42 0 H -16" /><circle ${paint} cx="-11" cy="0" r="5" />`
		: `<path ${paint} d="M -42 0 H -10" />`;
	const arrow = pChannel ? 'M 16 -3 L 5 3 L 16 9' : 'M 5 -3 L 16 3 L 5 9';
	return `<circle ${paint} cx="0" cy="0" r="30" />${control}<path ${paint} d="M -10 -19 V 19 M 4 -17 V 17 M 4 -11 L 20 -22 H 42 M 4 11 L 20 22 H 42 ${arrow}" />`;
}

/**
 * Dispatch transistor rendering to its BJT or MOSFET family.
 *
 * @param component - Validated transistor node.
 * @param paint - Trusted SVG paint attributes.
 * @returns Local-coordinate transistor markup.
 */
function transistorShape(component: TransistorComponent, paint: string): string {
	return component.transistorType === 'npn' || component.transistorType === 'pnp'
		? bjtShape(component, paint)
		: mosfetShape(component, paint);
}

/**
 * Render signal, earth, or chassis ground vectors.
 *
 * @param component - Ground component selecting the symbol style.
 * @param paint - Trusted SVG paint attributes.
 * @returns Local-coordinate path markup.
 */
function groundShape(component: GroundComponent, paint: string): string {
	const stem = `<path ${paint} d="M 0 -42 V -10" />`;
	switch (component.groundStyle) {
		case 'signal':
			return `${stem}<path ${paint} d="M -15 -10 H 15 L 0 15 Z" />`;
		case 'earth':
			return `${stem}<path ${paint} d="M -20 -10 H 20 M -13 -3 H 13 M -6 4 H 6" />`;
		case 'chassis':
			return `${stem}<path ${paint} d="M -20 -10 H 20 M -14 -10 L -20 2 M 0 -10 L -6 2 M 14 -10 L 8 2" />`;
	}
}

/**
 * Render one side of dynamic IC terminal stubs and fitted pin labels.
 *
 * @param component - Integrated circuit with computed body dimensions.
 * @param side - Physical edge to render.
 * @param paint - Trusted SVG paint attributes.
 * @returns Concatenated local-coordinate pin and text markup.
 */
function icPinMarkup(
	component: IntegratedCircuitComponent,
	side: IcPinSide,
	paint: string
): string {
	const pins = component.pins[side];
	return pins
		.map((pin, index) => {
			const point = positionIcPin(component, side, index);
			const x = point.x - component.x;
			const y = point.y - component.y;
			const horizontalTextLength = fittedTextLength(
				pin,
				Math.max(8, component.bodyWidth / 2 - 10),
				4
			);
			const verticalTextLength = fittedTextLength(
				pin,
				Math.max(8, component.bodyHeight / 2 - 10),
				4
			);
			if (side === 'left') {
				return `<path ${paint} d="M ${x} ${y} H ${-component.bodyWidth / 2}" /><text class="schematic-pin-label" fill="currentColor" stroke="none" x="${-component.bodyWidth / 2 + 5}" y="${y + 3}" text-anchor="start" font-size="10" textLength="${horizontalTextLength}" lengthAdjust="spacingAndGlyphs">${escapeXml(pin)}</text>`;
			}
			if (side === 'right') {
				return `<path ${paint} d="M ${component.bodyWidth / 2} ${y} H ${x}" /><text class="schematic-pin-label" fill="currentColor" stroke="none" x="${component.bodyWidth / 2 - 5}" y="${y + 3}" text-anchor="end" font-size="10" textLength="${horizontalTextLength}" lengthAdjust="spacingAndGlyphs">${escapeXml(pin)}</text>`;
			}
			if (side === 'top') {
				const labelY = -component.bodyHeight / 2 + 5;
				return `<path ${paint} d="M ${x} ${y} V ${-component.bodyHeight / 2}" /><text class="schematic-pin-label" fill="currentColor" stroke="none" x="${x}" y="${labelY}" text-anchor="start" font-size="10" textLength="${verticalTextLength}" lengthAdjust="spacingAndGlyphs" transform="rotate(90 ${x} ${labelY})">${escapeXml(pin)}</text>`;
			}
			const labelY = component.bodyHeight / 2 - 5;
			return `<path ${paint} d="M ${x} ${component.bodyHeight / 2} V ${y}" /><text class="schematic-pin-label" fill="currentColor" stroke="none" x="${x}" y="${labelY}" text-anchor="start" font-size="10" textLength="${verticalTextLength}" lengthAdjust="spacingAndGlyphs" transform="rotate(-90 ${x} ${labelY})">${escapeXml(pin)}</text>`;
		})
		.join('');
}

/**
 * Render a complete polymorphic IC body, all side pins, and its math-capable label.
 *
 * @param component - Integrated circuit node.
 * @param paint - Trusted SVG paint attributes.
 * @returns Complete local-coordinate chip markup.
 */
function integratedCircuitShape(component: IntegratedCircuitComponent, paint: string): string {
	const left = -component.bodyWidth / 2;
	const top = -component.bodyHeight / 2;
	return `<rect ${paint} x="${left}" y="${top}" width="${component.bodyWidth}" height="${component.bodyHeight}" rx="3" />${icPinMarkup(component, 'left', paint)}${icPinMarkup(component, 'right', paint)}${icPinMarkup(component, 'top', paint)}${icPinMarkup(component, 'bottom', paint)}<text class="schematic-gate-symbol" fill="currentColor" stroke="none" x="0" y="4" text-anchor="middle" font-size="12" textLength="${fittedTextLength(component.label, component.bodyWidth - 12, 7)}" lengthAdjust="spacingAndGlyphs">${renderMathLabelTspans(component.label)}</text>`;
}

/** Serialize one left-aligned UML compartment row. */
function umlRow(value: string, x: number, y: number): string {
	return `<text class="schematic-uml-text schematic-uml-row" fill="currentColor" stroke="none" x="${svgNumber(x)}" y="${svgNumber(y)}" font-size="12">${renderMathLabelTspans(value)}</text>`;
}

/** Render a dynamically sized three-compartment UML class. */
function umlClassShape(component: UmlClassComponent, paint: string): string {
	const left = -component.bodyWidth / 2;
	const top = -component.bodyHeight / 2;
	const headerHeight = 36 + (component.stereotype === undefined ? 0 : 14);
	const attributeHeight = Math.max(24, component.attributes.length * 16 + 8);
	const attributeSeparator = top + headerHeight;
	const operationSeparator = attributeSeparator + attributeHeight;
	const stereotype =
		component.stereotype === undefined
			? ''
			: `<text class="schematic-uml-text schematic-uml-stereotype" fill="currentColor" stroke="none" x="0" y="${svgNumber(top + 13)}" text-anchor="middle" font-size="11">«${renderMathLabelTspans(component.stereotype)}»</text>`;
	const nameY = top + (component.stereotype === undefined ? 23 : 32);
	const attributes = component.attributes
		.map((row, index) => umlRow(row, left + 8, attributeSeparator + 17 + index * 16))
		.join('');
	const operations = component.operations
		.map((row, index) => umlRow(row, left + 8, operationSeparator + 17 + index * 16))
		.join('');
	return `<rect ${paint} x="${svgNumber(left)}" y="${svgNumber(top)}" width="${svgNumber(component.bodyWidth)}" height="${svgNumber(component.bodyHeight)}" rx="2" /><path ${paint} d="M ${svgNumber(left)} ${svgNumber(attributeSeparator)} H ${svgNumber(-left)} M ${svgNumber(left)} ${svgNumber(operationSeparator)} H ${svgNumber(-left)}" />${stereotype}<text class="schematic-uml-text" fill="currentColor" stroke="none" x="0" y="${svgNumber(nameY)}" text-anchor="middle" font-size="13" font-weight="600">${renderMathLabelTspans(component.label)}</text>${attributes}${operations}`;
}

/** Render a UML state and its optional behavior compartment. */
function umlStateShape(component: UmlStateComponent, paint: string): string {
	const left = -component.bodyWidth / 2;
	const top = -component.bodyHeight / 2;
	const separator = top + 32;
	const rows = component.details
		.map((row, index) => umlRow(row, left + 8, separator + 17 + index * 16))
		.join('');
	return `<rect ${paint} x="${svgNumber(left)}" y="${svgNumber(top)}" width="${svgNumber(component.bodyWidth)}" height="${svgNumber(component.bodyHeight)}" rx="10" />${component.details.length === 0 ? '' : `<path ${paint} d="M ${svgNumber(left)} ${svgNumber(separator)} H ${svgNumber(-left)}" />`}<text class="schematic-uml-text" fill="currentColor" stroke="none" x="0" y="${svgNumber(top + 21)}" text-anchor="middle" font-size="13" font-weight="600">${renderMathLabelTspans(component.label)}</text>${rows}`;
}

/** Render any first-class UML component in local coordinates. */
function umlComponentShape(component: UmlComponent, paint: string, nodePaint: string): string {
	if (component.kind === 'class') return umlClassShape(component, paint);
	if (component.kind === 'state') return umlStateShape(component, paint);
	switch (component.kind) {
		case 'actor':
			return `<circle ${paint} cx="0" cy="-28" r="9" /><path ${paint} d="M 0 -19 V 12 M -20 -5 H 20 M 0 12 L -17 37 M 0 12 L 17 37" /><text class="schematic-uml-text" fill="currentColor" stroke="none" x="0" y="49" text-anchor="middle" font-size="12">${renderMathLabelTspans(component.label)}</text>`;
		case 'usecase':
			return `<ellipse ${paint} cx="0" cy="0" rx="${svgNumber(component.bodyWidth / 2)}" ry="${svgNumber(component.bodyHeight / 2)}" /><text class="schematic-uml-text" fill="currentColor" stroke="none" x="0" y="4" text-anchor="middle" font-size="13">${renderMathLabelTspans(component.label)}</text>`;
		case 'lifeline': {
			const top = -component.bodyHeight / 2;
			const left = -component.bodyWidth / 2;
			return `<rect ${paint} x="${svgNumber(left)}" y="${svgNumber(top)}" width="${svgNumber(component.bodyWidth)}" height="32" rx="2" /><text class="schematic-uml-text" fill="currentColor" stroke="none" x="0" y="${svgNumber(top + 21)}" text-anchor="middle" font-size="12">${renderMathLabelTspans(component.label)}</text><path ${paint} stroke-dasharray="6 5" d="M 0 ${svgNumber(top + 32)} V ${svgNumber(component.bodyHeight / 2)}" />`;
		}
		case 'note': {
			const left = -component.bodyWidth / 2;
			const top = -component.bodyHeight / 2;
			const right = component.bodyWidth / 2;
			return `<path ${paint} d="M ${svgNumber(left)} ${svgNumber(top)} H ${svgNumber(right - 14)} L ${svgNumber(right)} ${svgNumber(top + 14)} V ${svgNumber(-top)} H ${svgNumber(left)} Z M ${svgNumber(right - 14)} ${svgNumber(top)} V ${svgNumber(top + 14)} H ${svgNumber(right)}" /><text class="schematic-uml-text" fill="currentColor" stroke="none" x="0" y="4" text-anchor="middle" font-size="12">${renderMathLabelTspans(component.label)}</text>`;
		}
		case 'package': {
			const left = -component.bodyWidth / 2;
			const top = -component.bodyHeight / 2;
			return `<path ${paint} d="M ${svgNumber(left)} ${svgNumber(top + 12)} V ${svgNumber(-top)} H ${svgNumber(-left)} V ${svgNumber(top)} H ${svgNumber(left + Math.min(54, component.bodyWidth / 2))} L ${svgNumber(left + Math.min(64, component.bodyWidth / 2 + 10))} ${svgNumber(top + 12)} Z" /><text class="schematic-uml-text" fill="currentColor" stroke="none" x="0" y="4" text-anchor="middle" font-size="13">${renderMathLabelTspans(component.label)}</text>`;
		}
		case 'initial':
			return `<circle ${nodePaint} cx="0" cy="0" r="10" />`;
		case 'final':
			return `<circle ${paint} cx="0" cy="0" r="11" /><circle ${nodePaint} cx="0" cy="0" r="6" />`;
	}
}

/**
 * Render the local-coordinate physical vectors for any component kind.
 *
 * @param component - Validated component AST node.
 * @param paint - Optional line-paint attributes; defaults to the component color.
 * @param nodePaint - Optional solid-node attributes for filled markers.
 * @returns Kind-specific SVG fragment without outer positioning markup.
 */
function componentShape(
	component: SchematicComponent,
	paint = colorAttributes(component.color),
	nodePaint = colorAttributes(component.color, 'schematic-node-fill')
): string {
	if (isClassicalGate(component)) {
		return component.standard === 'iec' ? iecGate(component, paint) : ieeeGate(component, paint);
	}
	if (isUmlComponent(component)) return umlComponentShape(component, paint, nodePaint);
	switch (component.kind) {
		case 'resistor':
			return `<path ${paint} d="M -42 0 H -26 L -20 -12 L -10 12 L 0 -12 L 10 12 L 20 -12 L 26 0 H 42" />`;
		case 'capacitor':
			return `<path ${paint} d="M -42 0 H -7 M -7 -18 V 18 M 7 -18 V 18 M 7 0 H 42" />`;
		case 'inductor':
			return `<path ${paint} d="M -42 0 H -28 C -28 -16 -14 -16 -14 0 C -14 -16 0 -16 0 0 C 0 -16 14 -16 14 0 C 14 -16 28 -16 28 0 H 42" />`;
		case 'diode':
			return diodeShape(component, paint);
		case 'transistor':
			return transistorShape(component, paint);
		case 'port':
			return `<path ${paint} d="M -42 0 H -24 M 24 0 H 42 M -24 -16 H 14 L 24 0 L 14 16 H -24 Z" />`;
		case 'ground':
			return groundShape(component, paint);
		case 'hadamard':
			return `<rect ${paint} x="-25" y="-25" width="50" height="50" rx="3" /><path ${paint} d="M -48 0 H -25 M 25 0 H 48 M -9 -13 V 13 M 9 -13 V 13 M -9 0 H 9" />`;
		case 'cnot':
			return `<path ${paint} d="M -42 0 H 42 M 0 -26 V 26 M -8 16 H 8 M 0 8 V 24" /><circle ${nodePaint} cx="0" cy="-16" r="4" /><circle ${paint} cx="0" cy="16" r="10" />`;
		case 'qgate':
			return `<rect ${paint} x="-34" y="-30" width="68" height="60" rx="4" /><path ${paint} d="M -48 0 H -34 M 34 0 H 48" />${quantumText(component)}`;
		case 'ic':
			return integratedCircuitShape(component, paint);
	}
}

/**
 * Derive a reusable symbol key for geometry independent of instance text/counts.
 *
 * @param component - Component candidate.
 * @returns Stable symbol key, or `undefined` when geometry is instance-specific.
 */
function reusableSymbolKey(component: SchematicComponent): string | undefined {
	if (
		isClassicalGate(component) ||
		isUmlComponent(component) ||
		component.kind === 'qgate' ||
		component.kind === 'ic'
	) {
		return undefined;
	}
	if (component.kind === 'diode') return `diode-${component.diodeType}`;
	if (component.kind === 'transistor') return `transistor-${component.transistorType}`;
	if (component.kind === 'ground') return `ground-${component.groundStyle}`;
	return component.kind;
}

/**
 * Serialize one reusable local-coordinate symbol definition.
 *
 * @param component - Representative component for the symbol geometry.
 * @param symbolId - Namespaced, compiler-sanitized definition ID.
 * @returns SVG group suitable inside `<defs>`.
 */
function reusableSymbolDefinition(component: SchematicComponent, symbolId: string): string {
	const vectorPaint =
		'class="schematic-token" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--schematic-vector,currentColor)"';
	const nodePaint =
		'class="schematic-token schematic-node-fill" fill="currentColor" stroke="none" style="fill:var(--schematic-vector,currentColor)"';
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
	const dataAttributes = ` data-wire-source="${source}" data-wire-target="${target}"`;
	/* v8 ignore next -- parsed documents always materialize relation; fallback preserves old typed ASTs. */
	const relation = connection.relation ?? 'signal';
	const accessibility = ` tabindex="0" role="group" aria-label="${escapeXml(relation)} from ${source} to ${target}"`;
	const vectorId = ` id="${traceId}"`;
	const markerAttributes = connectionMarkerAttributes(connection, idPrefix);
	const glow = `<use class="schematic-glow-layer" href="#${traceId}" filter="url(#${glowId})" aria-hidden="true" pointer-events="none" />`;
	const endpoint =
		relation === 'signal' && connection.markerEnd === 'none'
			? `<circle ${colorAttributes(connection.color, 'schematic-node-fill')} cx="${svgNumber(end.x)}" cy="${svgNumber(end.y)}" r="3" />`
			: '';
	return `<g class="schematic-wire"${dataAttributes}${accessibility}><path${vectorId} ${colorAttributes(connection.color, 'schematic-trace')} d="${routed.d}"${markerAttributes} />${glow}${endpoint}${connectionLabelMarkup(connection, routed)}</g>`;
}

/**
 * Serialize optional start and end marker URL attributes.
 *
 * @param connection - Connection marker configuration.
 * @param idPrefix - Diagram-local marker namespace.
 * @returns Zero, one, or two SVG marker attributes.
 */
function connectionMarkerAttributes(connection: SchematicConnection, idPrefix: string): string {
	const start = connection.markerStart;
	const end = connection.markerEnd;
	return `${start === 'none' ? '' : ` marker-start="url(#${idPrefix}-marker-${start})"`}${end === 'none' ? '' : ` marker-end="url(#${idPrefix}-marker-${end})"`}${connection.dashed === true ? ' stroke-dasharray="7 5"' : ''}`;
}

/** Locate the half-length point of a routed polyline for connector labels. */
function connectionLabelPoint(route: RoutedConnection): { x: number; y: number } {
	if (route.curve === 'bezier' && route.points.length >= 4) {
		const a = route.points[0]!;
		const b = route.points[1]!;
		const c = route.points[2]!;
		const d = route.points[3]!;
		return {
			x: (a.x + 3 * b.x + 3 * c.x + d.x) / 8,
			y: (a.y + 3 * b.y + 3 * c.y + d.y) / 8
		};
	}
	let total = 0;
	for (let index = 1; index < route.points.length; index += 1) {
		total +=
			Math.abs(route.points[index]!.x - route.points[index - 1]!.x) +
			Math.abs(route.points[index]!.y - route.points[index - 1]!.y);
	}
	let remaining = total / 2;
	for (let index = 1; index < route.points.length; index += 1) {
		const start = route.points[index - 1]!;
		const end = route.points[index]!;
		const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
		if (remaining <= length) {
			const ratio = length === 0 ? 0 : remaining / length;
			return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
		}
		remaining -= length;
	}
	/* v8 ignore next -- finite routes with at least two points always contain their half length. */
	return route.points.at(-1)!;
}

/** Render an optional UML or signal connector label with an opaque text halo. */
function connectionLabelMarkup(
	connection: SchematicConnection,
	route: RoutedConnection
): string {
	if (connection.label === undefined) return '';
	const point = connectionLabelPoint(route);
	return `<text class="schematic-connection-label" fill="currentColor" stroke="none" x="${svgNumber(point.x)}" y="${svgNumber(point.y - 7)}" text-anchor="middle" font-size="11">${renderMathLabelTspans(connection.label)}</text>`;
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
		/** Individual path-data subpaths to compound. */
		traces: string[];
		/** Circular endpoint subpaths aligned with the traces. */
		endpoints: string[];
		/** Individually positioned connector labels. */
		labels: string[];
	}
	const batches = new Map<string, Batch>();
	for (const [index, connection] of connections.entries()) {
		const markerAttributes = connectionMarkerAttributes(connection, idPrefix);
		const key = `${colorKey(connection.color)}|${markerAttributes}`;
		let batch = batches.get(key);
		if (batch === undefined) {
			batch = { color: connection.color, markerAttributes, traces: [], endpoints: [], labels: [] };
			batches.set(key, batch);
		}
		const routed = routes[index]!;
		const end = routed.points.at(-1)!;
		batch.traces.push(routed.d);
		/* v8 ignore next -- parsed documents always materialize relation; fallback preserves old typed ASTs. */
		if ((connection.relation ?? 'signal') === 'signal' && connection.markerEnd === 'none') {
			batch.endpoints.push(
				`M ${svgNumber(end.x - 3)} ${svgNumber(end.y)} a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0`
			);
		}
		const label = connectionLabelMarkup(connection, routed);
		if (label !== '') batch.labels.push(label);
	}
	return Array.from(batches.values(), (batch, index) => {
		const tracePaint = colorAttributes(batch.color, 'schematic-trace');
		const nodePaint = colorAttributes(batch.color, 'schematic-node-fill');
		const traceId = `${idPrefix}-wire-batch-${index}-vector`;
		const trace = `<path${embedVisuals ? ` id="${traceId}"` : ''} ${tracePaint} d="${batch.traces.join(' ')}"${batch.markerAttributes} />`;
		const endpoints = batch.endpoints.length === 0 ? '' : `<path ${nodePaint} d="${batch.endpoints.join(' ')}" />`;
		const labels = batch.labels.join('');
		if (!embedVisuals) return trace + endpoints + labels;
		return `<g class="schematic-wire" tabindex="0" role="group" aria-label="${batch.traces.length} grouped connection${batch.traces.length === 1 ? '' : 's'}">${trace}<use class="schematic-glow-layer" href="#${traceId}" filter="url(#${glowId})" aria-hidden="true" pointer-events="none" />${endpoints}${labels}</g>`;
	}).join('');
}

/**
 * Build concise accessible metadata for a kind-specific component variant.
 *
 * @param component - Component to describe.
 * @returns Additional label segment, or an empty string when none is required.
 */
function componentMetadata(component: SchematicComponent): string {
	switch (component.kind) {
		case 'qgate':
			return [component.parameter, component.phase, component.matrix].filter(Boolean).join(', ');
		case 'diode':
			return component.diodeType;
		case 'transistor':
			return component.transistorType;
		case 'ground':
			return component.groundStyle;
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
	return enumerateComponentPorts(component)
		.map((port) => {
			const x = svgNumber(port.point.x - component.x);
			const y = svgNumber(port.point.y - component.y);
			const portId = escapeXml(port.id);
			const parentId = escapeXml(component.id);
			return `<circle ${colorAttributes(component.color, 'schematic-port-hotspot')} cx="${x}" cy="${y}" r="${PORT_HOTSPOT_RADIUS}" fill="transparent" stroke="transparent" stroke-width="8" vector-effect="non-scaling-stroke" pointer-events="all" data-port-id="${portId}" data-parent-node="${parentId}" tabindex="0" role="button" aria-label="${parentId} port ${portId}" />`;
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
	const id = escapeXml(component.id);
	const vectorId = `${idPrefix}-node-${index}-vector`;
	const styles = mode === 'embedded-css' || mode === 'full';
	const dataAttributes = nodeHooks
		? ` data-node-id="${id}" data-node-kind="${component.kind}" data-node-label="${label}" data-component="${id}" data-kind="${component.kind}"`
		: '';
	let accessibility = '';
	if (styles) {
		const metadata = componentMetadata(component);
		const ariaLabel = escapeXml(
			`${component.id}, ${component.kind}, ${component.label}${metadata === '' ? '' : `, ${metadata}`}`
		);
		accessibility = ` tabindex="0" role="group" aria-label="${ariaLabel}"`;
	}
	const vectorIdAttribute = styles ? ` id="${vectorId}"` : '';
	const glow = styles
		? `<use class="schematic-glow-layer" href="#${vectorId}" filter="url(#${glowId})" aria-hidden="true" pointer-events="none" />`
		: '';
	const hotspots = portHooks ? componentPortMarkup(component) : '';
	const vector =
		symbolId === undefined
			? `<g${vectorIdAttribute} class="schematic-component-vector">${componentShape(component)}</g>`
			: `<use${vectorIdAttribute} ${colorAttributes(component.color, 'schematic-component-vector')} href="#${symbolId}" />`;
	const externalLabels = isUmlComponent(component)
		? ''
		: `<text class="schematic-designator" fill="currentColor" stroke="none" x="0" y="${anchors.designatorY}" text-anchor="middle" font-size="12" textLength="${anchors.designatorWidth}" lengthAdjust="spacingAndGlyphs">${id}</text><text class="schematic-label" fill="currentColor" stroke="none" x="0" y="${anchors.labelY}" text-anchor="middle" font-size="12" textLength="${anchors.labelWidth}" lengthAdjust="spacingAndGlyphs">${renderedLabel}</text>`;
	return `<g class="schematic-component"${dataAttributes} transform="translate(${svgNumber(component.x)} ${svgNumber(component.y)})"${accessibility}>${vector}${glow}${externalLabels}${hotspots}</g>`;
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
	assertParsedSchematicDocument(document);
	const normalized = normalizeCompileOptions(options);
	const components = new Map(document.components.map((component) => [component.id, component]));
	const routedConnections =
		parsedSchematicRoutes(document, normalized.bounds) ??
		routeConnections(document.connections, components, normalized.bounds);
	validateDocumentGeometry(document, normalized, routedConnections);
	const signature = `${normalized.bounds.width}x${normalized.bounds.height}:${normalized.title}:${JSON.stringify(document)}`;
	const candidatePrefix = (normalized.idPrefix ?? `schematic-${stableHash(signature)}`).replace(
		/[^A-Za-z0-9_-]/g,
		'-'
	);
	const safePrefix = /[A-Za-z0-9]/.test(candidatePrefix)
		? candidatePrefix
		: `schematic-${stableHash(signature)}`;
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
	const writer = new BoundedSvgWriter();
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
	const markerDefinitions = `${usedMarkers.has('arrow') ? `<marker id="${safePrefix}-marker-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 0 8 4 0 8Z" fill="context-stroke" /></marker>` : ''}${usedMarkers.has('open-arrow') ? `<marker id="${safePrefix}-marker-open-arrow" viewBox="0 0 9 10" refX="9" refY="5" markerWidth="9" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 0 9 5 0 10" fill="none" stroke="context-stroke" stroke-width="1.5" /></marker>` : ''}${usedMarkers.has('dot') ? `<marker id="${safePrefix}-marker-dot" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse"><circle cx="4" cy="4" r="3" fill="context-stroke" /></marker>` : ''}${usedMarkers.has('triangle') ? `<marker id="${safePrefix}-marker-triangle" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 1 11 6 0 11Z" fill="var(--schematic-surface,#fff)" stroke="context-stroke" stroke-width="1.5" /></marker>` : ''}${usedMarkers.has('diamond') ? `<marker id="${safePrefix}-marker-diamond" viewBox="0 0 13 12" refX="12" refY="6" markerWidth="13" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 6 6 1 12 6 6 11Z" fill="var(--schematic-surface,#fff)" stroke="context-stroke" stroke-width="1.5" /></marker>` : ''}${usedMarkers.has('diamond-filled') ? `<marker id="${safePrefix}-marker-diamond-filled" viewBox="0 0 13 12" refX="12" refY="6" markerWidth="13" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse" overflow="visible"><path d="M0 6 6 1 12 6 6 11Z" fill="context-stroke" stroke="context-stroke" /></marker>` : ''}`;
	const embeddedDefinitions = styles
		? `<style>${STATIC_SVG_STYLES}${hookStyles}${interactionStyles}</style><pattern id="${gridId}" width="20" height="20" patternUnits="userSpaceOnUse"><path class="schematic-grid-line" d="M20 0H0V20" /></pattern>${glowFilter}`
		: '';
	const definitions = `${embeddedDefinitions}${markerDefinitions}${symbolDefinitions}`;
	writer.append(
		`<figure class="schematic-frame"${hooks ? ' data-schematic' : ''}><svg class="schematic-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${normalized.bounds.width} ${normalized.bounds.height}" width="${normalized.bounds.width}" height="${normalized.bounds.height}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" role="img" aria-labelledby="${titleId} ${descriptionId}" preserveAspectRatio="xMidYMid meet"><title id="${titleId}">${title}</title><desc id="${descriptionId}">${description}</desc>${definitions === '' ? '' : `<defs>${definitions}</defs>`}${styles ? `<rect class="schematic-surface" width="100%" height="100%" /><rect class="schematic-grid" width="100%" height="100%" fill="url(#${gridId})" />` : ''}<g class="schematic-vectors">`
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
	return writer.finish();
}
