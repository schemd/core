/**
 * Public abstract-syntax-tree and compiler option contracts for `schemd`.
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
/** Compact variant registry shared by the three passive families. */
export const PASSIVE_TYPES = [
	'fixed',
	'variable',
	'rheostat',
	'potentiometer',
	'thermistor',
	'ldr',
	'polarized',
	'coupled',
	'transformer'
] as const;
/** A validated passive construction variant. */
export type PassiveType = (typeof PASSIVE_TYPES)[number];

/** Discrete analog and boundary component keywords accepted by the DSL. */
export const ANALOG_KINDS = ['diode', 'transistor', 'port', 'ground'] as const;
/** A supported discrete analog or boundary component keyword. */
export type AnalogKind = (typeof ANALOG_KINDS)[number];

/** Valid diode construction variants. */
export const DIODE_TYPES = [
	'standard',
	'schottky',
	'zener',
	'led',
	'photodiode',
	'varactor',
	'scr',
	'triac'
] as const;
/** A diode construction variant selected by the `type` attribute. */
export type DiodeType = (typeof DIODE_TYPES)[number];

/** Valid bipolar and field-effect transistor variants. */
export const TRANSISTOR_TYPES = ['npn', 'pnp', 'nmos', 'pmos', 'njfet', 'pjfet', 'nigbt', 'pigbt'] as const;
/** A transistor variant selected by the `type` attribute. */
export type TransistorType = (typeof TRANSISTOR_TYPES)[number];

/** Valid electrical ground symbol styles. */
export const GROUND_STYLES = ['chassis', 'earth', 'signal'] as const;
/** A ground symbol style selected by the `style` attribute. */
export type GroundStyle = (typeof GROUND_STYLES)[number];

/** Classical logic gate keywords supported by the vector renderer. */
export const ELECTRICAL_COMPONENT_KINDS = [
	'source',
	'junction',
	'testpoint',
	'connector',
	'power',
	'switch',
	'protection',
	'amplifier',
	'resonator',
	'meter',
	'load'
] as const;
export type ElectricalComponentKind = (typeof ELECTRICAL_COMPONENT_KINDS)[number];
export const SOURCE_TYPES = [
	'voltage-dc',
	'voltage-ac',
	'voltage-pulse',
	'current-dc',
	'current-ac',
	'battery',
	'vcvs',
	'vccs',
	'ccvs',
	'cccs'
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const POWER_TYPES = ['vcc', 'vdd', 'vss', 'positive', 'negative'] as const;
export type PowerType = (typeof POWER_TYPES)[number];
export const SWITCH_TYPES = ['spst', 'spdt', 'pushbutton', 'relay'] as const;
export type SwitchType = (typeof SWITCH_TYPES)[number];
export const PROTECTION_TYPES = ['fuse', 'breaker'] as const;
export type ProtectionType = (typeof PROTECTION_TYPES)[number];
export const AMPLIFIER_TYPES = ['opamp', 'comparator', 'instrumentation'] as const;
export type AmplifierType = (typeof AMPLIFIER_TYPES)[number];
export const RESONATOR_TYPES = ['crystal', 'ceramic'] as const;
export type ResonatorType = (typeof RESONATOR_TYPES)[number];
export const METER_TYPES = ['voltmeter', 'ammeter'] as const;
export type MeterType = (typeof METER_TYPES)[number];
export const LOAD_TYPES = ['lamp', 'motor', 'speaker', 'buzzer'] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

/** Classical logic gates with IEEE- and IEC-style vector contours. */
export const CLASSICAL_GATE_KINDS = ['nand', 'nor', 'xor', 'xnor', 'and', 'or', 'not'] as const;
/** A supported classical logic gate keyword. */
export type ClassicalGateKind = (typeof CLASSICAL_GATE_KINDS)[number];

/** Native and polymorphic quantum operator keywords. */
export const DIGITAL_COMPONENT_KINDS = [
	'buffer',
	'logic',
	'clock',
	'flipflop',
	'mux',
	'encoder',
	'decoder',
	'register',
	'counter',
	'adder',
	'comparator',
	'bus'
] as const;
export type DigitalComponentKind = (typeof DIGITAL_COMPONENT_KINDS)[number];
export const BUFFER_TYPES = [
	'plain',
	'tristate',
	'tristate-inverter',
	'schmitt',
	'schmitt-inverter'
] as const;
export type BufferType = (typeof BUFFER_TYPES)[number];
export const LOGIC_STATES = ['high', 'low', 'unknown', 'high-z'] as const;
export type LogicState = (typeof LOGIC_STATES)[number];
export const FLIPFLOP_TYPES = ['sr-latch', 'd-latch', 'd', 'jk', 't'] as const;
export type FlipFlopType = (typeof FLIPFLOP_TYPES)[number];
export const MUX_TYPES = ['mux', 'demux'] as const;
export type MuxType = (typeof MUX_TYPES)[number];
export const ADDER_TYPES = ['half', 'full'] as const;
export type AdderType = (typeof ADDER_TYPES)[number];
export const BUS_TYPES = ['tap', 'splitter', 'joiner'] as const;
export type BusType = (typeof BUS_TYPES)[number];

/** Native, named, and polymorphic quantum operator keywords. */
export const NAMED_QUANTUM_GATE_KINDS = [
	'xgate',
	'ygate',
	'zgate',
	'sgate',
	'sdg',
	'tgate',
	'tdg',
	'sx',
	'phase',
	'rx',
	'ry',
	'rz',
	'ugate'
] as const;
export type NamedQuantumGateKind = (typeof NAMED_QUANTUM_GATE_KINDS)[number];
export const QUANTUM_SPECIAL_KINDS = [
	'measure',
	'reset',
	'prepare',
	'swap',
	'control',
	'cz',
	'cphase',
	'toffoli',
	'controlled',
	'barrier',
	'delay',
	'classical-bit',
	'classical-register'
] as const;
export type QuantumSpecialKind = (typeof QUANTUM_SPECIAL_KINDS)[number];
export const QUANTUM_GATE_KINDS = [
	'hadamard',
	'cnot',
	'qgate',
	...NAMED_QUANTUM_GATE_KINDS
] as const;
/** A supported native or polymorphic quantum gate keyword. */
export type QuantumGateKind = (typeof QUANTUM_GATE_KINDS)[number];

/** First-class UML node keywords spanning structural and behavioral diagrams. */
export const UML_COMPONENT_KINDS = [
	'class',
	'interface',
	'provided-interface',
	'required-interface',
	'enumeration',
	'datatype',
	'object',
	'component',
	'component-port',
	'artifact',
	'node',
	'device',
	'execution',
	'system',
	'actor',
	'usecase',
	'state',
	'lifeline',
	'action',
	'decision',
	'merge',
	'fork',
	'join',
	'activity-final',
	'flow-final',
	'object-node',
	'send-signal',
	'receive-signal',
	'partition',
	'activation',
	'destruction',
	'fragment',
	'interaction',
	'gate',
	'found',
	'lost',
	'choice',
	'state-junction',
	'history',
	'entry',
	'exit',
	'terminate',
	'region',
	'note',
	'package',
	'initial',
	'final'
] as const;
/** A supported UML node keyword. */
export type UmlComponentKind = (typeof UML_COMPONENT_KINDS)[number];

/** Complete, collision-free component keyword registry. */
export const COMPONENT_KINDS = [
	...PASSIVE_KINDS,
	...ANALOG_KINDS,
	...ELECTRICAL_COMPONENT_KINDS,
	...CLASSICAL_GATE_KINDS,
	...DIGITAL_COMPONENT_KINDS,
	...QUANTUM_GATE_KINDS,
	...QUANTUM_SPECIAL_KINDS,
	...UML_COMPONENT_KINDS,
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

/** Intrinsic SVG canvas dimensions declared by a `schemd` fence. */
export interface SchematicBounds {
	/** Horizontal viewBox extent in coordinate units. */
	width: number;
	/** Vertical viewBox extent in coordinate units. */
	height: number;
}

/** Validated metadata parsed from a fenced `schemd` declaration. */
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

/** Author-facing quarter-turn orientations for direction-sensitive components. */
export const SCHEMATIC_ORIENTATIONS = ['right', 'down', 'left', 'up'] as const;
/** A direction-sensitive component's canonical quarter-turn orientation. */
export type SchematicOrientation = (typeof SCHEMATIC_ORIENTATIONS)[number];
/** Compact clockwise quarter-turn count used by exact layout arithmetic. */
export type SchematicQuarterTurn = 0 | 1 | 2 | 3;

/** Shared immutable source metadata for every parsed component. */
interface ComponentBase extends SchematicPoint {
	/** Document-unique component identifier used by connection endpoints. */
	id: string;
	/** Human-readable label, optionally containing schemd micro-math syntax. */
	label: string;
	/** Sanitized semantic or custom vector color. */
	color: SchematicColor;
	/** One-based source line used for deterministic diagnostics. */
	line: number;
}

/** Shared metadata for symbols whose canonical geometry supports quarter turns. */
export interface DirectionalComponentBase extends ComponentBase {
	/** Explicit orientation; absence preserves the legacy canonical direction. */
	orientation?: SchematicOrientation;
}

/** Parsed resistor, capacitor, or inductor component. */
export interface PassiveComponent extends DirectionalComponentBase {
	/** Specific two-terminal passive kind. */
	kind: PassiveKind;
	/** Non-default construction variant; absence means fixed. */
	passiveType?: PassiveType;
}

/** Parsed diode with its selected physical symbol variant. */
export interface DiodeComponent extends DirectionalComponentBase {
	/** Discriminant for diode components. */
	kind: 'diode';
	/** Standard, Schottky, Zener, or LED vector treatment. */
	diodeType: DiodeType;
}

/** Parsed bipolar or field-effect transistor. */
export interface TransistorComponent extends DirectionalComponentBase {
	/** Discriminant for transistor components. */
	kind: 'transistor';
	/** Electrical device family and polarity. */
	transistorType: TransistorType;
}

/** Parsed system-boundary input/output terminal. */
export interface PortComponent extends DirectionalComponentBase {
	/** Discriminant for boundary ports. */
	kind: 'port';
	/** Optional bus width; absence is a scalar port. */
	width?: number;
}

/** Parsed zero-volt reference symbol. */
export interface GroundComponent extends DirectionalComponentBase {
	/** Discriminant for ground references. */
	kind: 'ground';
	/** Chassis, earth, or signal-ground visual form. */
	groundStyle: GroundStyle;
}

/** Variant value accepted by one of the compact electrical symbol families. */
export type ElectricalVariant =
	| SourceType
	| PowerType
	| SwitchType
	| ProtectionType
	| AmplifierType
	| ResonatorType
	| MeterType
	| LoadType;

/** Parsed source, switch, functional block, load, or electrical node. */
export interface ElectricalComponent extends DirectionalComponentBase {
	kind: ElectricalComponentKind;
	/** Family-specific validated variant; absent only for junction/testpoint/connector. */
	variant?: ElectricalVariant;
}

/** Parsed IEEE- or IEC-style classical logic gate. */
export interface ClassicalGateComponent extends DirectionalComponentBase {
	/** Logic operation represented by the gate. */
	kind: ClassicalGateKind;
	/** Validated number of addressable input pins, from 1 through 32. */
	inputs: number;
	/** Validated number of addressable output pins, from 1 through 32. */
	outputs: number;
	/** Symbol convention used when generating the gate contour. */
	standard: 'ieee' | 'iec';
}

/** Compact digital block normalized from storage, selection, arithmetic, and bus keywords. */
export interface DigitalComponent extends DirectionalComponentBase {
	kind: DigitalComponentKind;
	/** Family-specific variant such as tristate, D flip-flop, or splitter. */
	variant?: BufferType | LogicState | FlipFlopType | MuxType | AdderType | BusType;
	/** Validated logical input count. */
	inputs: number;
	/** Validated logical output count. */
	outputs: number;
	/** Scalar width or bus width represented by relevant terminals. */
	width: number;
	/** Deterministic body dimensions used by ports, obstacles, and SVG generation. */
	bodyWidth: number;
	bodyHeight: number;
}

/** Parsed native or user-labelled quantum operator. */
export interface QuantumGateComponent extends DirectionalComponentBase {
	/** Quantum operator family. */
	kind: QuantumGateKind;
	/** Optional operator parameter rendered through the micro-math pipeline. */
	parameter?: string;
	/** Optional compact matrix description. */
	matrix?: string;
	/** Optional phase expression. */
	phase?: string;
}

/** Non-unitary, multi-wire, control, timing, or classical quantum-circuit primitive. */
export interface QuantumSpecialComponent extends DirectionalComponentBase {
	kind: QuantumSpecialKind;
	/** Positive or negative standalone/embedded control marker. */
	controlType?: 'positive' | 'negative' | 'classical';
	/** Operator rendered at the target of a generalized controlled gate. */
	operator?: string;
	/** Number of control tracks. */
	controls: number;
	/** Number of target tracks. */
	targets: number;
	/** Total parallel tracks accepted by barriers, delays, and registers. */
	wires: number;
	/** Classical register width, or one for scalar quantum/classical nodes. */
	width: number;
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
export interface IcComponent extends DirectionalComponentBase {
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

/** Parsed UML class with independently sized attribute and operation compartments. */
export interface UmlClassComponent extends ComponentBase {
	/** UML class node discriminant. */
	kind: 'class' | 'interface' | 'enumeration' | 'datatype' | 'object';
	/** Optional stereotype displayed above the class name. */
	stereotype?: string;
	/** Attribute declarations in source order. */
	attributes: readonly string[];
	/** Operation declarations in source order. */
	operations: readonly string[];
	/** Deterministic box width derived from all visible rows. */
	bodyWidth: number;
	/** Deterministic three-compartment box height. */
	bodyHeight: number;
}

/** Parsed UML state with optional behavior rows. */
export interface UmlStateComponent extends ComponentBase {
	kind: 'state';
	/** Entry, do, exit, or author-defined behavior rows. */
	details: readonly string[];
	bodyWidth: number;
	bodyHeight: number;
}

/** Parsed UML ellipse, note, package, or sequence lifeline. */
export interface UmlSizedComponent extends ComponentBase {
	kind:
		| 'usecase'
		| 'lifeline'
		| 'note'
		| 'package'
		| 'component'
		| 'artifact'
		| 'node'
		| 'device'
		| 'execution'
		| 'system'
		| 'action'
		| 'object-node'
		| 'partition'
		| 'activation'
		| 'fragment'
		| 'interaction'
		| 'region';
	bodyWidth: number;
	bodyHeight: number;
}

/** Parsed UML actor figure. */
export interface UmlActorComponent extends ComponentBase {
	kind: 'actor';
}

/** Parsed UML initial or final pseudostate. */
export interface UmlPseudostateComponent extends ComponentBase {
	kind:
		| 'initial'
		| 'final'
		| 'provided-interface'
		| 'required-interface'
		| 'component-port'
		| 'decision'
		| 'merge'
		| 'fork'
		| 'join'
		| 'activity-final'
		| 'flow-final'
		| 'send-signal'
		| 'receive-signal'
		| 'destruction'
		| 'gate'
		| 'found'
		| 'lost'
		| 'choice'
		| 'state-junction'
		| 'history'
		| 'entry'
		| 'exit'
		| 'terminate';
	/** History depth; present only on history pseudostates. */
	variant?: 'shallow' | 'deep';
}

/** Every UML component accepted by the compiler. */
export type UmlComponent =
	| UmlClassComponent
	| UmlStateComponent
	| UmlSizedComponent
	| UmlActorComponent
	| UmlPseudostateComponent;

/** Discriminated union of every component node accepted by the renderer. */
export type SchematicComponent =
	| PassiveComponent
	| DiodeComponent
	| TransistorComponent
	| PortComponent
	| GroundComponent
	| ElectricalComponent
	| ClassicalGateComponent
	| DigitalComponent
	| QuantumGateComponent
	| QuantumSpecialComponent
	| IcComponent
	| UmlComponent;

/** UML relationship semantics used to derive line style and endpoint markers. */
export const UML_RELATION_KINDS = [
	'association',
	'dependency',
	'generalization',
	'realization',
	'aggregation',
	'composition',
	'message',
	'synchronous',
	'asynchronous',
	'return',
	'control-flow',
	'object-flow',
	'assembly',
	'delegation',
	'transition',
	'include',
	'extend'
] as const;
/** A supported UML relationship. */
export type UmlRelationKind = (typeof UML_RELATION_KINDS)[number];
/** Electrical signal or a first-class UML relationship. */
export type SchematicRelationKind = 'signal' | UmlRelationKind;

/** Physical/semantic channel carried by a signal connection. */
export const SCHEMATIC_SIGNAL_KINDS = ['electrical', 'digital', 'quantum', 'classical'] as const;
export type SchematicSignalKind = (typeof SCHEMATIC_SIGNAL_KINDS)[number];

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
	/** Electrical or UML relationship semantics. */
	relation?: SchematicRelationKind;
	/** Non-default signal domain; absence preserves legacy electrical behavior. */
	signalKind?: SchematicSignalKind;
	/** Author-supplied net name joining otherwise disconnected signal segments. */
	net?: string;
	/** Parser-resolved topology identity; unnamed nets use a stable `$N` identifier. */
	netId?: string;
	/** Validated bus/register width; absence denotes a scalar connection. */
	width?: number;
	/** Optional text centered beside the routed connector. */
	label?: string;
	/** Whether the trace uses the UML dependency dash pattern. */
	dashed?: boolean;
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
export const SCHEMD_OUTPUT_MODES = ['default', 'embedded-css', 'full'] as const;
/** Static, CSS-enhanced, or fully attributed SVG output mode. */
export type SchemdOutputMode = (typeof SCHEMD_OUTPUT_MODES)[number];

/** Optional semantic payloads emitted by `full` mode. */
export const SCHEMD_SEMANTIC_HOOKS = ['nodes', 'ports', 'wires'] as const;
/** A selectable delegated-interaction payload. */
export type SchematicSemanticHook = (typeof SCHEMD_SEMANTIC_HOOKS)[number];

/** Marker primitives that can terminate or originate a signal trace. */
export const SCHEMATIC_SIGNAL_MARKERS = [
	'none',
	'arrow',
	'open-arrow',
	'dot',
	'triangle',
	'diamond',
	'diamond-filled'
] as const;
/** A validated connection marker selection. */
export type SchematicSignalMarker = (typeof SCHEMATIC_SIGNAL_MARKERS)[number];

/** Per-render options extending the fence's intrinsic layout contract. */
export interface CompileSchematicOptions extends SchematicFence {
	/** Caller-controlled, sanitized prefix preventing duplicate SVG definition IDs. */
	idPrefix?: string;
	/** Markup and interaction budget for the generated SVG. */
	mode?: SchemdOutputMode;
	/** Full-mode metadata to emit. Defaults to nodes, ports, and wires. */
	semanticHooks?: readonly SchematicSemanticHook[];
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
