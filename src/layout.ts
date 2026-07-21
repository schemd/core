/**
 * Deterministic component geometry, terminal resolution, and wire routing.
 *
 * The layout pass performs bounded arithmetic directly in SVG viewBox units;
 * it has no graph-layout dependency, mutable global state, DOM measurement, or
 * asynchronous work. Orthogonal traces avoid expanded component AABBs and later
 * crossings receive compact engineering bridge arcs in source order.
 *
 * @packageDocumentation
 */
import {
	CLASSICAL_GATE_KINDS,
	DIGITAL_COMPONENT_KINDS,
	QUANTUM_SPECIAL_KINDS,
	UML_COMPONENT_KINDS,
	SchematicSyntaxError,
	type ClassicalGateComponent,
	type DigitalComponent,
	type IntegratedCircuitComponent,
	type QuantumGateComponent,
	type QuantumSpecialComponent,
	type SchematicBounds,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicDocument,
	type SchematicEndpoint,
	type SchematicFence,
	type SchematicOrientation,
	type SchematicPoint,
	type SchematicQuarterTurn,
	type UmlComponent
} from './types.js';
import { mathLabelTextWidth } from './math-label.js';
import { MAX_SCHEMATIC_WIRE_CROSSINGS } from './limits.js';

/** Axis-aligned rectangle expressed in absolute schematic coordinates. */
export interface SchematicRectangle {
	/** Inclusive left extent. */
	minX: number;
	/** Inclusive top extent. */
	minY: number;
	/** Inclusive right extent. */
	maxX: number;
	/** Inclusive bottom extent. */
	maxY: number;
}

/** Axis-aligned half-extents around a component origin. */
export interface SchematicHalfExtents {
	/** Non-negative horizontal distance from the origin to either side. */
	halfWidth: number;
	/** Non-negative vertical distance from the origin to either side. */
	halfHeight: number;
}

/** Render-ready connection path and the points used for bounds validation. */
export interface RoutedConnection {
	/** Original routing strategy; crossing passes must never infer it from control points. */
	readonly curve: SchematicConnection['curve'];
	/** Compact SVG path-data string. */
	d: string;
	/** At least two absolute points spanning endpoints, controls, corners, and bridge extrema. */
	points: readonly [SchematicPoint, SchematicPoint, ...SchematicPoint[]];
}

/** One non-degenerate horizontal or vertical segment in a routed trace. */
interface AxisSegment {
	/** Zero-based source-order route index. */
	readonly routeIndex: number;
	/** Zero-based segment index within the route's point list. */
	readonly segmentIndex: number;
	/** Segment origin. */
	readonly start: SchematicPoint;
	/** Segment destination. */
	readonly end: SchematicPoint;
	/** Constant coordinate axis for crossing classification. */
	readonly orientation: 'horizontal' | 'vertical';
}

/** Straight span used by universal wire-contact validation. */
interface TraceSegment {
	readonly id: number;
	readonly routeIndex: number;
	readonly start: SchematicPoint;
	readonly end: SchematicPoint;
	readonly orthogonal: boolean;
}

/** External text-row baselines and fitted widths relative to a component origin. */
export interface ComponentTextAnchors {
	/** Vertical designator baseline offset. */
	designatorY: number;
	/** Vertical human-readable label baseline offset. */
	labelY: number;
	/** Estimated designator width in viewBox units. */
	designatorWidth: number;
	/** Estimated label width after micro-math translation. */
	labelWidth: number;
}

/** A canonical, physically rendered component terminal and its absolute SVG coordinate. */
export interface ComponentPort {
	/** Canonical terminal name emitted by full-mode interaction hooks. */
	readonly id: string;
	/** Absolute center of the physical terminal. */
	readonly point: SchematicPoint;
	/** Unit outward normal used to leave the owning component without crossing its body. */
	readonly normal: SchematicPoint;
}

/** One edge of a polymorphic integrated-circuit body. */
export type IcPinSide = 'left' | 'right' | 'top' | 'bottom';

/** An eight-pixel target satisfies the minimum pointer hotspot without changing vector geometry. */
export const PORT_HOTSPOT_RADIUS = 4;

/** Physical clearance between an orthogonal trace and a component body. */
export const SCHEMATIC_OBSTACLE_CLEARANCE = 12;

/** Radius of the engineering crossover arc inserted at non-junction wire crossings. */
export const SCHEMATIC_BRIDGE_RADIUS = 5;

/**
 * Normalize the public direction vocabulary to a compact clockwise quarter turn.
 *
 * @param orientation - Validated author-facing orientation.
 * @returns Zero for right, one for down, two for left, or three for up.
 */
export function orientationQuarterTurn(
	orientation: SchematicOrientation
): SchematicQuarterTurn {
	switch (orientation) {
		case 'right':
			return 0;
		case 'down':
			return 1;
		case 'left':
			return 2;
		case 'up':
			return 3;
	}
}

/** Normalize an integer sum to the closed set of supported quarter turns. */
function normalizedQuarterTurn(value: number): SchematicQuarterTurn {
	switch (value & 3) {
		case 0:
			return 0;
		case 1:
			return 1;
		case 2:
			return 2;
		default:
			return 3;
	}
}

/**
 * Compose two clockwise quarter turns without floating-point angle arithmetic.
 *
 * @param first - Turn applied first.
 * @param second - Turn applied second.
 * @returns Canonical combined turn modulo four.
 */
export function composeQuarterTurns(
	first: SchematicQuarterTurn,
	second: SchematicQuarterTurn
): SchematicQuarterTurn {
	return normalizedQuarterTurn(first + second);
}

/** Return the exact quarter turn that reverses the supplied rotation. */
export function inverseQuarterTurn(turn: SchematicQuarterTurn): SchematicQuarterTurn {
	return normalizedQuarterTurn(4 - turn);
}

/** Negate one coordinate while canonicalizing both positive and negative zero. */
function negatedCoordinate(value: number): number {
	return value === 0 ? 0 : -value;
}

/** Canonicalize negative zero without otherwise rounding a coordinate. */
function canonicalCoordinate(value: number): number {
	return value === 0 ? 0 : value;
}

/**
 * Rotate a local point or unit vector clockwise around the origin using only
 * coordinate swaps and sign changes.
 *
 * @param point - Local coordinate or vector.
 * @param turn - Clockwise quarter-turn count.
 * @returns Newly allocated exact coordinate with no negative zero.
 */
export function rotateQuarterPoint(
	point: SchematicPoint,
	turn: SchematicQuarterTurn
): SchematicPoint {
	switch (turn) {
		case 0:
			return { x: canonicalCoordinate(point.x), y: canonicalCoordinate(point.y) };
		case 1:
			return { x: negatedCoordinate(point.y), y: canonicalCoordinate(point.x) };
		case 2:
			return { x: negatedCoordinate(point.x), y: negatedCoordinate(point.y) };
		case 3:
			return { x: canonicalCoordinate(point.y), y: negatedCoordinate(point.x) };
	}
}

/**
 * Rotate axis-aligned half-extents; odd turns swap axes and even turns retain them.
 *
 * @param extents - Canonical unrotated component half-extents.
 * @param turn - Clockwise quarter-turn count.
 * @returns Exact axis-aligned extents of the rotated component.
 */
export function rotateQuarterExtents(
	extents: SchematicHalfExtents,
	turn: SchematicQuarterTurn
): SchematicHalfExtents {
	const halfWidth = canonicalCoordinate(extents.halfWidth);
	const halfHeight = canonicalCoordinate(extents.halfHeight);
	return turn === 1 || turn === 3
		? { halfWidth: halfHeight, halfHeight: halfWidth }
		: { halfWidth, halfHeight };
}

/** Hard ceiling for the sparse fallback router's expanded search states. */
const MAX_ROUTER_STATES = 40_000;
/** Small deterministic bend cost that prefers simpler routes of equal Manhattan length. */
const ROUTER_BEND_PENALTY = 0.25;
/** Spatial-hash cell size used to bound wire-crossing comparisons. */
const CROSSING_BUCKET_SIZE = 64;
/** Smallest bridge radius that survives three-decimal SVG serialization. */
const MIN_RENDERABLE_BRIDGE_RADIUS = 0.001;

/** Gap from upper geometry to the component designator baseline. */
const DESIGNATOR_BASELINE_GAP = 10;
/** Gap from lower geometry to the human-readable label baseline. */
const LABEL_BASELINE_GAP = 19;
/** Conservative text ascent included in component bounds. */
const TEXT_ASCENT_GUTTER = 12;
/** Conservative text descent included in component bounds. */
const TEXT_DESCENT_GUTTER = 5;
/** Monospace glyph-width estimate used for static text fitting. */
const TEXT_ADVANCE = 7;
/** Horizontal clearance retained around external text rows. */
const TEXT_HORIZONTAL_GUTTER = 4;

/** Accepted aliases resolving to a passive component's left terminal. */
const PASSIVE_INPUT_PORTS = new Set(['in', 'left', 'l']);
/** Accepted aliases resolving to a passive component's right terminal. */
const PASSIVE_OUTPUT_PORTS = new Set(['out', 'right', 'r']);
/** Accepted aliases resolving to a diode's anode. */
const DIODE_ANODE_PORTS = new Set(['anode', 'a']);
/** Accepted aliases resolving to a diode's cathode. */
const DIODE_CATHODE_PORTS = new Set(['cathode', 'k', 'c']);
/** Accepted aliases resolving to a transistor control terminal. */
const TRANSISTOR_CONTROL_PORTS = new Set(['base', 'gate', 'b', 'g']);
/** Accepted aliases resolving to a transistor collector or drain. */
const TRANSISTOR_UPPER_PORTS = new Set(['collector', 'drain', 'c', 'd']);
/** Accepted aliases resolving to a transistor emitter or source. */
const TRANSISTOR_LOWER_PORTS = new Set(['emitter', 'source', 'e', 's']);

/**
 * Format finite geometry to at most three decimal places and normalize near-zero values.
 *
 * @param value - Computed viewBox coordinate.
 * @returns Compact decimal representation without insignificant trailing zeroes.
 */
export function formatNumber(value: number): string {
	const rounded = Math.abs(value) < 0.0005 ? 0 : Number(value.toFixed(3));
	return String(rounded);
}

/**
 * Evenly distribute a terminal within a centered span while preserving edge clearance.
 *
 * @param index - Zero-based item index.
 * @param count - Positive number of items in the distribution.
 * @param span - Total centered span in viewBox units.
 * @returns Relative coordinate between negative and positive half-span.
 */
export function distributedCoordinate(index: number, count: number, span: number): number {
	return ((index + 1) * span) / (count + 1) - span / 2;
}

/** Total centered height of a quantum glyph carrying `tracks` qubit lines. */
export function quantumTrackSpan(tracks: number): number {
	return Math.max(16, (tracks - 1) * 18);
}

/**
 * Vertical offset of quantum track `index` within a `tracks`-line glyph.
 *
 * Unlike {@link distributedCoordinate}, tracks are spread *edge-to-edge* so the
 * outermost rails land exactly at ±span/2 — where the connecting bar and body
 * extent terminate. That keeps control dots, targets, and swap crosses on rails
 * a full pitch apart instead of collapsing a two-qubit swap into an overlapped
 * star. Renderer and port geometry both call this, so marks and wires align.
 */
export function quantumTrackCoordinate(index: number, tracks: number): number {
	if (tracks <= 1) return 0;
	const span = quantumTrackSpan(tracks);
	return -span / 2 + (index * span) / (tracks - 1);
}

/**
 * Compute a classical gate height that scales with its busiest terminal side.
 *
 * @param component - Validated classical gate.
 * @returns Height in viewBox units, never smaller than 48.
 */
export function classicalGateHeight(component: ClassicalGateComponent): number {
	return Math.max(48, Math.max(component.inputs, component.outputs) * 16);
}

/** Deterministic shared shell dimensions for native and custom single-qubit gates. */
export function quantumGateDimensions(component: QuantumGateComponent): {
	bodyWidth: number;
	bodyHeight: number;
	stubExtent: number;
} {
	const details = [component.parameter, component.phase, component.matrix].filter(
		(value): value is string => value !== undefined && value !== ''
	);
	let widest = 16;
	if (details.length > 0 && component.kind === 'qgate') widest = mathLabelTextWidth(component.label, 8);
	for (const detail of details) widest = Math.max(widest, mathLabelTextWidth(detail, 7));
	const bodyWidth = Math.max(50, Math.min(104, widest + 20));
	const bodyHeight = 50 + details.length * 15;
	return { bodyWidth, bodyHeight, stubExtent: bodyWidth / 2 + 23 };
}

/**
 * Narrow any component to the classical-gate union.
 *
 * @param component - Component to classify.
 * @returns Whether its kind belongs to the classical gate registry.
 */
export function isClassicalGate(component: SchematicComponent): component is ClassicalGateComponent {
	return CLASSICAL_GATE_KINDS.includes(component.kind as ClassicalGateComponent['kind']);
}

export function isDigitalComponent(component: SchematicComponent): component is DigitalComponent {
	return DIGITAL_COMPONENT_KINDS.includes(component.kind as DigitalComponent['kind']);
}

export function isQuantumSpecial(
	component: SchematicComponent
): component is QuantumSpecialComponent {
	return QUANTUM_SPECIAL_KINDS.includes(component.kind as QuantumSpecialComponent['kind']);
}

/** Narrow a schematic component to a first-class UML node. */
export function isUmlComponent(component: SchematicComponent): component is UmlComponent {
	return UML_COMPONENT_KINDS.includes(component.kind as UmlComponent['kind']);
}

/** Return the exact canonical turn stored by any direction-sensitive component. */
function componentTurn(component: SchematicComponent): SchematicQuarterTurn {
	return 'orientation' in component && component.orientation !== undefined
		? orientationQuarterTurn(component.orientation)
		: 0;
}

/** Rotate a canonical local coordinate and translate it to the component origin. */
function positionedQuarterPoint(
	component: SchematicComponent,
	local: SchematicPoint
): SchematicPoint {
	const rotated = rotateQuarterPoint(local, componentTurn(component));
	return { x: component.x + rotated.x, y: component.y + rotated.y };
}

/** Rotate an outward normal through the owning component's orientation. */
function positionedQuarterNormal(
	component: SchematicComponent,
	normal: SchematicPoint
): SchematicPoint {
	return rotateQuarterPoint(normal, componentTurn(component));
}

/** Physical UML body half-extents, including actor and pseudostate figures. */
function umlHalfExtents(component: UmlComponent): { halfWidth: number; halfHeight: number } {
	switch (component.kind) {
		case 'class':
		case 'interface':
		case 'enumeration':
		case 'datatype':
		case 'object':
		case 'state':
		case 'usecase':
		case 'lifeline':
		case 'note':
		case 'package':
		case 'component':
		case 'artifact':
		case 'node':
		case 'device':
		case 'execution':
		case 'system':
		case 'action':
		case 'object-node':
		case 'partition':
		case 'activation':
		case 'fragment':
		case 'interaction':
		case 'region':
			return { halfWidth: component.bodyWidth / 2, halfHeight: component.bodyHeight / 2 };
		case 'actor':
			return { halfWidth: 24, halfHeight: 50 };
		case 'initial':
		case 'final':
		case 'activity-final':
		case 'flow-final':
		case 'provided-interface':
		case 'required-interface':
		case 'component-port':
		case 'destruction':
		case 'gate':
		case 'found':
		case 'lost':
		case 'state-junction':
		case 'history':
		case 'entry':
		case 'exit':
		case 'terminate':
			return { halfWidth: 12, halfHeight: 12 };
		case 'decision':
		case 'merge':
		case 'choice':
			return { halfWidth: 18, halfHeight: 18 };
		case 'fork':
		case 'join':
			return { halfWidth: 38, halfHeight: 5 };
		case 'send-signal':
		case 'receive-signal':
			return { halfWidth: 22, halfHeight: 15 };
	}
}

/** Resolve a named UML side port, including sequence-message vertical offsets. */
function umlPortPoint(component: UmlComponent, port: string): SchematicPoint | undefined {
	const { halfWidth, halfHeight } = umlHalfExtents(component);
	if (port === 'left' || port === 'in') return { x: component.x - halfWidth, y: component.y };
	if (port === 'right' || port === 'out') return { x: component.x + halfWidth, y: component.y };
	if (port === 'top') return { x: component.x, y: component.y - halfHeight };
	if (port === 'bottom') return { x: component.x, y: component.y + halfHeight };
	if (component.kind === 'lifeline') {
		const match = port.match(/^(left|right)(\d+)$/);
		if (match) {
			const offset = Number(match[2]);
			if (offset >= 0 && offset <= component.bodyHeight) {
				return {
					x: component.x + (match[1] === 'left' ? -halfWidth : halfWidth),
					y: component.y - halfHeight + offset
				};
			}
		}
	}
	return undefined;
}

/**
 * Resolve a validated classical gate terminal to an absolute point.
 *
 * @param component - Gate owning the terminal.
 * @param port - `in`, `out`, or a validated one-based indexed variant.
 * @returns Terminal point at the fixed gate stub extent.
 */
function indexedPortPoint(component: ClassicalGateComponent, port: string): SchematicPoint {
	const output = port.startsWith('out');
	const count = output ? component.outputs : component.inputs;
	const suffix = port.match(/\d+$/)?.[0];
	const index = suffix === undefined ? 0 : Number(suffix) - 1;
	return positionedQuarterPoint(component, {
		x: output ? 48 : -48,
		y: distributedCoordinate(index, count, classicalGateHeight(component))
	});
}

/**
 * Position an already-indexed IC pin in O(1), without scanning any side list.
 *
 * @param component - Integrated circuit owning the side list.
 * @param side - Physical edge on which the pin is declared.
 * @param index - Zero-based index within that edge's pin array.
 * @returns Absolute terminal point 16 units beyond the IC body.
 * @throws {RangeError} When `index` is non-integral or outside the selected side.
 */
export function positionIcPin(
	component: IntegratedCircuitComponent,
	side: IcPinSide,
	index: number
): SchematicPoint {
	const pins = component.pins[side];
	if (!Number.isInteger(index) || index < 0 || index >= pins.length) {
		throw new RangeError(`IC pin index ${index} is outside ${component.id}.${side}.`);
	}
	let local: SchematicPoint;
	if (side === 'left' || side === 'right') {
		local = {
			x: side === 'left' ? -component.bodyWidth / 2 - 16 : component.bodyWidth / 2 + 16,
			y: distributedCoordinate(index, pins.length, component.bodyHeight)
		};
	} else {
		local = {
			x: distributedCoordinate(index, pins.length, component.bodyWidth),
			y: side === 'top' ? -component.bodyHeight / 2 - 16 : component.bodyHeight / 2 + 16
		};
	}
	return positionedQuarterPoint(component, local);
}

/** Resolve one IC pin to both its side and physical coordinate. */
function findIcPinLocation(
	component: IntegratedCircuitComponent,
	port: string
): { readonly side: IcPinSide; readonly index: number; readonly point: SchematicPoint } | undefined {
	const sides = ['left', 'right', 'top', 'bottom'] as const;
	for (const side of sides) {
		const index = component.pins[side].indexOf(port);
		if (index >= 0) return { side, index, point: positionIcPin(component, side, index) };
	}
	return undefined;
}

/** Resolve an IC alias or named pin to its physical side and point. */
function icPinLocation(
	component: IntegratedCircuitComponent,
	port: string
): { readonly side: IcPinSide; readonly point: SchematicPoint } | undefined {
	if (port === 'in' || port === 'out') {
		const canonical = findIcPinLocation(component, `${port}1`);
		if (canonical !== undefined) return canonical;
		const aliasSides = port === 'in' ? (['left', 'top'] as const) : (['right', 'bottom'] as const);
		for (const side of aliasSides) {
			if (component.pins[side].length > 0) {
				return { side, point: positionIcPin(component, side, 0) };
			}
		}
		return undefined;
	}
	return findIcPinLocation(component, port);
}

/** Map a physical component side to its outward unit normal. */
function sideNormal(side: IcPinSide): SchematicPoint {
	switch (side) {
		case 'left':
			return { x: -1, y: 0 };
		case 'right':
			return { x: 1, y: 0 };
		case 'top':
			return { x: 0, y: -1 };
		case 'bottom':
			return { x: 0, y: 1 };
	}
}

/**
 * Resolve a validated, named component port into absolute schematic coordinates.
 *
 * @param component - Component owning the previously validated terminal.
 * @param port - Canonical name or supported alias.
 * @returns Absolute terminal coordinate used by routing and interaction hotspots.
 * @throws {Error} When called with an endpoint the semantic parser did not validate.
 */
export function resolvePortPoint(component: SchematicComponent, port: string): SchematicPoint {
	if (isClassicalGate(component)) return indexedPortPoint(component, port);
	if (isUmlComponent(component)) {
		const point = umlPortPoint(component, port);
		if (point !== undefined) return point;
		throw new Error(`Validated port ${component.id}.${port} is missing.`);
	}
	if (component.kind === 'ic') {
		const location = icPinLocation(component, port);
		if (location !== undefined) return location.point;
		throw new Error(`Validated port ${component.id}.${port} is missing.`);
	}
	let local: SchematicPoint | undefined;
	const left = { x: -42, y: 0 };
	const right = { x: 42, y: 0 };
	switch (component.kind) {
		case 'resistor':
		case 'capacitor':
		case 'inductor':
			if (PASSIVE_INPUT_PORTS.has(port)) local = left;
			if (PASSIVE_OUTPUT_PORTS.has(port)) local = right;
			break;
		case 'diode':
			if (DIODE_ANODE_PORTS.has(port)) local = left;
			if (DIODE_CATHODE_PORTS.has(port)) local = right;
			break;
		case 'transistor':
			if (TRANSISTOR_CONTROL_PORTS.has(port)) local = left;
			if (TRANSISTOR_UPPER_PORTS.has(port)) local = { x: 42, y: -22 };
			if (TRANSISTOR_LOWER_PORTS.has(port)) local = { x: 42, y: 22 };
			break;
		case 'port':
			if (port === 'in') local = left;
			if (port === 'out') local = right;
			break;
		case 'ground':
			if (port === 'in') local = { x: 0, y: -42 };
			break;
		case 'hadamard':
		case 'qgate':
		case 'xgate':
		case 'ygate':
		case 'zgate':
		case 'sgate':
		case 'sdg':
		case 'tgate':
		case 'tdg':
		case 'sx':
		case 'phase':
		case 'rx':
		case 'ry':
		case 'rz':
		case 'ugate':
			if (port === 'in') local = { x: -quantumGateDimensions(component).stubExtent, y: 0 };
			if (port === 'out') local = { x: quantumGateDimensions(component).stubExtent, y: 0 };
			break;
		case 'cnot':
			if (port === 'in') local = left;
			if (port === 'out') local = right;
			if (port === 'control') local = { x: 0, y: -16 };
			if (port === 'target') local = { x: 0, y: 16 };
			break;
		case 'junction':
		case 'testpoint':
			local = { x: 0, y: 0 };
			break;
		case 'connector':
			local = port === 'out' ? { x: 32, y: 0 } : { x: -32, y: 0 };
			break;
		case 'source':
			if (port === 'in' || port === 'negative') local = left;
			else if (port === 'out' || port === 'positive') local = right;
			else local = { x: 0, y: port === 'control-positive' ? -34 : 34 };
			break;
		case 'power':
			local = { x: -32, y: 0 };
			break;
		case 'switch':
			if (port === 'in' || port === 'common') local = left;
			else if (port === 'normally-open') local = { x: 42, y: -12 };
			else if (port === 'normally-closed') local = { x: 42, y: 12 };
			else if (port === 'coil1') local = { x: -12, y: 34 };
			else if (port === 'coil2') local = { x: 12, y: 34 };
			else local = right;
			break;
		case 'amplifier':
			if (port === 'out') local = { x: 48, y: 0 };
			else if (port === 'v+') local = { x: 0, y: -36 };
			else if (port === 'v-') local = { x: 0, y: 36 };
			else local = { x: -48, y: port === 'negative' ? 13 : -13 };
			break;
		case 'protection':
		case 'resonator':
		case 'meter':
		case 'load':
			local = port === 'out' ? right : left;
			break;
		case 'buffer':
		case 'logic':
		case 'clock':
		case 'flipflop':
		case 'mux':
		case 'encoder':
		case 'decoder':
		case 'register':
		case 'counter':
		case 'adder':
		case 'comparator':
		case 'bus': {
			const output = port === 'out' || port.startsWith('out') || ['q', 'nq', 'gt', 'eq', 'lt', 'tap'].includes(port) || (component.kind === 'bus' && component.variant === 'joiner' && port === 'bus');
			const match = port.match(/\d+$/);
			const count = output ? component.outputs : component.inputs;
			const index = match === null ? 0 : Number(match[0]) - 1;
			if (port === 'clock' || port === 'enable' || port === 'select') local = { x: 0, y: component.bodyHeight / 2 + 16 };
			else if (port === 'preset' || port === 'clear') local = { x: 0, y: -component.bodyHeight / 2 - 16 };
			else local = {
				x: (output ? 1 : -1) * (component.bodyWidth / 2 + 16),
				y: distributedCoordinate(index, Math.max(1, count), component.bodyHeight)
			};
			break;
		}
		case 'measure':
			if (port === 'classical') local = { x: 0, y: 34 };
			else local = port === 'out' ? { x: 40, y: 0 } : { x: -40, y: 0 };
			break;
		case 'prepare':
			local = { x: 40, y: 0 };
			break;
		case 'control':
			local = port === 'control' ? { x: 0, y: 0 } : port === 'out' ? right : left;
			break;
		case 'reset':
		case 'classical-bit':
		case 'classical-register':
			local = port === 'out' ? { x: 40, y: 0 } : { x: -40, y: 0 };
			break;
		case 'swap':
		case 'cz':
		case 'cphase':
		case 'toffoli':
		case 'controlled':
		case 'barrier':
		case 'delay': {
			const indexed = port.match(/^(?:in|out|control|target)([1-9]\d*)$/);
			let index = indexed === null ? 0 : Number(indexed[1]) - 1;
			if (port.startsWith('target')) index += component.controls;
			const tracks = Math.max(component.wires, component.controls + component.targets);
			if (port.startsWith('control') || port.startsWith('target')) {
				local = { x: 0, y: quantumTrackCoordinate(index, tracks) };
			} else {
				local = {
					x: port.startsWith('out') ? 42 : -42,
					y: quantumTrackCoordinate(index, tracks)
				};
			}
				break;
			}
	}
	if (local !== undefined) return positionedQuarterPoint(component, local);
	throw new Error(`Validated port ${component.id}.${port} is missing.`);
}

/** Resolve a port coordinate together with the direction a route must initially travel. */
export function resolvePortGeometry(
	component: SchematicComponent,
	port: string
): { readonly point: SchematicPoint; readonly normal: SchematicPoint } {
	const point = resolvePortPoint(component, port);
	if (isClassicalGate(component)) {
		return {
			point,
			normal: positionedQuarterNormal(component, port.startsWith('out') ? { x: 1, y: 0 } : { x: -1, y: 0 })
		};
	}
	if (isUmlComponent(component)) {
		if (port === 'left' || port === 'in' || port.startsWith('left')) {
			return { point, normal: { x: -1, y: 0 } };
		}
		if (port === 'right' || port === 'out' || port.startsWith('right')) {
			return { point, normal: { x: 1, y: 0 } };
		}
		return { point, normal: port === 'top' ? { x: 0, y: -1 } : { x: 0, y: 1 } };
	}
	const geometry = (normal: SchematicPoint) => ({
		point,
		normal: positionedQuarterNormal(component, normal)
	});
	switch (component.kind) {
		case 'resistor':
		case 'capacitor':
		case 'inductor':
			return geometry(PASSIVE_OUTPUT_PORTS.has(port) ? { x: 1, y: 0 } : { x: -1, y: 0 });
		case 'diode':
			return geometry(DIODE_CATHODE_PORTS.has(port) ? { x: 1, y: 0 } : { x: -1, y: 0 });
		case 'transistor':
			return geometry(TRANSISTOR_CONTROL_PORTS.has(port) ? { x: -1, y: 0 } : { x: 1, y: 0 });
		case 'port':
		case 'hadamard':
		case 'qgate':
		case 'xgate':
		case 'ygate':
		case 'zgate':
		case 'sgate':
		case 'sdg':
		case 'tgate':
		case 'tdg':
		case 'sx':
		case 'phase':
		case 'rx':
		case 'ry':
		case 'rz':
		case 'ugate':
		case 'connector':
		case 'protection':
		case 'resonator':
		case 'meter':
		case 'load':
		case 'reset':
		case 'prepare':
		case 'classical-bit':
		case 'classical-register':
			return geometry(port === 'out' ? { x: 1, y: 0 } : { x: -1, y: 0 });
		case 'ground':
			return geometry({ x: 0, y: -1 });
		case 'cnot':
			if (port === 'control') return geometry({ x: 0, y: -1 });
			if (port === 'target') return geometry({ x: 0, y: 1 });
			return geometry(port === 'out' ? { x: 1, y: 0 } : { x: -1, y: 0 });
		case 'ic': {
			const location = icPinLocation(component, port)!;
			return geometry(sideNormal(location.side));
		}
		case 'junction':
		case 'testpoint':
			return geometry(port === 'out' ? { x: 1, y: 0 } : { x: -1, y: 0 });
		case 'source':
			if (port.startsWith('control-')) return geometry({ x: 0, y: port.endsWith('positive') ? -1 : 1 });
			return geometry(port === 'out' || port === 'positive' ? { x: 1, y: 0 } : { x: -1, y: 0 });
		case 'power':
			return geometry({ x: -1, y: 0 });
		case 'switch':
			if (port.startsWith('coil')) return geometry({ x: 0, y: 1 });
			return geometry(port === 'in' || port === 'common' ? { x: -1, y: 0 } : { x: 1, y: 0 });
		case 'amplifier':
			if (port === 'v+' || port === 'v-') return geometry({ x: 0, y: port === 'v+' ? -1 : 1 });
			return geometry(port === 'out' ? { x: 1, y: 0 } : { x: -1, y: 0 });
		case 'buffer':
		case 'logic':
		case 'clock':
		case 'flipflop':
		case 'mux':
		case 'encoder':
		case 'decoder':
		case 'register':
		case 'counter':
		case 'adder':
		case 'comparator':
		case 'bus':
			if (['clock', 'enable', 'select'].includes(port)) return geometry({ x: 0, y: 1 });
			if (['preset', 'clear'].includes(port)) return geometry({ x: 0, y: -1 });
			return geometry(port === 'out' || port.startsWith('out') || ['q', 'nq', 'gt', 'eq', 'lt', 'tap'].includes(port) || (component.kind === 'bus' && component.variant === 'joiner' && port === 'bus') ? { x: 1, y: 0 } : { x: -1, y: 0 });
		case 'measure':
			return geometry(port === 'classical' ? { x: 0, y: 1 } : port === 'out' ? { x: 1, y: 0 } : { x: -1, y: 0 });
		case 'control':
			return geometry(port === 'control' ? { x: 0, y: -1 } : port === 'out' ? { x: 1, y: 0 } : { x: -1, y: 0 });
		case 'swap':
		case 'cz':
		case 'cphase':
		case 'toffoli':
		case 'controlled':
		case 'barrier':
		case 'delay':
			return geometry(port.startsWith('out') ? { x: 1, y: 0 } : port.startsWith('in') ? { x: -1, y: 0 } : { x: 0, y: -1 });
	}
	/* v8 ignore next -- resolvePortPoint proves the discriminated port cases above. */
	throw new Error(`Validated port ${port} is missing.`);
}

/**
 * Construct a canonical port descriptor through the shared resolution path.
 *
 * @param component - Port-owning component.
 * @param id - Canonical terminal name.
 * @returns Port name paired with its absolute coordinate.
 */
function namedPort(component: SchematicComponent, id: string): ComponentPort {
	return { id, ...resolvePortGeometry(component, id) };
}

/**
 * Enumerate each physical terminal exactly once. Alias spellings deliberately resolve through
 * `resolvePortPoint` but do not create duplicate interactive targets.
 *
 * @param component - Component whose canonical terminals should be exposed.
 * @returns Port descriptors in stable physical/source order.
 */
export function enumerateComponentPorts(component: SchematicComponent): readonly ComponentPort[] {
	if (isClassicalGate(component)) {
		return [
			...Array.from({ length: component.inputs }, (_, index) =>
				namedPort(component, `in${index + 1}`)
			),
			...Array.from({ length: component.outputs }, (_, index) =>
				namedPort(component, `out${index + 1}`)
			)
		];
	}
	if (isDigitalComponent(component)) {
		let ports = [
			...Array.from({ length: component.inputs }, (_, index) => `in${index + 1}`),
			...Array.from({ length: component.outputs }, (_, index) => `out${index + 1}`)
		];
		if (component.kind === 'logic' || component.kind === 'clock') ports = ['out'];
		else if (component.kind === 'flipflop') {
			const inputs = component.variant === 'jk' ? ['j', 'k', 'clock'] : component.variant === 't' ? ['t', 'clock', 'clear'] : component.variant === 'sr-latch' ? ['s', 'r', 'enable'] : ['d', 'clock', 'clear'];
			ports = [...inputs, 'q', 'nq', 'preset'];
		} else if (component.kind === 'register') ports = ['in', 'out', 'clock', 'enable', 'clear'];
		else if (component.kind === 'counter') ports.push('clock', 'enable', 'clear');
		else if (component.kind === 'mux') ports.push('select', 'enable');
		else if (component.kind === 'comparator') ports = ['in1', 'in2', 'gt', 'eq', 'lt'];
		else if (component.kind === 'bus') {
			ports = component.variant === 'tap' ? ['bus', 'tap'] : component.variant === 'joiner' ? [...Array.from({ length: component.inputs }, (_, index) => `in${index + 1}`), 'bus'] : ['bus', ...Array.from({ length: component.outputs }, (_, index) => `out${index + 1}`)];
		} else if (component.kind === 'buffer' && component.variant?.startsWith('tristate') === true) ports.push('enable');
		return ports.map((port) => namedPort(component, port));
	}
	if (isQuantumSpecial(component)) {
		if (component.kind === 'prepare') return [namedPort(component, 'out')];
		if (component.kind === 'measure') return ['in', 'out', 'classical'].map((port) => namedPort(component, port));
		if (component.kind === 'control') return ['in', 'out', 'control'].map((port) => namedPort(component, port));
		if (component.kind === 'reset' || component.kind === 'classical-bit' || component.kind === 'classical-register') {
			return ['in', 'out'].map((port) => namedPort(component, port));
		}
		const tracks = Math.max(component.wires, component.controls + component.targets);
		return [
			...Array.from({ length: tracks }, (_, index) => namedPort(component, `in${index + 1}`)),
			...Array.from({ length: tracks }, (_, index) => namedPort(component, `out${index + 1}`)),
			...Array.from({ length: component.controls }, (_, index) => namedPort(component, `control${index + 1}`)),
			...Array.from({ length: component.targets }, (_, index) => namedPort(component, `target${index + 1}`))
		];
	}
	if (isUmlComponent(component)) {
		return ['left', 'right', 'top', 'bottom'].map((port) => namedPort(component, port));
	}
	switch (component.kind) {
		case 'resistor':
		case 'capacitor':
		case 'inductor':
		case 'port':
		case 'hadamard':
		case 'qgate':
		case 'xgate':
		case 'ygate':
		case 'zgate':
		case 'sgate':
		case 'sdg':
		case 'tgate':
		case 'tdg':
		case 'sx':
		case 'phase':
		case 'rx':
		case 'ry':
		case 'rz':
		case 'ugate':
		case 'connector':
		case 'protection':
		case 'resonator':
		case 'meter':
		case 'load':
			return [namedPort(component, 'in'), namedPort(component, 'out')];
		case 'diode':
			return [namedPort(component, 'anode'), namedPort(component, 'cathode')];
		case 'transistor': {
			const bipolar = component.transistorType === 'npn' || component.transistorType === 'pnp';
			return bipolar
				? [
						namedPort(component, 'base'),
						namedPort(component, 'collector'),
						namedPort(component, 'emitter')
					]
				: [
						namedPort(component, 'gate'),
						namedPort(component, 'drain'),
						namedPort(component, 'source')
					];
		}
		case 'ground':
			return [namedPort(component, 'in')];
		case 'cnot':
			return [
				namedPort(component, 'in'),
				namedPort(component, 'out'),
				namedPort(component, 'control'),
				namedPort(component, 'target')
			];
		case 'junction':
		case 'testpoint':
			return [namedPort(component, 'node')];
		case 'source': {
			const ports = ['negative', 'positive'];
			if (component.variant !== undefined && ['vcvs', 'vccs', 'ccvs', 'cccs'].includes(component.variant)) {
				ports.push('control-positive', 'control-negative');
			}
			return ports.map((port) => namedPort(component, port));
		}
		case 'power':
			return [namedPort(component, 'in')];
		case 'switch': {
			const ports = component.variant === 'spdt'
				? ['common', 'normally-open', 'normally-closed']
				: component.variant === 'relay'
					? ['in', 'out', 'coil1', 'coil2']
					: ['in', 'out'];
			return ports.map((port) => namedPort(component, port));
		}
		case 'amplifier':
			return ['positive', 'negative', 'out', 'v+', 'v-'].map((port) => namedPort(component, port));
		case 'ic': {
			const sides = ['left', 'right', 'top', 'bottom'] as const;
			return sides.flatMap((side) =>
				component.pins[side].map((id, index) => ({
					id,
					point: positionIcPin(component, side, index),
					normal: positionedQuarterNormal(component, sideNormal(side))
				}))
			);
		}
	}
}

/**
 * Resolve a connection endpoint through the document component index.
 *
 * @param endpoint - Validated component/port pair.
 * @param components - Complete document component map.
 * @returns Absolute terminal coordinate.
 * @throws {Error} If a post-validation caller supplies an inconsistent map.
 */
/** Resolve a validated endpoint to its component and outward-facing port geometry. */
function endpointGeometry(
	endpoint: SchematicEndpoint,
	components: ReadonlyMap<string, SchematicComponent>
): { readonly component: SchematicComponent; readonly point: SchematicPoint; readonly normal: SchematicPoint } {
	const component = components.get(endpoint.componentId);
	if (component === undefined) {
		throw new Error(`Validated component ${endpoint.componentId} is missing.`);
	}
	return { component, ...resolvePortGeometry(component, endpoint.port) };
}

/**
 * Compare two generated points using the renderer's three-decimal tolerance.
 *
 * @param left - First point.
 * @param right - Second point.
 * @returns Whether both coordinates differ by less than half a thousandth.
 */
function samePoint(left: SchematicPoint, right: SchematicPoint): boolean {
	return Math.abs(left.x - right.x) < 0.0005 && Math.abs(left.y - right.y) < 0.0005;
}

/**
 * Remove duplicate points and redundant collinear corners from an orthogonal route.
 *
 * @param points - Candidate points in traversal order.
 * @returns New minimal mutable point array preserving route direction.
 */
function compactOrthogonalPoints(points: readonly SchematicPoint[]): SchematicPoint[] {
	const deduplicated: SchematicPoint[] = [];
	for (const point of points) {
		if (!samePoint(deduplicated.at(-1) ?? { x: Number.NaN, y: Number.NaN }, point)) {
			deduplicated.push(point);
		}
	}
	let index = 1;
	while (index < deduplicated.length - 1) {
		const previous = deduplicated[index - 1]!;
		const current = deduplicated[index]!;
		const next = deduplicated[index + 1]!;
		if (
			(previous.x === current.x && current.x === next.x) ||
			(previous.y === current.y && current.y === next.y)
		) {
			deduplicated.splice(index, 1);
			continue;
		}
		index += 1;
	}
	return deduplicated;
}

/**
 * Serialize compact orthogonal points using horizontal and vertical SVG commands.
 *
 * @param points - At least one point in traversal order.
 * @returns Compact absolute SVG path data.
 */
function orthogonalPath(points: readonly SchematicPoint[]): string {
	const first = points[0]!;
	let path = `M ${formatNumber(first.x)} ${formatNumber(first.y)}`;
	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1]!;
		const point = points[index]!;
		if (previous.y === point.y) path += ` H ${formatNumber(point.x)}`;
		else path += ` V ${formatNumber(point.y)}`;
	}
	return path;
}

/**
 * Expand the intrinsic component body AABB by a routing clearance.
 *
 * External labels are deliberately excluded so wires can pass through text rows
 * while remaining clear of physical symbols and terminals.
 *
 * @param component - Component whose body extents are required.
 * @param clearance - Non-negative expansion in viewBox units.
 * @returns Expanded obstacle rectangle.
 */
function expandedComponentRectangle(
	component: SchematicComponent,
	clearance: number
): SchematicRectangle {
	const { halfWidth, halfHeight } = componentHalfExtents(component);
	return {
		minX: component.x - halfWidth - clearance,
		minY: component.y - halfHeight - clearance,
		maxX: component.x + halfWidth + clearance,
		maxY: component.y + halfHeight + clearance
	};
}

/**
 * Return the AABB used by orthogonal routing, including engineering clearance.
 *
 * @param component - Component treated as a routing obstacle.
 * @param clearance - Optional non-negative margin; defaults to 12 units.
 * @returns Expanded physical-body rectangle.
 * @throws {RangeError} For negative or non-finite clearance values.
 */
export function componentObstacleRectangle(
	component: SchematicComponent,
	clearance = SCHEMATIC_OBSTACLE_CLEARANCE
): SchematicRectangle {
	if (!Number.isFinite(clearance) || clearance < 0) {
		throw new RangeError('Component obstacle clearance must be a finite non-negative number.');
	}
	return expandedComponentRectangle(component, clearance);
}

/**
 * Detect a strict interior intersection between an arbitrary line segment and AABB.
 *
 * Liang-Barsky clipping keeps boundary-tangent traces legal while covering
 * diagonal manual routes as rigorously as orthogonal router segments.
 *
 * @param start - Segment origin.
 * @param end - Segment destination.
 * @param rectangle - Obstacle to test.
 * @returns Whether the segment penetrates the rectangle interior.
 */
function segmentIntersectsRectangle(
	start: SchematicPoint,
	end: SchematicPoint,
	rectangle: SchematicRectangle
): boolean {
	if (start.y === end.y) {
		return (
			start.y > rectangle.minY &&
			start.y < rectangle.maxY &&
			Math.max(start.x, end.x) > rectangle.minX &&
			Math.min(start.x, end.x) < rectangle.maxX
		);
	}
	if (start.x === end.x) {
		return (
			start.x > rectangle.minX &&
			start.x < rectangle.maxX &&
			Math.max(start.y, end.y) > rectangle.minY &&
			Math.min(start.y, end.y) < rectangle.maxY
		);
	}
	let minimum = 0;
	let maximum = 1;
	for (const [origin, delta, low, high] of [
		[start.x, end.x - start.x, rectangle.minX, rectangle.maxX],
		[start.y, end.y - start.y, rectangle.minY, rectangle.maxY]
	] as const) {
		const first = (low - origin) / delta;
		const second = (high - origin) / delta;
		minimum = Math.max(minimum, Math.min(first, second));
		maximum = Math.min(maximum, Math.max(first, second));
		if (minimum >= maximum) return false;
	}
	return maximum > 0 && minimum < 1;
}

/** Conservative geometrically bounded subdivision test for a cubic Bézier against an AABB. */
function cubicIntersectsRectangle(
	points: readonly [SchematicPoint, SchematicPoint, SchematicPoint, SchematicPoint],
	rectangle: SchematicRectangle
): boolean {
	const minX = Math.min(...points.map((point) => point.x));
	const minY = Math.min(...points.map((point) => point.y));
	const maxX = Math.max(...points.map((point) => point.x));
	const maxY = Math.max(...points.map((point) => point.y));
	if (
		maxX <= rectangle.minX ||
		minX >= rectangle.maxX ||
		maxY <= rectangle.minY ||
		minY >= rectangle.maxY
	) {
		return false;
	}
	if (maxX - minX <= 0.25 && maxY - minY <= 0.25) return true;
	const midpoint = (left: SchematicPoint, right: SchematicPoint): SchematicPoint => ({
		x: (left.x + right.x) / 2,
		y: (left.y + right.y) / 2
	});
	const [a, b, c, d] = points;
	const ab = midpoint(a, b);
	const bc = midpoint(b, c);
	const cd = midpoint(c, d);
	const abc = midpoint(ab, bc);
	const bcd = midpoint(bc, cd);
	const center = midpoint(abc, bcd);
	return (
		cubicIntersectsRectangle([a, ab, abc, center], rectangle) ||
		cubicIntersectsRectangle([center, bcd, cd, d], rectangle)
	);
}

/** Test whether any segment in a candidate penetrates an obstacle. */
function routeIntersectsObstacles(
	points: readonly SchematicPoint[],
	obstacles: readonly SchematicRectangle[]
): boolean {
	for (let index = 1; index < points.length; index += 1) {
		for (const obstacle of obstacles) {
			if (segmentIntersectsRectangle(points[index - 1]!, points[index]!, obstacle)) return true;
		}
	}
	return false;
}

/**
 * Measure Manhattan length of a candidate orthogonal route.
 *
 * @param points - Route points in traversal order.
 * @returns Sum of horizontal and vertical segment lengths.
 */
function candidateLength(points: readonly SchematicPoint[]): number {
	let length = 0;
	for (let index = 1; index < points.length; index += 1) {
		length +=
			Math.abs(points[index]!.x - points[index - 1]!.x) +
			Math.abs(points[index]!.y - points[index - 1]!.y);
	}
	return length;
}

/** Count bends in an already orthogonal candidate. */
function candidateBends(points: readonly SchematicPoint[]): number {
	return Math.max(0, points.length - 2);
}

/** Deterministic minimum heap used by the bounded sparse Manhattan fallback. */
class RouteHeap {
	readonly #items: { state: number; cell: number; direction: number; g: number; f: number }[] = [];

	get size(): number {
		return this.#items.length;
	}

	push(item: { state: number; cell: number; direction: number; g: number; f: number }): void {
		this.#items.push(item);
		let index = this.#items.length - 1;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (!RouteHeap.before(item, this.#items[parent]!)) break;
			this.#items[index] = this.#items[parent]!;
			index = parent;
		}
		this.#items[index] = item;
	}

	pop(): { state: number; cell: number; direction: number; g: number; f: number } | undefined {
		const first = this.#items[0];
		const last = this.#items.pop();
		if (first === undefined || last === undefined || this.#items.length === 0) return first;
		let index = 0;
		while (true) {
			const left = index * 2 + 1;
			if (left >= this.#items.length) break;
			const right = left + 1;
			const child =
				right < this.#items.length && RouteHeap.before(this.#items[right]!, this.#items[left]!)
					? right
					: left;
			if (!RouteHeap.before(this.#items[child]!, last)) break;
			this.#items[index] = this.#items[child]!;
			index = child;
		}
		this.#items[index] = last;
		return first;
	}

	static before(
		left: { state: number; g: number; f: number },
		right: { state: number; g: number; f: number }
	): boolean {
		return left.f !== right.f
			? left.f < right.f
			: left.g !== right.g
				? left.g < right.g
				: left.state < right.state;
	}
}

function uniqueSorted(values: readonly number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

/** Sparse compressed-grid A* used only when all one-channel candidates are blocked. */
function searchOrthogonalRoute(
	start: SchematicPoint,
	end: SchematicPoint,
	obstacles: readonly SchematicRectangle[],
	bounds: SchematicBounds | undefined,
	line: number
): SchematicPoint[] | undefined {
	const withinX = (value: number) => bounds === undefined || (value >= 0 && value <= bounds.width);
	const withinY = (value: number) => bounds === undefined || (value >= 0 && value <= bounds.height);
	/* v8 ignore next -- unbounded routing normally resolves in the one-channel fast path. */
	const boundaryXs = bounds === undefined ? [] : [0, bounds.width];
	/* v8 ignore next -- unbounded routing normally resolves in the one-channel fast path. */
	const boundaryYs = bounds === undefined ? [] : [0, bounds.height];
	const xs = uniqueSorted([
		start.x,
		end.x,
		...boundaryXs,
		...obstacles.flatMap((obstacle) => [obstacle.minX, obstacle.maxX]).filter(withinX)
	]);
	const ys = uniqueSorted([
		start.y,
		end.y,
		...boundaryYs,
		...obstacles.flatMap((obstacle) => [obstacle.minY, obstacle.maxY]).filter(withinY)
	]);
	const width = xs.length;
	const startX = xs.indexOf(start.x);
	const startY = ys.indexOf(start.y);
	const endX = xs.indexOf(end.x);
	const endY = ys.indexOf(end.y);
	const startCell = startY * width + startX;
	const endCell = endY * width + endX;
	const stateId = (cell: number, direction: number) => cell * 3 + direction;
	const gScore = new Map<number, number>();
	const previous = new Map<number, number>();
	const heap = new RouteHeap();
	const startState = stateId(startCell, 0);
	gScore.set(startState, 0);
	heap.push({
		state: startState,
		cell: startCell,
		direction: 0,
		g: 0,
		f: Math.abs(start.x - end.x) + Math.abs(start.y - end.y)
	});
	let expanded = 0;
	let finalState: number | undefined;
	while (heap.size > 0 && expanded < MAX_ROUTER_STATES) {
		const current = heap.pop()!;
		if (current.g !== gScore.get(current.state)) continue;
		if (current.cell === endCell) {
			finalState = current.state;
			break;
		}
		expanded += 1;
		const xIndex = current.cell % width;
		const yIndex = Math.floor(current.cell / width);
		const from = { x: xs[xIndex]!, y: ys[yIndex]! };
		const neighbors = [
			[xIndex - 1, yIndex, 1],
			[xIndex + 1, yIndex, 1],
			[xIndex, yIndex - 1, 2],
			[xIndex, yIndex + 1, 2]
		] as const;
		for (const [nextX, nextY, direction] of neighbors) {
			if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= ys.length) continue;
			const to = { x: xs[nextX]!, y: ys[nextY]! };
			let blocked = false;
			for (const obstacle of obstacles) {
				if (segmentIntersectsRectangle(from, to, obstacle)) {
					blocked = true;
					break;
				}
			}
			if (blocked) continue;
			const cell = nextY * width + nextX;
			const state = stateId(cell, direction);
			const bend = current.direction !== 0 && current.direction !== direction;
			const g =
				current.g + Math.abs(from.x - to.x) + Math.abs(from.y - to.y) + (bend ? ROUTER_BEND_PENALTY : 0);
			if (g >= (gScore.get(state) ?? Number.POSITIVE_INFINITY)) continue;
			gScore.set(state, g);
			previous.set(state, current.state);
			heap.push({
				state,
				cell,
				direction,
				g,
				f: g + Math.abs(to.x - end.x) + Math.abs(to.y - end.y)
			});
		}
	}
	/* v8 ignore next -- exercising the hard ceiling would make the unit suite allocate 40,000 states. */
	if (finalState === undefined && heap.size > 0 && expanded >= MAX_ROUTER_STATES) {
		throw new SchematicSyntaxError(
			`Orthogonal routing complexity exceeds ${MAX_ROUTER_STATES.toLocaleString('en-US')} search states.`,
			line
		);
	}
	if (finalState === undefined) return undefined;
	const reversed: SchematicPoint[] = [];
	let state: number | undefined = finalState;
	while (state !== undefined) {
		const cell = Math.floor(state / 3);
		reversed.push({ x: xs[cell % width]!, y: ys[Math.floor(cell / width)]! });
		state = previous.get(state);
	}
	return compactOrthogonalPoints(reversed.reverse());
}

/** Find the shortest collision-free one-channel route before invoking sparse A*. */
function routeBetweenEscapes(
	start: SchematicPoint,
	end: SchematicPoint,
	obstacles: readonly SchematicRectangle[],
	bounds: SchematicBounds | undefined,
	line: number
): SchematicPoint[] | undefined {
	const middleX = (start.x + end.x) / 2;
	const direct = compactOrthogonalPoints([
		start,
		{ x: middleX, y: start.y },
		{ x: middleX, y: end.y },
		end
	]);
	if (!routeIntersectsObstacles(direct, obstacles)) return direct;
	const candidates: SchematicPoint[][] = [];
	const yLanes = uniqueSorted([
		start.y,
		end.y,
		...(bounds === undefined ? [] : [0, bounds.height]),
		...obstacles.flatMap((obstacle) => [obstacle.minY, obstacle.maxY])
	]);
	for (const y of yLanes) {
		if (bounds !== undefined && (y < 0 || y > bounds.height)) continue;
		candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);
	}
	const xLanes = uniqueSorted([
		start.x,
		end.x,
		...(bounds === undefined ? [] : [0, bounds.width]),
		...obstacles.flatMap((obstacle) => [obstacle.minX, obstacle.maxX])
	]);
	for (const x of xLanes) {
		if (bounds !== undefined && (x < 0 || x > bounds.width)) continue;
		candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
	}
	let best: SchematicPoint[] | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const raw of candidates) {
		const candidate = compactOrthogonalPoints(raw);
		if (routeIntersectsObstacles(candidate, obstacles)) continue;
		const score = candidateLength(candidate) + candidateBends(candidate) * ROUTER_BEND_PENALTY;
		if (score < bestScore) {
			best = candidate;
			bestScore = score;
		}
	}
	return best ?? searchOrthogonalRoute(start, end, obstacles, bounds, line);
}

/**
 * Calculate a deterministic line, cubic Bézier, or orthogonal trace.
 *
 * @param connection - Validated directed connection.
 * @param components - Complete component map used for endpoint and obstacle lookup.
 * @returns SVG path data plus control/corner points for later bounds checks.
 */
interface CachedObstacle {
	readonly id: string;
	readonly expanded: SchematicRectangle;
	readonly body: SchematicRectangle;
}

/** Conservative along-path length and half-width for one SVG signal marker. */
function markerCollisionSize(
	marker: SchematicConnection['markerStart']
): { readonly length: number; readonly radius: number } {
	switch (marker) {
		case 'dot':
			return { length: 4, radius: 4 };
		case 'arrow':
			return { length: 8, radius: 4 };
		case 'open-arrow':
			return { length: 9, radius: 5 };
		case 'triangle':
		case 'diamond':
		case 'diamond-filled':
			return { length: 12, radius: 6 };
		default:
			return { length: 0, radius: 0 };
	}
}

/** Validate transformed marker footprints against every unrelated component body. */
function validateMarkerCollisions(
	connection: SchematicConnection,
	route: RoutedConnection,
	obstacles: readonly CachedObstacle[],
	fromId: string,
	toId: string
): RoutedConnection {
	if (connection.markerStart === 'none' && connection.markerEnd === 'none') return route;
	for (const [atStart, marker] of [
		[true, connection.markerStart],
		[false, connection.markerEnd]
	] as const) {
		const size = markerCollisionSize(marker);
		if (size.length === 0) continue;
		const endpoint = atStart ? route.points[0]! : route.points.at(-1)!;
		const adjacent = atStart ? route.points[1]! : route.points.at(-2)!;
		const dx = adjacent.x - endpoint.x;
		const dy = adjacent.y - endpoint.y;
		const magnitude = Math.hypot(dx, dy);
		/* v8 ignore next -- validated routes always contain a non-degenerate endpoint span. */
		if (magnitude === 0) continue;
		const inward = {
			x: endpoint.x + (dx / magnitude) * size.length,
			y: endpoint.y + (dy / magnitude) * size.length
		};
		for (const obstacle of obstacles) {
			if (obstacle.id === fromId || obstacle.id === toId) continue;
			const expanded = {
				minX: obstacle.body.minX - size.radius,
				minY: obstacle.body.minY - size.radius,
				maxX: obstacle.body.maxX + size.radius,
				maxY: obstacle.body.maxY + size.radius
			};
			if (segmentIntersectsRectangle(endpoint, inward, expanded)) {
				throw new SchematicSyntaxError(
					`${marker} marker intersects ${obstacle.id}; use ortho or move the obstacle.`,
					connection.line
				);
			}
		}
	}
	return route;
}

/** Whether aligned terminal normals point directly toward one another. */
function endpointsFaceEachOther(
	from: { readonly point: SchematicPoint; readonly normal: SchematicPoint },
	to: { readonly point: SchematicPoint; readonly normal: SchematicPoint }
): boolean {
	const dx = to.point.x - from.point.x;
	const dy = to.point.y - from.point.y;
	if (dy === 0 && dx !== 0) {
		const direction = Math.sign(dx);
		return from.normal.x === direction && to.normal.x === -direction;
	}
	if (dx === 0 && dy !== 0) {
		const direction = Math.sign(dy);
		return from.normal.y === direction && to.normal.y === -direction;
	}
	return false;
}

/** Internal route implementation accepting document-scoped obstacle geometry. */
function routeConnectionInternal(
	connection: SchematicConnection,
	components: ReadonlyMap<string, SchematicComponent>,
	bounds: SchematicBounds | undefined,
	cachedObstacles: readonly CachedObstacle[] | undefined
): RoutedConnection {
	const from = endpointGeometry(connection.from, components);
	const to = endpointGeometry(connection.to, components);
	const start = from.point;
	const end = to.point;
	const sx = formatNumber(start.x);
	const sy = formatNumber(start.y);
	const ex = formatNumber(end.x);
	const ey = formatNumber(end.y);
	const obstacleCache =
		cachedObstacles ??
		Array.from(components.values(), (component) => ({
			id: component.id,
			expanded: componentObstacleRectangle(component),
			body: componentObstacleRectangle(component, 0)
		}));
	if (connection.curve === 'bezier') {
		const middleX = (start.x + end.x) / 2;
		const controlA = { x: middleX, y: start.y };
		const controlB = { x: middleX, y: end.y };
		for (const obstacle of obstacleCache) {
			if (
				obstacle.id !== from.component.id &&
				obstacle.id !== to.component.id &&
				cubicIntersectsRectangle([start, controlA, controlB, end], obstacle.body)
			) {
				throw new SchematicSyntaxError(
					`Bézier route intersects ${obstacle.id}; use an orthogonal route or move the obstacle.`,
					connection.line
				);
			}
		}
		return validateMarkerCollisions(connection, {
			curve: 'bezier',
			d: `M ${sx} ${sy} C ${formatNumber(controlA.x)} ${formatNumber(controlA.y)}, ${formatNumber(controlB.x)} ${formatNumber(controlB.y)}, ${ex} ${ey}`,
			points: [start, controlA, controlB, end]
		}, obstacleCache, from.component.id, to.component.id);
	}
	if (connection.curve === 'ortho') {
		if (
			from.component.id !== to.component.id &&
			endpointsFaceEachOther(from, to) &&
			!obstacleCache.some(
				(entry) =>
					entry.id !== from.component.id &&
					entry.id !== to.component.id &&
					segmentIntersectsRectangle(start, end, entry.expanded)
			)
		) {
			return validateMarkerCollisions(
				connection,
				{ curve: 'ortho', d: orthogonalPath([start, end]), points: [start, end] },
				obstacleCache,
				from.component.id,
				to.component.id
			);
		}
		const fromObstacle = componentObstacleRectangle(from.component);
		const toObstacle = componentObstacleRectangle(to.component);
		const escape = (
			geometry: { readonly point: SchematicPoint; readonly normal: SchematicPoint },
			obstacle: SchematicRectangle
		): SchematicPoint => ({
			x:
				geometry.normal.x < 0
					? obstacle.minX
					: geometry.normal.x > 0
						? obstacle.maxX
						: geometry.point.x,
			y:
				geometry.normal.y < 0
					? obstacle.minY
					: geometry.normal.y > 0
						? obstacle.maxY
						: geometry.point.y
		});
		const startEscape = escape(from, fromObstacle);
		const endEscape = escape(to, toObstacle);
		const obstacleRectangle = (entry: CachedObstacle): SchematicRectangle =>
			entry.id === from.component.id || entry.id === to.component.id ? entry.body : entry.expanded;
		const obstacleRectangles = obstacleCache.map(obstacleRectangle);
		const middle = routeBetweenEscapes(
			startEscape,
			endEscape,
			obstacleRectangles,
			bounds,
			connection.line
		);
		if (middle === undefined) {
			throw new SchematicSyntaxError('No collision-free orthogonal route exists.', connection.line);
		}
		const points = compactOrthogonalPoints([start, ...middle, end]);
		/*
		 * The final guard rejects only physical body clips. Escape stubs merged into
		 * the first or last segment legitimately pass through a *neighbor's* clearance
		 * ring whenever components sit closer than twice the routing margin, so
		 * validating expanded rectangles here would fail dense-but-clean diagrams.
		 */
		for (let index = 1; index < points.length; index += 1) {
			const allowFrom = index === 1;
			const allowTo = index === points.length - 1;
			for (const obstacle of obstacleCache) {
				if (
					!(allowFrom && obstacle.id === from.component.id) &&
					!(allowTo && obstacle.id === to.component.id) &&
					segmentIntersectsRectangle(points[index - 1]!, points[index]!, obstacle.body)
				) {
					throw new SchematicSyntaxError(
						`Orthogonal route intersects ${obstacle.id} after routing.`,
						connection.line
					);
				}
			}
		}
		return validateMarkerCollisions(connection, {
			curve: 'ortho',
			d: orthogonalPath(points),
			points: points as [SchematicPoint, SchematicPoint, ...SchematicPoint[]]
		}, obstacleCache, from.component.id, to.component.id);
	}
	for (const obstacle of obstacleCache) {
		if (
			obstacle.id !== from.component.id &&
			obstacle.id !== to.component.id &&
			segmentIntersectsRectangle(start, end, obstacle.body)
		) {
			throw new SchematicSyntaxError(
				`Line route intersects ${obstacle.id}; use an orthogonal route or move the obstacle.`,
				connection.line
			);
		}
	}
	return validateMarkerCollisions(
		connection,
		{ curve: 'line', d: `M ${sx} ${sy} L ${ex} ${ey}`, points: [start, end] },
		obstacleCache,
		from.component.id,
		to.component.id
	);
}

/**
 * Calculate a deterministic line, cubic Bézier, or orthogonal trace.
 *
 * @param connection - Validated directed connection.
 * @param components - Complete component map used for endpoint and obstacle lookup.
 * @param bounds - Optional intrinsic routing bounds.
 * @returns SVG path data plus control/corner points for later bounds checks.
 */
export function routeConnection(
	connection: SchematicConnection,
	components: ReadonlyMap<string, SchematicComponent>,
	bounds?: SchematicBounds
): RoutedConnection {
	return routeConnectionInternal(connection, components, bounds, undefined);
}

/** Whether two connection records resolve to the same electrical topology. */
function connectionsShareNet(left: SchematicConnection, right: SchematicConnection): boolean {
	if (left.netId !== undefined && right.netId !== undefined) return left.netId === right.netId;
	if (left.net !== undefined && right.net !== undefined && left.net === right.net) return true;
	const leftEndpoints = [
		`${left.from.componentId}.${left.from.port}`,
		`${left.to.componentId}.${left.to.port}`
	];
	return leftEndpoints.includes(`${right.from.componentId}.${right.from.port}`) ||
		leftEndpoints.includes(`${right.to.componentId}.${right.to.port}`);
}

/** Internal pin-to-pin fixture routes may coexist inside one owning component body. */
function connectionsAreInternalToSameComponent(
	left: SchematicConnection,
	right: SchematicConnection
): boolean {
	return (
		left.from.componentId === left.to.componentId &&
		right.from.componentId === right.to.componentId &&
		left.from.componentId === right.from.componentId
	);
}

/** Deterministically flatten one routed path for universal contact tests. */
function traceSegments(route: RoutedConnection, routeIndex: number, firstId: number): TraceSegment[] {
	let points: readonly SchematicPoint[] = route.points;
	if (route.curve === 'bezier') {
		const a = route.points[0]!;
		const b = route.points[1]!;
		const c = route.points[2]!;
		const d = route.points[3]!;
		const flattened: SchematicPoint[] = [];
		for (let step = 0; step <= 24; step += 1) {
			const t = step / 24;
			const inverse = 1 - t;
			flattened.push({
				x:
					inverse ** 3 * a.x +
					3 * inverse ** 2 * t * b.x +
					3 * inverse * t ** 2 * c.x +
					t ** 3 * d.x,
				y:
					inverse ** 3 * a.y +
					3 * inverse ** 2 * t * b.y +
					3 * inverse * t ** 2 * c.y +
					t ** 3 * d.y
			});
		}
		points = flattened;
	}
	const segments: TraceSegment[] = [];
	for (let index = 1; index < points.length; index += 1) {
		const start = points[index - 1]!;
		const end = points[index]!;
		if (start.x === end.x && start.y === end.y) continue;
		segments.push({
			id: firstId + segments.length,
			routeIndex,
			start,
			end,
			orthogonal: route.curve === 'ortho'
		});
	}
	return segments;
}

/** Classify any inclusive contact between two finite line segments. */
function segmentContact(
	left: TraceSegment,
	right: TraceSegment
): { readonly overlap: boolean; readonly strict: boolean } | undefined {
	const rx = left.end.x - left.start.x;
	const ry = left.end.y - left.start.y;
	const sx = right.end.x - right.start.x;
	const sy = right.end.y - right.start.y;
	const qx = right.start.x - left.start.x;
	const qy = right.start.y - left.start.y;
	const denominator = rx * sy - ry * sx;
	const epsilon = 1e-9;
	if (Math.abs(denominator) <= epsilon) {
		if (Math.abs(qx * ry - qy * rx) > epsilon) return undefined;
		const useX = Math.abs(rx) >= Math.abs(ry);
		const leftStart = useX ? left.start.x : left.start.y;
		const leftEnd = useX ? left.end.x : left.end.y;
		const rightStart = useX ? right.start.x : right.start.y;
		const rightEnd = useX ? right.end.x : right.end.y;
		const low = Math.max(Math.min(leftStart, leftEnd), Math.min(rightStart, rightEnd));
		const high = Math.min(Math.max(leftStart, leftEnd), Math.max(rightStart, rightEnd));
		if (high < low - epsilon) return undefined;
		return { overlap: high > low + epsilon, strict: false };
	}
	const t = (qx * sy - qy * sx) / denominator;
	const u = (qx * ry - qy * rx) / denominator;
	if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return undefined;
	return {
		overlap: false,
		strict: t > epsilon && t < 1 - epsilon && u > epsilon && u < 1 - epsilon
	};
}

/**
 * Reject every separate-net contact that cannot receive an orthogonal bridge.
 *
 * A one-dimensional spatial hash bounds comparisons without allocating a full
 * viewBox grid; exact y-range and segment predicates remove bucket false positives.
 */
function validateUniversalWireContacts(
	connections: readonly SchematicConnection[],
	routes: readonly RoutedConnection[]
): void {
	if (routes.every((route) => route.curve === 'ortho')) return;
	const buckets = new Map<number, TraceSegment[]>();
	let nextSegmentId = 0;
	for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
		const segments = traceSegments(routes[routeIndex]!, routeIndex, nextSegmentId);
		nextSegmentId += segments.length;
		for (const segment of segments) {
			const checked = new Set<number>();
			const minimumBucket = Math.floor(
				Math.min(segment.start.x, segment.end.x) / CROSSING_BUCKET_SIZE
			);
			const maximumBucket = Math.floor(
				Math.max(segment.start.x, segment.end.x) / CROSSING_BUCKET_SIZE
			);
			for (let bucket = minimumBucket; bucket <= maximumBucket; bucket += 1) {
				for (const previous of buckets.get(bucket) ?? []) {
					if (checked.has(previous.id)) continue;
					checked.add(previous.id);
					if (
						Math.max(segment.start.y, segment.end.y) <
							Math.min(previous.start.y, previous.end.y) ||
						Math.min(segment.start.y, segment.end.y) >
							Math.max(previous.start.y, previous.end.y)
					) {
						continue;
					}
					const contact = segmentContact(segment, previous);
					if (
						contact === undefined ||
						connectionsAreInternalToSameComponent(
							connections[routeIndex]!,
							connections[previous.routeIndex]!
						) ||
						connectionsShareNet(
							connections[routeIndex]!,
							connections[previous.routeIndex]!
						)
					) {
						continue;
					}
					const bridgeable =
						contact.strict &&
						!contact.overlap &&
						segment.orthogonal &&
						previous.orthogonal &&
						(segment.start.x === segment.end.x) !==
							(previous.start.x === previous.end.x);
					if (!bridgeable) {
						throw new SchematicSyntaxError(
							'Separate nets touch or cross without an orthogonal bridge; use ortho, a shared net, or an explicit junction.',
							connections[routeIndex]!.line
						);
					}
				}
			}
		}
		for (const segment of segments) {
			const minimumBucket = Math.floor(
				Math.min(segment.start.x, segment.end.x) / CROSSING_BUCKET_SIZE
			);
			const maximumBucket = Math.floor(
				Math.max(segment.start.x, segment.end.x) / CROSSING_BUCKET_SIZE
			);
			for (let bucket = minimumBucket; bucket <= maximumBucket; bucket += 1) {
				const entries = buckets.get(bucket) ?? [];
				entries.push(segment);
				buckets.set(bucket, entries);
			}
		}
	}
}

/**
 * Extract non-degenerate axis-aligned segments for spatial crossing detection.
 *
 * @param route - Previously generated route.
 * @param routeIndex - Source-order index assigned to every extracted segment.
 * @returns Horizontal and vertical segments; diagonal/Bézier spans are omitted.
 */
function axisSegments(route: RoutedConnection, routeIndex: number): AxisSegment[] {
	const segments: AxisSegment[] = [];
	if (route.curve !== 'ortho') return segments;
	for (let index = 1; index < route.points.length; index += 1) {
		const start = route.points[index - 1]!;
		const end = route.points[index]!;
		if (start.x === end.x && start.y !== end.y) {
			segments.push({ routeIndex, segmentIndex: index - 1, start, end, orientation: 'vertical' });
		} else {
			segments.push({ routeIndex, segmentIndex: index - 1, start, end, orientation: 'horizontal' });
		}
	}
	return segments;
}

/**
 * Locate a strict interior crossing between perpendicular trace segments.
 *
 * Endpoint contacts are excluded so shared ports and junctions never receive a bridge.
 *
 * @param left - First axis-aligned segment.
 * @param right - Second axis-aligned segment.
 * @returns Intersection coordinate, or `undefined` for parallel/non-interior spans.
 */
function segmentCrossing(left: AxisSegment, right: AxisSegment): SchematicPoint | undefined {
	const horizontal = left.orientation === 'horizontal' ? left : right;
	const vertical = left.orientation === 'vertical' ? left : right;
	const point = { x: vertical.start.x, y: horizontal.start.y };
	if (
		point.x <= Math.min(horizontal.start.x, horizontal.end.x) ||
		point.x >= Math.max(horizontal.start.x, horizontal.end.x) ||
		point.y <= Math.min(vertical.start.y, vertical.end.y) ||
		point.y >= Math.max(vertical.start.y, vertical.end.y)
	) {
		return undefined;
	}
	return point;
}

/** Whether two axis spans touch at an endpoint or overlap collinearly. */
function axisSegmentsTouch(left: AxisSegment, right: AxisSegment): boolean {
	if (left.orientation === right.orientation) {
		if (
			(left.orientation === 'horizontal' && left.start.y !== right.start.y) ||
			(left.orientation === 'vertical' && left.start.x !== right.start.x)
		) {
			return false;
		}
		const coordinate: keyof SchematicPoint = left.orientation === 'horizontal' ? 'x' : 'y';
		return (
			Math.max(
				Math.min(left.start[coordinate], left.end[coordinate]),
				Math.min(right.start[coordinate], right.end[coordinate])
			) <=
			Math.min(
				Math.max(left.start[coordinate], left.end[coordinate]),
				Math.max(right.start[coordinate], right.end[coordinate])
			)
		);
	}
	const horizontal = left.orientation === 'horizontal' ? left : right;
	const vertical = left.orientation === 'vertical' ? left : right;
	return (
		vertical.start.x >= Math.min(horizontal.start.x, horizontal.end.x) &&
		vertical.start.x <= Math.max(horizontal.start.x, horizontal.end.x) &&
		horizontal.start.y >= Math.min(vertical.start.y, vertical.end.y) &&
		horizontal.start.y <= Math.max(vertical.start.y, vertical.end.y)
	);
}

/**
 * Replace selected straight spans with semicircular SVG arc bridge commands.
 *
 * @param route - Orthogonal route receiving bridges.
 * @param crossings - Segment-indexed crossing coordinates in any order.
 * @returns Route with source-direction-sorted arcs and extra bounds extrema.
 */
function bridgedOrthogonalPath(
	route: RoutedConnection,
	crossings: ReadonlyMap<number, readonly SchematicPoint[]>,
	line: number | undefined
): RoutedConnection {
	if (crossings.size === 0) return route;
	const first = route.points[0]!;
	let path = `M ${formatNumber(first.x)} ${formatNumber(first.y)}`;
	const boundsPoints: SchematicPoint[] = [...route.points];
	for (let index = 1; index < route.points.length; index += 1) {
		const start = route.points[index - 1]!;
		const end = route.points[index]!;
		const segmentCrossings = [...(crossings.get(index - 1) ?? [])];
		const horizontal = start.y === end.y;
		const direction = Math.sign(horizontal ? end.x - start.x : end.y - start.y);
		const coordinate: keyof SchematicPoint = horizontal ? 'x' : 'y';
		segmentCrossings.sort((left, right) => direction * (left[coordinate] - right[coordinate]));
		const radii = segmentCrossings.map((crossing, crossingIndex) => {
			const position = crossing[coordinate];
			const startDistance = Math.abs(position - start[coordinate]);
			const endDistance = Math.abs(end[coordinate] - position);
			const previousDistance =
				crossingIndex === 0
					? Number.POSITIVE_INFINITY
					: Math.abs(position - segmentCrossings[crossingIndex - 1]![coordinate]) / 2;
			const nextDistance =
				crossingIndex === segmentCrossings.length - 1
					? Number.POSITIVE_INFINITY
					: Math.abs(segmentCrossings[crossingIndex + 1]![coordinate] - position) / 2;
			return Math.min(
				SCHEMATIC_BRIDGE_RADIUS,
				startDistance,
				endDistance,
				previousDistance,
				nextDistance
			);
		});
		if (horizontal) {
			let cursorX = start.x;
			for (const [crossingIndex, crossing] of segmentCrossings.entries()) {
				const radius = radii[crossingIndex]!;
				if (radius < MIN_RENDERABLE_BRIDGE_RADIUS) {
					throw new SchematicSyntaxError(
						'Wire crossings are too close to render distinct bridge arcs.',
						line
					);
				}
				const before = crossing.x - direction * radius;
				const after = crossing.x + direction * radius;
				if (before !== cursorX) path += ` H ${formatNumber(before)}`;
				path += ` A ${formatNumber(radius)} ${formatNumber(radius)} 0 0 ${direction > 0 ? 1 : 0} ${formatNumber(after)} ${formatNumber(crossing.y)}`;
				cursorX = after;
				boundsPoints.push(
					{ x: before, y: crossing.y },
					{ x: after, y: crossing.y },
					{ x: crossing.x, y: crossing.y - radius }
				);
			}
			if (cursorX !== end.x) path += ` H ${formatNumber(end.x)}`;
		} else {
			let cursorY = start.y;
			for (const [crossingIndex, crossing] of segmentCrossings.entries()) {
				const radius = radii[crossingIndex]!;
				if (radius < MIN_RENDERABLE_BRIDGE_RADIUS) {
					throw new SchematicSyntaxError(
						'Wire crossings are too close to render distinct bridge arcs.',
						line
					);
				}
				const before = crossing.y - direction * radius;
				const after = crossing.y + direction * radius;
				if (before !== cursorY) path += ` V ${formatNumber(before)}`;
				path += ` A ${formatNumber(radius)} ${formatNumber(radius)} 0 0 ${direction > 0 ? 0 : 1} ${formatNumber(crossing.x)} ${formatNumber(after)}`;
				cursorY = after;
				boundsPoints.push(
					{ x: crossing.x, y: before },
					{ x: crossing.x, y: after },
					{ x: crossing.x - radius, y: crossing.y }
				);
			}
			if (cursorY !== end.y) path += ` V ${formatNumber(end.y)}`;
		}
	}
	return {
		curve: route.curve,
		d: path,
		points: boundsPoints as [SchematicPoint, SchematicPoint, ...SchematicPoint[]]
	};
}

/**
 * Route connections in source order and bridge only the later trace at a true crossing.
 *
 * Fixed spatial buckets bound comparisons in typical sparse diagrams. Parallel
 * overlap and endpoint contact are rejected across separate nets; Bézier and
 * diagonal contacts are validated by the universal pass and never receive arcs.
 *
 * @param connections - Validated connections in deterministic source order.
 * @param components - Complete component map.
 * @returns Routes in the same order, with crossings applied to later orthogonal traces.
 */
export function routeConnections(
	connections: readonly SchematicConnection[],
	components: ReadonlyMap<string, SchematicComponent>,
	bounds?: SchematicBounds
): readonly RoutedConnection[] {
	const cachedObstacles = Array.from(components.values(), (component) => ({
		id: component.id,
		expanded: componentObstacleRectangle(component),
		body: componentObstacleRectangle(component, 0)
	}));
	const routes = connections.map((connection) =>
		routeConnectionInternal(connection, components, bounds, cachedObstacles)
	);
	validateUniversalWireContacts(connections, routes);
	const horizontalBuckets = new Map<number, AxisSegment[]>();
	const verticalBuckets = new Map<number, AxisSegment[]>();
	const crossingsByRoute = new Map<number, Map<number, SchematicPoint[]>>();
	const recordedCrossings = new Set<string>();
	let crossingCount = 0;
	const recordCrossing = (routeIndex: number, segmentIndex: number, crossing: SchematicPoint) => {
		let routeCrossings = crossingsByRoute.get(routeIndex);
		if (routeCrossings === undefined) {
			routeCrossings = new Map();
			crossingsByRoute.set(routeIndex, routeCrossings);
		}
		const points = routeCrossings.get(segmentIndex) ?? [];
		const key = `${routeIndex}:${segmentIndex}:${crossing.x}:${crossing.y}`;
		if (!recordedCrossings.has(key)) {
			recordedCrossings.add(key);
			crossingCount += 1;
			if (crossingCount > MAX_SCHEMATIC_WIRE_CROSSINGS) {
				throw new SchematicSyntaxError(
					`Wire crossing complexity exceeds ${MAX_SCHEMATIC_WIRE_CROSSINGS.toLocaleString('en-US')} intersections.`,
					connections[routeIndex]?.line
				);
			}
			points.push(crossing);
		}
		routeCrossings.set(segmentIndex, points);
	};
	const rejectUnbridgeableContact = (routeIndex: number): never => {
		throw new SchematicSyntaxError(
			'Separate nets touch or overlap without a bridgeable crossing; use a shared net or an explicit junction.',
			connections[routeIndex]?.line
		);
	};
	for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
		const route = routes[routeIndex]!;
		for (const segment of axisSegments(route, routeIndex)) {
			if (segment.orientation === 'horizontal') {
				for (
					const previous of horizontalBuckets.get(
						Math.floor(segment.start.y / CROSSING_BUCKET_SIZE)
					) ?? []
				) {
					if (
						axisSegmentsTouch(segment, previous) &&
						!connectionsShareNet(connections[routeIndex]!, connections[previous.routeIndex]!)
					) {
						rejectUnbridgeableContact(routeIndex);
					}
				}
				const minBucket = Math.floor(
					Math.min(segment.start.x, segment.end.x) / CROSSING_BUCKET_SIZE
				);
				const maxBucket = Math.floor(
					Math.max(segment.start.x, segment.end.x) / CROSSING_BUCKET_SIZE
				);
				for (let bucket = minBucket; bucket <= maxBucket; bucket += 1) {
					for (const previous of verticalBuckets.get(bucket) ?? []) {
						const crossing = segmentCrossing(segment, previous);
						const shared = connectionsShareNet(
							connections[routeIndex]!,
							connections[previous.routeIndex]!
						);
						if (
							crossing !== undefined &&
							!shared
						) {
							recordCrossing(routeIndex, segment.segmentIndex, crossing);
						} else if (crossing === undefined && !shared && axisSegmentsTouch(segment, previous)) {
							rejectUnbridgeableContact(routeIndex);
						}
					}
				}
			} else {
				for (
					const previous of verticalBuckets.get(
						Math.floor(segment.start.x / CROSSING_BUCKET_SIZE)
					) ?? []
				) {
					if (
						axisSegmentsTouch(segment, previous) &&
						!connectionsShareNet(connections[routeIndex]!, connections[previous.routeIndex]!)
					) {
						rejectUnbridgeableContact(routeIndex);
					}
				}
				const minBucket = Math.floor(
					Math.min(segment.start.y, segment.end.y) / CROSSING_BUCKET_SIZE
				);
				const maxBucket = Math.floor(
					Math.max(segment.start.y, segment.end.y) / CROSSING_BUCKET_SIZE
				);
				for (let bucket = minBucket; bucket <= maxBucket; bucket += 1) {
					for (const previous of horizontalBuckets.get(bucket) ?? []) {
						const crossing = segmentCrossing(segment, previous);
						const shared = connectionsShareNet(
							connections[routeIndex]!,
							connections[previous.routeIndex]!
						);
						if (
							crossing !== undefined &&
							!shared
						) {
							recordCrossing(routeIndex, segment.segmentIndex, crossing);
						} else if (crossing === undefined && !shared && axisSegmentsTouch(segment, previous)) {
							rejectUnbridgeableContact(routeIndex);
						}
					}
				}
			}
			const bucketIndex = Math.floor(
				(segment.orientation === 'horizontal' ? segment.start.y : segment.start.x) /
					CROSSING_BUCKET_SIZE
			);
			const index = segment.orientation === 'horizontal' ? horizontalBuckets : verticalBuckets;
			const bucket = index.get(bucketIndex) ?? [];
			bucket.push(segment);
			index.set(bucketIndex, bucket);
		}
	}
	return routes.map((route, index) =>
		bridgedOrthogonalPath(
			route,
			crossingsByRoute.get(index) ?? new Map(),
			connections[index]?.line
		)
	);
}

/**
 * Compute physical symbol half-extents without external text rows.
 *
 * @param component - Component whose vector body is measured.
 * @returns Horizontal and vertical half-extents including terminal stubs.
 */
function componentHalfExtents(component: SchematicComponent): {
	halfWidth: number;
	halfHeight: number;
} {
	let halfWidth: number;
	let halfHeight: number;
	if (isClassicalGate(component)) {
		halfWidth = 48;
		halfHeight = classicalGateHeight(component) / 2;
	} else if (isUmlComponent(component)) {
		return umlHalfExtents(component);
	} else if (isDigitalComponent(component)) {
		halfWidth = component.bodyWidth / 2 + 16;
		halfHeight = component.bodyHeight / 2 + 16;
	} else if (isQuantumSpecial(component)) {
		const tracks = Math.max(component.wires, component.controls + component.targets);
		halfWidth = 42;
		halfHeight = Math.max(24, (tracks - 1) * 9 + 14);
		if (component.kind === 'measure') halfHeight = 34;
	} else {
		switch (component.kind) {
			case 'resistor':
			case 'capacitor':
			case 'inductor':
				halfWidth = 42;
				halfHeight = 18;
				break;
			case 'diode':
				halfWidth = 42;
				halfHeight = component.diodeType === 'led' || component.diodeType === 'photodiode' ? 30 : 20;
				break;
			case 'transistor':
				halfWidth = 42;
				halfHeight = 38;
				break;
			case 'port':
				halfWidth = 42;
				halfHeight = 18;
				break;
			case 'ground':
				halfWidth = 22;
				halfHeight = 42;
				break;
			case 'hadamard':
			case 'qgate':
			case 'xgate':
			case 'ygate':
			case 'zgate':
			case 'sgate':
			case 'sdg':
			case 'tgate':
			case 'tdg':
			case 'sx':
			case 'phase':
			case 'rx':
			case 'ry':
			case 'rz':
			case 'ugate': {
				const dimensions = quantumGateDimensions(component);
				halfWidth = dimensions.stubExtent;
				halfHeight = dimensions.bodyHeight / 2;
				break;
			}
			case 'cnot':
				halfWidth = 42;
				halfHeight = 26;
				break;
			case 'ic':
				halfWidth = component.bodyWidth / 2 + 16;
				halfHeight = component.bodyHeight / 2 + 16;
				break;
			case 'source':
				halfWidth = 42;
				halfHeight = 34;
				break;
			case 'junction':
				halfWidth = halfHeight = 5;
				break;
			case 'testpoint':
				halfWidth = halfHeight = 12;
				break;
			case 'connector':
			case 'power':
				halfWidth = 32;
				halfHeight = 18;
				break;
			case 'switch':
				halfWidth = 42;
				halfHeight = component.variant === 'relay' ? 34 : 20;
				break;
			case 'amplifier':
				halfWidth = 48;
				halfHeight = 36;
				break;
			case 'protection':
			case 'resonator':
			case 'meter':
			case 'load':
				halfWidth = 42;
				halfHeight = 24;
				break;
		}
	}
	return rotateQuarterExtents({ halfWidth, halfHeight }, componentTurn(component));
}

/**
 * Calculate external designator and label fitting metrics.
 *
 * @param component - Component supplying identity, label, and physical height.
 * @returns Relative baselines and conservative width estimates.
 */
export function componentTextAnchors(component: SchematicComponent): ComponentTextAnchors {
	const { halfHeight } = componentHalfExtents(component);
	return {
		designatorY: -halfHeight - DESIGNATOR_BASELINE_GAP,
		labelY: halfHeight + LABEL_BASELINE_GAP,
		designatorWidth: mathLabelTextWidth(component.id, TEXT_ADVANCE),
		labelWidth: mathLabelTextWidth(component.label, TEXT_ADVANCE)
	};
}

/**
 * Calculate complete component bounds, including text and interactive port radii.
 *
 * @param component - Component to measure.
 * @returns Absolute AABB encompassing vectors, label rows, and port hotspots.
 */
export function componentRectangle(component: SchematicComponent): SchematicRectangle {
	const { halfWidth, halfHeight } = componentHalfExtents(component);
	if (isUmlComponent(component)) {
		const rectangle = {
			minX: component.x - halfWidth,
			minY: component.y - halfHeight,
			maxX: component.x + halfWidth,
			maxY: component.y + halfHeight
		};
		for (const port of enumerateComponentPorts(component)) {
			rectangle.minX = Math.min(rectangle.minX, port.point.x - PORT_HOTSPOT_RADIUS);
			rectangle.minY = Math.min(rectangle.minY, port.point.y - PORT_HOTSPOT_RADIUS);
			rectangle.maxX = Math.max(rectangle.maxX, port.point.x + PORT_HOTSPOT_RADIUS);
			rectangle.maxY = Math.max(rectangle.maxY, port.point.y + PORT_HOTSPOT_RADIUS);
		}
		return rectangle;
	}
	const anchors = componentTextAnchors(component);
	const textHalfWidth =
		Math.max(anchors.designatorWidth, anchors.labelWidth) / 2 + TEXT_HORIZONTAL_GUTTER;
	const boundedHalfWidth = Math.max(halfWidth, textHalfWidth);
	const rectangle = {
		minX: component.x - boundedHalfWidth,
		minY: component.y + anchors.designatorY - TEXT_ASCENT_GUTTER,
		maxX: component.x + boundedHalfWidth,
		maxY: component.y + anchors.labelY + TEXT_DESCENT_GUTTER
	};
	for (const port of enumerateComponentPorts(component)) {
		rectangle.minX = Math.min(rectangle.minX, port.point.x - PORT_HOTSPOT_RADIUS);
		rectangle.minY = Math.min(rectangle.minY, port.point.y - PORT_HOTSPOT_RADIUS);
		rectangle.maxX = Math.max(rectangle.maxX, port.point.x + PORT_HOTSPOT_RADIUS);
		rectangle.maxY = Math.max(rectangle.maxY, port.point.y + PORT_HOTSPOT_RADIUS);
	}
	return rectangle;
}

/**
 * Test whether a rectangle is fully contained by intrinsic SVG bounds.
 *
 * @param rectangle - Absolute component rectangle.
 * @param bounds - Zero-origin canvas dimensions.
 * @returns Whether every rectangle edge lies inside or on the canvas edge.
 */
function rectangleInsideBounds(rectangle: SchematicRectangle, bounds: SchematicBounds): boolean {
	return (
		rectangle.minX >= 0 &&
		rectangle.minY >= 0 &&
		rectangle.maxX <= bounds.width &&
		rectangle.maxY <= bounds.height
	);
}

/**
 * Test whether one absolute point lies in zero-origin intrinsic bounds.
 *
 * @param point - Point to inspect.
 * @param bounds - Canvas width and height.
 * @returns Whether both coordinates are inclusively bounded.
 */
function pointInsideBounds(point: SchematicPoint, bounds: SchematicBounds): boolean {
	return point.x >= 0 && point.y >= 0 && point.x <= bounds.width && point.y <= bounds.height;
}

/** UML frames whose purpose is to contain other diagram nodes. */
const OVERLAP_CONTAINER_KINDS = new Set<SchematicComponent['kind']>([
	'package',
	'component',
	'node',
	'device',
	'system',
	'partition',
	'fragment',
	'interaction',
	'region'
]);

function rectangleContains(outer: SchematicRectangle, inner: SchematicRectangle): boolean {
	return (
		outer.minX <= inner.minX &&
		outer.minY <= inner.minY &&
		outer.maxX >= inner.maxX &&
		outer.maxY >= inner.maxY
	);
}

function rectanglesOverlap(left: SchematicRectangle, right: SchematicRectangle): boolean {
	return (
		left.minX < right.maxX &&
		left.maxX > right.minX &&
		left.minY < right.maxY &&
		left.maxY > right.minY
	);
}

/** Preserve intentional UML containment while rejecting accidental body collisions. */
function componentOverlapAllowed(
	left: { readonly component: SchematicComponent; readonly rectangle: SchematicRectangle },
	right: { readonly component: SchematicComponent; readonly rectangle: SchematicRectangle }
): boolean {
	for (const [container, child] of [
		[left, right],
		[right, left]
	] as const) {
		if (
			OVERLAP_CONTAINER_KINDS.has(container.component.kind) &&
			(rectangleContains(container.rectangle, child.rectangle) ||
				(['component-port', 'gate'].includes(child.component.kind) &&
					child.component.x >= container.rectangle.minX &&
					child.component.x <= container.rectangle.maxX &&
					child.component.y >= container.rectangle.minY &&
					child.component.y <= container.rectangle.maxY))
		) {
			return true;
		}
	}
	return (
		(left.component.kind === 'lifeline' &&
			['activation', 'execution', 'destruction'].includes(right.component.kind)) ||
		(right.component.kind === 'lifeline' &&
			['activation', 'execution', 'destruction'].includes(left.component.kind))
	);
}

/** Sweep physical component bodies through bounded y-buckets and reject strict overlap. */
function validateComponentOverlaps(components: readonly SchematicComponent[]): void {
	const ordered = components
		.map((component) => ({
			component,
			rectangle: componentObstacleRectangle(component, 0)
		}))
		.sort(
			(left, right) =>
				left.rectangle.minX - right.rectangle.minX ||
				left.rectangle.minY - right.rectangle.minY ||
				left.component.line - right.component.line
		);
	const buckets: (typeof ordered)[number][][] = [];
	for (const current of ordered) {
		const minimumBucket = Math.floor(current.rectangle.minY / CROSSING_BUCKET_SIZE);
		const maximumBucket = Math.floor(current.rectangle.maxY / CROSSING_BUCKET_SIZE);
		const candidates = new Set<(typeof ordered)[number]>();
		for (let bucket = minimumBucket; bucket <= maximumBucket; bucket += 1) {
			const entries = buckets[bucket];
			if (entries === undefined) continue;
			let retained = 0;
			for (const entry of entries) {
				if (entry.rectangle.maxX <= current.rectangle.minX) continue;
				entries[retained++] = entry;
				candidates.add(entry);
			}
			entries.length = retained;
		}
		for (const previous of candidates) {
			if (
				rectanglesOverlap(previous.rectangle, current.rectangle) &&
				!componentOverlapAllowed(previous, current)
			) {
				throw new SchematicSyntaxError(
					`${current.component.id} overlaps ${previous.component.id}; move one component or use a UML container.`,
					current.component.line
				);
			}
		}
		for (let bucket = minimumBucket; bucket <= maximumBucket; bucket += 1) {
			(buckets[bucket] ??= []).push(current);
		}
	}
}

/**
 * Validate final generated geometry after terminal distribution and wire routing.
 *
 * This complements lexical origin checks and prevents component stubs, dynamic
 * IC pins, labels, bridge extrema, and routed control points from escaping the viewBox.
 *
 * @param document - Parsed immutable schematic document.
 * @param fence - Intrinsic canvas contract.
 * @throws {SchematicSyntaxError} At the originating component or connection line.
 */
export function validateDocumentGeometry(
	document: SchematicDocument,
	fence: SchematicFence,
	routedConnections?: readonly RoutedConnection[]
): readonly RoutedConnection[] {
	validateComponentOverlaps(document.components);
	for (const component of document.components) {
		if (!rectangleInsideBounds(componentRectangle(component), fence.bounds)) {
			throw new SchematicSyntaxError(
				`${component.id} geometry exceeds the declared ${fence.bounds.width}x${fence.bounds.height} bounds.`,
				component.line
			);
		}
	}
	const routes =
		routedConnections ??
		routeConnections(
			document.connections,
			new Map(document.components.map((component) => [component.id, component])),
			fence.bounds
		);
	if (routes.length !== document.connections.length) {
		throw new TypeError('Routed connection count does not match the schematic document.');
	}
	for (const [index, connection] of document.connections.entries()) {
		const routed = routes[index]!;
		if (!routed.points.every((point) => pointInsideBounds(point, fence.bounds))) {
			throw new SchematicSyntaxError(
				'Connection trace exceeds the declared schematic bounds.',
				connection.line
			);
		}
	}
	return routes;
}
