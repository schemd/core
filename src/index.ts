/**
 * Stable public entry point for the `schemd` server-side compiler.
 *
 * All runtime exports are dependency-free. The Marked integration imports
 * Marked contracts as types only, so applications pay for no Markdown runtime
 * unless they already provide one at the host boundary.
 *
 * @packageDocumentation
 */
export { parseSchematic, parseSchematicColor, parseSchematicFence } from './parser.js';
export { renderSchematic } from './renderer.js';
export { schematicMarkedExtension } from './marked-extension.js';
export {
	mathLabelGlyphLength,
	mathLabelText,
	parseMathLabel,
	renderMathLabelTspans,
	type MathLabelSegment,
	type MathLabelSegmentKind
} from './math-label.js';
export {
	MAX_SCHEMATIC_COMPONENTS,
	MAX_SCHEMATIC_CONNECTIONS,
	MAX_SCHEMATIC_SOURCE_CHARACTERS,
	MAX_SCHEMATIC_SVG_OUTPUT_BYTES,
	SCHEMATIC_LIMITS
} from './limits.js';
export {
	classicalGateHeight,
	componentObstacleRectangle,
	componentRectangle,
	componentTextAnchors,
	distributedCoordinate,
	enumerateComponentPorts,
	positionIcPin,
	PORT_HOTSPOT_RADIUS,
	resolvePortPoint,
	routeConnections,
	routeConnection,
	SCHEMATIC_BRIDGE_RADIUS,
	SCHEMATIC_OBSTACLE_CLEARANCE,
	validateDocumentGeometry,
	type RoutedConnection,
	type ComponentTextAnchors,
	type ComponentPort,
	type IcPinSide,
	type SchematicRectangle
} from './layout.js';
export {
	ANALOG_KINDS,
	COMPONENT_KINDS,
	CLASSICAL_GATE_KINDS,
	DIODE_TYPES,
	GROUND_STYLES,
	PASSIVE_KINDS,
	QUANTUM_GATE_KINDS,
	SCHEMATIC_SIGNAL_MARKERS,
	SEMANTIC_COLORS,
	TRANSISTOR_TYPES,
	SCHEMD_OUTPUT_MODES,
	SchematicSyntaxError,
	type AnalogKind,
	type CompileSchematicOptions,
	type ClassicalGateComponent,
	type ClassicalGateKind,
	type ComponentKind,
	type DiodeComponent,
	type DiodeType,
	type GroundComponent,
	type GroundStyle,
	type IcComponent,
	type IntegratedCircuitComponent,
	type IntegratedCircuitPins,
	type PassiveComponent,
	type PassiveKind,
	type PortComponent,
	type SemanticColor,
	type SchematicBounds,
	type SchematicComponent,
	type SchematicConnection,
	type SchematicColor,
	type SchematicDocument,
	type SchematicEndpoint,
	type SchematicFence,
	type SchematicSignalMarker,
	type SchematicMarkedOptions,
	type SchematicPoint,
	type SchemdOutputMode,
	type TransistorComponent,
	type TransistorType,
	type QuantumGateComponent,
	type QuantumGateKind
} from './types.js';
