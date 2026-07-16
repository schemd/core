/**
 * Public abstract-syntax-tree and compiler option contracts for `wiremd`.
 *
 * The declarations in this module are deliberately data-only. They can be
 * imported with `import type` by hosts without initializing a renderer,
 * Markdown parser, browser API, or DOM implementation.
 *
 * @packageDocumentation
 */

/** Passive two-terminal component keywords accepted by the DSL. */
export const PASSIVE_KINDS = ['resistor', 'capacitor', 'inductor'] as const;
/** A supported passive two-terminal component keyword. */
export type PassiveKind = (typeof PASSIVE_KINDS)[number];

/** Discrete analog and boundary component keywords accepted by the DSL. */
export const ANALOG_KINDS = ['diode', 'transistor', 'port', 'ground'] as const;
/** A supported discrete analog or boundary component keyword. */
export type AnalogKind = (typeof ANALOG_KINDS)[number];

/** Valid diode construction variants. */
export const DIODE_TYPES = ['standard', 'schottky', 'zener', 'led'] as const;
/** A diode construction variant selected by the `type` attribute. */
export type DiodeType = (typeof DIODE_TYPES)[number];

/** Valid bipolar and field-effect transistor variants. */
export const TRANSISTOR_TYPES = ['npn', 'pnp', 'nmos', 'pmos'] as const;
/** A transistor variant selected by the `type` attribute. */
export type TransistorType = (typeof TRANSISTOR_TYPES)[number];

/** Valid electrical ground symbol styles. */
export const GROUND_STYLES = ['chassis', 'earth', 'signal'] as const;
/** A ground symbol style selected by the `style` attribute. */
export type GroundStyle = (typeof GROUND_STYLES)[number];

/** Classical logic gate keywords supported by the vector renderer. */
export const CLASSICAL_GATE_KINDS = ['nand', 'nor', 'xor', 'and', 'or', 'not'] as const;
/** A supported classical logic gate keyword. */
export type ClassicalGateKind = (typeof CLASSICAL_GATE_KINDS)[number];

/** Native and polymorphic quantum operator keywords. */
export const QUANTUM_GATE_KINDS = ['hadamard', 'cnot', 'qgate'] as const;
/** A supported native or polymorphic quantum gate keyword. */
export type QuantumGateKind = (typeof QUANTUM_GATE_KINDS)[number];

/** Complete, collision-free component keyword registry. */
export const COMPONENT_KINDS = [
	...PASSIVE_KINDS,
	...ANALOG_KINDS,
	...CLASSICAL_GATE_KINDS,
	...QUANTUM_GATE_KINDS,
	'ic'
] as const;
/** Any component keyword that can begin a declaration. */
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** Built-in semantic color tokens that hosts can theme through CSS. */
export const SEMANTIC_COLORS = ['amber', 'blue', 'cyan', 'purple', 'slate', 'emerald'] as const;
/** A built-in semantic color token. */
export type SemanticColor = (typeof SEMANTIC_COLORS)[number];

/**
 * Sanitized color representation produced by the lexer.
 *
 * `token` values become stable theme classes, `css` values are validated CSS
 * color literals, and `alias` values resolve through a host-provided custom
 * property rather than being emitted as arbitrary markup.
 */
export type SchematicColor =
	| { kind: 'token'; value: SemanticColor }
	| { kind: 'css'; value: string }
	| { kind: 'alias'; value: string };

/** Intrinsic SVG canvas dimensions declared by a `wiremd` fence. */
export interface SchematicBounds {
	/** Horizontal viewBox extent in coordinate units. */
	width: number;
	/** Vertical viewBox extent in coordinate units. */
	height: number;
}

/** Validated metadata parsed from a fenced `wiremd` declaration. */
export interface SchematicFence {
	/** Static dimensions used to reserve layout space before browser paint. */
	bounds: SchematicBounds;
	/** Accessible diagram title, supplied explicitly or by the host default. */
	title: string;
}

/** Absolute point in the declared schematic coordinate system. */
export interface SchematicPoint {
	/** Horizontal coordinate. */
	x: number;
	/** Vertical coordinate. */
	y: number;
}

/** Shared immutable source metadata for every parsed component. */
interface ComponentBase extends SchematicPoint {
	/** Document-unique component identifier used by connection endpoints. */
	id: string;
	/** Human-readable label, optionally containing wiremd micro-math syntax. */
	label: string;
	/** Sanitized semantic or custom vector color. */
	color: SchematicColor;
	/** One-based source line used for deterministic diagnostics. */
	line: number;
}

/** Parsed resistor, capacitor, or inductor component. */
export interface PassiveComponent extends ComponentBase {
	/** Specific two-terminal passive kind. */
	kind: PassiveKind;
}

/** Parsed diode with its selected physical symbol variant. */
export interface DiodeComponent extends ComponentBase {
	/** Discriminant for diode components. */
	kind: 'diode';
	/** Standard, Schottky, Zener, or LED vector treatment. */
	diodeType: DiodeType;
}

/** Parsed bipolar or field-effect transistor. */
export interface TransistorComponent extends ComponentBase {
	/** Discriminant for transistor components. */
	kind: 'transistor';
	/** Electrical device family and polarity. */
	transistorType: TransistorType;
}

/** Parsed system-boundary input/output terminal. */
export interface PortComponent extends ComponentBase {
	/** Discriminant for boundary ports. */
	kind: 'port';
}

/** Parsed zero-volt reference symbol. */
export interface GroundComponent extends ComponentBase {
	/** Discriminant for ground references. */
	kind: 'ground';
	/** Chassis, earth, or signal-ground visual form. */
	groundStyle: GroundStyle;
}

/** Parsed IEEE- or IEC-style classical logic gate. */
export interface ClassicalGateComponent extends ComponentBase {
	/** Logic operation represented by the gate. */
	kind: ClassicalGateKind;
	/** Validated number of addressable input pins, from 1 through 32. */
	inputs: number;
	/** Validated number of addressable output pins, from 1 through 32. */
	outputs: number;
	/** Symbol convention used when generating the gate contour. */
	standard: 'ieee' | 'iec';
}

/** Parsed native or user-labelled quantum operator. */
export interface QuantumGateComponent extends ComponentBase {
	/** Quantum operator family. */
	kind: QuantumGateKind;
	/** Optional operator parameter rendered through the micro-math pipeline. */
	parameter?: string;
	/** Optional compact matrix description. */
	matrix?: string;
	/** Optional phase expression. */
	phase?: string;
}

/** Pin names registered on each side of a polymorphic integrated circuit. */
export interface IntegratedCircuitPins {
	/** Pins distributed from top to bottom on the left edge. */
	left: readonly string[];
	/** Pins distributed from top to bottom on the right edge. */
	right: readonly string[];
	/** Pins distributed from left to right on the top edge. */
	top: readonly string[];
	/** Pins distributed from left to right on the bottom edge. */
	bottom: readonly string[];
}

/** Parsed custom multi-terminal integrated-circuit block. */
export interface IcComponent extends ComponentBase {
	/** Discriminant for custom integrated circuits and architecture blocks. */
	kind: 'ic';
	/** Addressable, side-aware pin registry. */
	pins: IntegratedCircuitPins;
	/** Computed body width that preserves label and pin clearances. */
	bodyWidth: number;
	/** Computed body height derived from the longest pin list. */
	bodyHeight: number;
}

/** Descriptive alias for a parsed integrated-circuit block. */
export type IntegratedCircuitComponent = IcComponent;

/** Discriminated union of every component node accepted by the renderer. */
export type SchematicComponent =
	| PassiveComponent
	| DiodeComponent
	| TransistorComponent
	| PortComponent
	| GroundComponent
	| ClassicalGateComponent
	| QuantumGateComponent
	| IcComponent;

/** Address of one component terminal in a connection declaration. */
export interface SchematicEndpoint {
	/** Document-local component identifier. */
	componentId: string;
	/** Canonicalized port name, including stable aliases such as `in` and `out`. */
	port: string;
}

/** Validated directed signal connection between two component terminals. */
export interface SchematicConnection {
	/** Signal origin. */
	from: SchematicEndpoint;
	/** Signal destination. */
	to: SchematicEndpoint;
	/** Sanitized trace color. */
	color: SchematicColor;
	/** Straight, cubic Bézier, or obstacle-aware orthogonal routing strategy. */
	curve: 'line' | 'bezier' | 'ortho';
	/** Optional marker drawn at the source terminal. */
	markerStart: SchematicSignalMarker;
	/** Optional marker drawn at the destination terminal. */
	markerEnd: SchematicSignalMarker;
	/** One-based source line used for routing diagnostics. */
	line: number;
}

/** Frozen parser result consumed by layout and rendering passes. */
export interface SchematicDocument {
	/** Components in deterministic source order. */
	readonly components: readonly SchematicComponent[];
	/** Connections in deterministic source order. */
	readonly connections: readonly SchematicConnection[];
}

/** Supported SVG output budgets, ordered from smallest to most interactive. */
export const WIREMD_OUTPUT_MODES = ['default', 'embedded-css', 'full'] as const;
/** Static, CSS-enhanced, or fully attributed SVG output mode. */
export type WiremdOutputMode = (typeof WIREMD_OUTPUT_MODES)[number];

/** Marker primitives that can terminate or originate a signal trace. */
export const SCHEMATIC_SIGNAL_MARKERS = ['none', 'arrow', 'dot'] as const;
/** A validated connection marker selection. */
export type SchematicSignalMarker = (typeof SCHEMATIC_SIGNAL_MARKERS)[number];

/** Per-render options extending the fence's intrinsic layout contract. */
export interface CompileSchematicOptions extends SchematicFence {
	/** Caller-controlled, sanitized prefix preventing duplicate SVG definition IDs. */
	idPrefix?: string;
	/** Markup and interaction budget for the generated SVG. */
	mode?: WiremdOutputMode;
}

/** Configuration accepted by the type-only Marked extension factory. */
export interface SchematicMarkedOptions {
	/** Accessible title used when the fence omits one. */
	defaultTitle?: string;
	/** Fixed output mode for every wiremd fence in a Markdown pass. */
	mode?: WiremdOutputMode;
	/** Synchronous mode resolver for hosts with request-scoped rendering state. */
	resolveMode?: () => WiremdOutputMode;
	/** Optional safe fallback renderer for bounded syntax failures. */
	onError?: (error: SchematicSyntaxError, source: string) => string;
}

/**
 * Deterministic syntax or geometry failure with optional source location.
 *
 * The constructor prefixes located messages with `Line N:` exactly once so
 * hosts can present the same diagnostic in SSR, remote previews, and tests.
 */
export class SchematicSyntaxError extends Error {
	/** One-based source line when the failure maps to a DSL declaration. */
	readonly line: number | undefined;

	/**
	 * Create a compiler diagnostic.
	 *
	 * @param message - Human-readable failure without a line prefix.
	 * @param line - Optional one-based source line.
	 */
	constructor(message: string, line?: number) {
		super(line === undefined ? message : `Line ${line}: ${message}`);
		this.name = 'SchematicSyntaxError';
		this.line = line;
	}
}
