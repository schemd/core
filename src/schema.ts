import {
	ADDER_TYPES,
	AMPLIFIER_TYPES,
	BUFFER_TYPES,
	BUS_TYPES,
	CLASSICAL_GATE_KINDS,
	COMPONENT_KINDS,
	DIODE_TYPES,
	FLIPFLOP_TYPES,
	GROUND_STYLES,
	LOAD_TYPES,
	LOGIC_STATES,
	METER_TYPES,
	MUX_TYPES,
	NAMED_QUANTUM_GATE_KINDS,
	POWER_TYPES,
	PROTECTION_TYPES,
	RESONATOR_TYPES,
	SCHEMATIC_ORIENTATIONS,
	SOURCE_TYPES,
	SWITCH_TYPES,
	SchematicSyntaxError,
	TRANSISTOR_TYPES,
	type ComponentKind
} from './types.js';

export interface SchematicEnumOption {
	readonly name: string;
	readonly type: 'enum';
	readonly values: readonly string[];
	readonly default?: string;
}

export interface SchematicNumberOption {
	readonly name: string;
	readonly type: 'integer' | 'number';
	readonly min: number;
	readonly max: number;
	readonly default?: number;
	readonly defaultsByType?: Readonly<Record<string, number>>;
}

export interface SchematicTextOption {
	readonly name: string;
	readonly type: 'text';
	readonly minLength: number;
	readonly maxLength?: number;
}

export interface SchematicPinsOption {
	readonly name: string;
	readonly type: 'pins';
	readonly maxItems: number;
	readonly pattern: string;
	readonly reserved: readonly string[];
}

export interface SchematicRowsOption {
	readonly name: string;
	readonly type: 'rows';
	readonly maxItems: number;
	readonly maxLength: number;
}

export type SchematicOptionSchema =
	| SchematicEnumOption
	| SchematicNumberOption
	| SchematicTextOption
	| SchematicPinsOption
	| SchematicRowsOption;

export type SchematicComponentFamily = 'electrical' | 'digital' | 'quantum' | 'uml';

export interface SchematicComponentSchema {
	readonly kind: ComponentKind;
	readonly family: SchematicComponentFamily;
	readonly options: readonly SchematicOptionSchema[];
	readonly requiresOneOf?: readonly string[];
	readonly conflicts?: readonly (readonly [string, string])[];
}

const orientation: SchematicEnumOption = { name: 'orientation', type: 'enum', values: SCHEMATIC_ORIENTATIONS, default: 'right' };
const fit: SchematicEnumOption = { name: 'fit', type: 'enum', values: ['wires'] };
const FIT_CONFLICT = [['fit', 'orientation']] as const;
const variant = (values: readonly string[], fallback: string): SchematicEnumOption => ({ name: 'type', type: 'enum', values, default: fallback });
const count = (name: string, fallback: number, min = 1, max = 32, defaultsByType?: Readonly<Record<string, number>>): SchematicNumberOption => ({
	name,
	type: 'integer',
	min,
	max,
	default: fallback,
	...(defaultsByType === undefined ? {} : { defaultsByType })
});
const busWidth = (fallback: number, min: number): SchematicNumberOption => ({ name: 'width', type: 'integer', min, max: 256, default: fallback });
const dimension = (name: string): SchematicNumberOption => ({ name, type: 'number', min: 24, max: 2048 });
const rows = (name: string): SchematicRowsOption => ({ name, type: 'rows', maxItems: 64, maxLength: 256 });
const pins = (name: string): SchematicPinsOption => ({ name, type: 'pins', maxItems: 64, pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$', reserved: ['in', 'out'] });
const text = (name: string, minLength = 0, maxLength?: number): SchematicTextOption => ({ name, type: 'text', minLength, ...(maxLength === undefined ? {} : { maxLength }) });

const schemas: Partial<Record<ComponentKind, Omit<SchematicComponentSchema, 'kind'>>> = {};
const define = (kinds: readonly string[], family: SchematicComponentFamily, options: readonly SchematicOptionSchema[], extra: Partial<SchematicComponentSchema> = {}) => {
	for (const kind of kinds) schemas[kind as ComponentKind] = { family, options, ...extra };
};

define(['resistor'], 'electrical', [variant(['fixed', 'variable', 'rheostat', 'potentiometer', 'thermistor', 'ldr'], 'fixed'), orientation]);
define(['capacitor'], 'electrical', [variant(['fixed', 'variable', 'polarized'], 'fixed'), orientation]);
define(['inductor'], 'electrical', [variant(['fixed', 'coupled', 'transformer'], 'fixed'), orientation]);
define(['diode'], 'electrical', [variant(DIODE_TYPES, 'standard'), orientation]);
define(['transistor'], 'electrical', [variant(TRANSISTOR_TYPES, 'npn'), orientation]);
define(['port'], 'electrical', [busWidth(1, 1), orientation]);
define(['ground'], 'electrical', [{ name: 'style', type: 'enum', values: GROUND_STYLES, default: 'signal' }, orientation]);
define(['junction', 'testpoint'], 'electrical', []);
define(['connector'], 'electrical', [orientation]);
for (const [kind, values, fallback] of [
	['source', SOURCE_TYPES, 'voltage-dc'],
	['power', POWER_TYPES, 'vcc'],
	['switch', SWITCH_TYPES, 'spst'],
	['protection', PROTECTION_TYPES, 'fuse'],
	['amplifier', AMPLIFIER_TYPES, 'opamp'],
	['resonator', RESONATOR_TYPES, 'crystal'],
	['meter', METER_TYPES, 'voltmeter'],
	['load', LOAD_TYPES, 'lamp']
] as const) {
	define([kind], 'electrical', [variant(values, fallback), orientation]);
}
define(['ic'], 'electrical', [pins('left'), pins('right'), pins('top'), pins('bottom'), orientation, fit], {
	requiresOneOf: ['left', 'right', 'top', 'bottom'],
	conflicts: FIT_CONFLICT
});

for (const kind of CLASSICAL_GATE_KINDS) {
	define([kind], 'digital', [count('inputs', kind === 'not' ? 1 : 2), count('outputs', 1), { name: 'standard', type: 'enum', values: ['ieee', 'iec'], default: 'ieee' }, orientation]);
}
define(['buffer'], 'digital', [variant(BUFFER_TYPES, 'plain'), count('inputs', 1, 1, 1), count('outputs', 1, 1, 1), orientation]);
define(['logic'], 'digital', [variant(LOGIC_STATES, 'low'), count('outputs', 1, 1, 1), orientation]);
define(['clock'], 'digital', [count('outputs', 1, 1, 1), orientation]);
const block = (inputs: SchematicNumberOption, outputs: SchematicNumberOption, ...more: SchematicOptionSchema[]) => [...more, inputs, outputs, orientation, fit];
define(['flipflop'], 'digital', block(count('inputs', 3), count('outputs', 2), variant(FLIPFLOP_TYPES, 'd')), { conflicts: FIT_CONFLICT });
define(['mux'], 'digital', block(count('inputs', 2, 1, 32, { demux: 1 }), count('outputs', 1, 1, 32, { demux: 2 }), variant(MUX_TYPES, 'mux')), { conflicts: FIT_CONFLICT });
define(['encoder'], 'digital', block(count('inputs', 4), count('outputs', 2)), { conflicts: FIT_CONFLICT });
define(['decoder'], 'digital', block(count('inputs', 2), count('outputs', 4)), { conflicts: FIT_CONFLICT });
define(['register'], 'digital', [...block(count('inputs', 3), count('outputs', 2)), busWidth(8, 1)], { conflicts: FIT_CONFLICT });
define(['counter'], 'digital', block(count('inputs', 3), count('outputs', 2)), { conflicts: FIT_CONFLICT });
define(['adder'], 'digital', block(count('inputs', 2, 1, 32, { full: 3 }), count('outputs', 2), variant(ADDER_TYPES, 'half')), { conflicts: FIT_CONFLICT });
define(['comparator'], 'digital', block(count('inputs', 2), count('outputs', 3)), { conflicts: FIT_CONFLICT });
define(['bus'], 'digital', [...block(count('inputs', 1), count('outputs', 2, 1, 32, { joiner: 1 }), variant(BUS_TYPES, 'splitter')), busWidth(8, 2)], {
	conflicts: FIT_CONFLICT
});

define(['hadamard'], 'quantum', [orientation]);
define(['qgate', ...NAMED_QUANTUM_GATE_KINDS], 'quantum', [text('parameter'), text('phase'), text('matrix'), orientation]);
define(['cnot'], 'quantum', [orientation, fit], { conflicts: FIT_CONFLICT });
define(['measure', 'reset', 'prepare', 'classical-bit'], 'quantum', [orientation]);
const controlOpt: SchematicEnumOption = { name: 'control', type: 'enum', values: ['positive', 'negative', 'classical'], default: 'positive' };
define(['control'], 'quantum', [controlOpt, orientation]);
define(['controlled'], 'quantum', [controlOpt, text('operator'), count('controls', 1), count('targets', 1), orientation, fit], { conflicts: FIT_CONFLICT });
define(['cz', 'cphase'], 'quantum', [count('controls', 1), count('targets', 1), orientation, fit], { conflicts: FIT_CONFLICT });
define(['toffoli'], 'quantum', [count('controls', 2), count('targets', 1), orientation, fit], { conflicts: FIT_CONFLICT });
define(['swap'], 'quantum', [count('controls', 0), count('targets', 2), orientation, fit], { conflicts: FIT_CONFLICT });
define(['barrier', 'delay'], 'quantum', [count('wires', 2), orientation, fit], { conflicts: FIT_CONFLICT });
define(['classical-register'], 'quantum', [busWidth(8, 2), orientation]);

define(['class', 'interface', 'enumeration', 'datatype', 'object'], 'uml', [rows('attributes'), rows('operations'), text('stereotype', 1, 128), dimension('width')]);
define(['state'], 'uml', [rows('details'), dimension('width')]);
define(['history'], 'uml', [{ name: 'type', type: 'enum', values: ['shallow', 'deep'], default: 'shallow' }]);
define(
	'usecase lifeline note package component artifact node device execution system action object-node partition activation fragment interaction region'.split(' '),
	'uml',
	[dimension('width'), dimension('height')]
);
define(
	'actor provided-interface required-interface component-port decision merge fork join activity-final flow-final send-signal receive-signal destruction gate found lost choice state-junction entry exit terminate initial final'.split(' '),
	'uml',
	[]
);

export const SCHEMATIC_COMPONENT_SCHEMAS: Readonly<Record<ComponentKind, SchematicComponentSchema>> = Object.freeze(
	Object.fromEntries(COMPONENT_KINDS.map((kind) => [kind, Object.freeze({ kind, ...schemas[kind]! })]))
) as Readonly<Record<ComponentKind, SchematicComponentSchema>>;

const range = (prefix: string, total: number): string[] => Array.from({ length: total }, (_, i) => `${prefix}${i + 1}`);
const DEPENDENT_SOURCES = new Set(['vcvs', 'vccs', 'ccvs', 'cccs']);
const GATES = new Set<string>(CLASSICAL_GATE_KINDS);
const MULTI_QUANTUM = new Set(['swap', 'cz', 'cphase', 'toffoli', 'controlled', 'barrier', 'delay']);
const PIN_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const FIXED_PORTS: Readonly<Record<string, readonly string[]>> = {
	diode: ['anode', 'cathode'],
	ground: ['in'],
	power: ['in'],
	junction: ['node'],
	testpoint: ['node'],
	amplifier: ['positive', 'negative', 'out', 'v+', 'v-'],
	logic: ['out'],
	clock: ['out'],
	prepare: ['out'],
	comparator: ['in1', 'in2', 'gt', 'eq', 'lt'],
	cnot: ['in1', 'in2', 'out1', 'out2', 'control', 'target'],
	measure: ['in', 'out', 'classical'],
	control: ['in', 'out', 'control']
};

export function describeComponentPorts(kind: string, options: Readonly<Record<string, string>> = {}): readonly string[] {
	const schema = SCHEMATIC_COMPONENT_SCHEMAS[kind as ComponentKind];
	if (schema === undefined) throw new SchematicSyntaxError(`Unsupported component kind ${kind}.`, undefined, undefined, 'reference');
	const byName = new Map(schema.options.map((opt) => [opt.name, opt]));
	for (const key of Object.keys(options)) {
		if (!byName.has(key)) throw new SchematicSyntaxError(`Option ${key} is not supported.`);
	}
	if (schema.conflicts !== undefined) {
		for (const [a, b] of schema.conflicts) {
			if (options[a] !== undefined && options[b] !== undefined) {
				throw new SchematicSyntaxError('fit=wires lines terminals up with their wires vertically; remove orientation or fit.', undefined, undefined, 'option');
			}
		}
	}
	const typeOpt = byName.get('type') as SchematicEnumOption | undefined;
	let chosenType = '';
	if (typeOpt !== undefined) {
		const rawType = options.type;
		if (rawType !== undefined && !typeOpt.values.includes(rawType)) {
			throw new SchematicSyntaxError(`Option type must be one of: ${typeOpt.values.join(', ')}.`);
		}
		chosenType = rawType ?? typeOpt.default!;
	}

	const vals: Record<string, number> = {};
	const icPins: string[] = [];
	const seenPins = new Set<string>();
	for (const opt of schema.options) {
		const raw = options[opt.name];
		switch (opt.type) {
			case 'enum':
				if (opt.name !== 'type' && raw !== undefined && !opt.values.includes(raw)) {
					throw new SchematicSyntaxError(`Option ${opt.name} must be one of: ${opt.values.join(', ')}.`);
				}
				break;
			case 'integer':
			case 'number':
				if (raw === undefined) {
					if (opt.type === 'integer') vals[opt.name] = opt.defaultsByType?.[chosenType] ?? opt.default!;
				} else {
					const num = Number(raw);
					if (!(opt.type === 'integer' ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(raw) || num < opt.min || num > opt.max) {
						throw new SchematicSyntaxError(`${opt.name} must be ${opt.type === 'integer' ? 'an integer' : 'a finite number'} from ${opt.min} through ${opt.max}.`);
					}
					vals[opt.name] = num;
				}
				break;
			case 'text':
				if (raw !== undefined && (raw.length < opt.minLength || (opt.maxLength !== undefined && raw.length > opt.maxLength))) {
					throw new SchematicSyntaxError(`${opt.name} must contain ${opt.minLength} through ${opt.maxLength} characters.`);
				}
				break;
			case 'pins':
				if (raw !== undefined && raw.trim() !== '') {
					const list = raw.split(',').map((p) => p.trim());
					if (list.length > opt.maxItems) throw new SchematicSyntaxError(`${opt.name} supports at most ${opt.maxItems} IC pins.`);
					for (const pin of list) {
						if (!PIN_RE.test(pin)) throw new SchematicSyntaxError(`Invalid IC pin name ${pin || '(empty)'}.`);
						if (opt.reserved.includes(pin)) throw new SchematicSyntaxError(`IC pin ${pin} collides with the reserved ${pin} alias. Use ${pin}1 or another pin name.`);
						if (seenPins.has(pin)) throw new SchematicSyntaxError(`Duplicate IC pin ${pin}.`);
						seenPins.add(pin);
						icPins.push(pin);
					}
				}
				break;
			case 'rows':
				if (raw !== undefined && raw.trim() !== '') {
					const list = raw.split(';').map((r) => r.trim());
					if (list.length > opt.maxItems) throw new SchematicSyntaxError(`${opt.name} supports at most ${opt.maxItems} rows.`);
					for (const r of list) {
						if (r === '' || r.length > opt.maxLength) throw new SchematicSyntaxError(`${opt.name} rows must contain 1 through ${opt.maxLength} characters.`);
					}
				}
				break;
		}
	}
	if (kind === 'ic') {
		if (icPins.length === 0) throw new SchematicSyntaxError('An IC must declare at least one pin.');
		return icPins;
	}
	if (schema.family === 'uml') return ['left', 'right', 'top', 'bottom'];
	const fixed = FIXED_PORTS[kind];
	if (fixed !== undefined) return fixed;
	if (GATES.has(kind)) return [...range('in', vals.inputs!), ...range('out', vals.outputs!)];
	if (MULTI_QUANTUM.has(kind)) {
		const c = vals.controls ?? 0;
		const t = vals.targets ?? 0;
		const tracks = Math.max(vals.wires ?? 1, c + t);
		return [...range('in', tracks), ...range('out', tracks), ...range('control', c), ...range('target', t)];
	}
	switch (kind) {
		case 'transistor': return chosenType === 'npn' || chosenType === 'pnp' ? ['base', 'collector', 'emitter'] : ['gate', 'drain', 'source'];
		case 'source': return DEPENDENT_SOURCES.has(chosenType) ? ['negative', 'positive', 'control-positive', 'control-negative'] : ['negative', 'positive'];
		case 'switch': return chosenType === 'spdt' ? ['common', 'normally-open', 'normally-closed'] : chosenType === 'relay' ? ['in', 'out', 'coil1', 'coil2'] : ['in', 'out'];
		case 'flipflop': return [
			...(chosenType === 'jk' ? ['j', 'k'] : chosenType === 't' ? ['t'] : chosenType === 'sr-latch' ? ['s', 'r'] : ['d']),
			'q', 'nq', chosenType === 'sr-latch' ? 'enable' : 'clock',
			...(chosenType === 'd' || chosenType === 't' ? ['preset', 'clear'] : ['preset'])
		];
		case 'register': return ['in', ...range('in', vals.inputs!).slice(1), 'out', ...range('out', vals.outputs!).slice(1), 'clock', 'enable', 'clear'];
		case 'bus': return chosenType === 'tap' ? ['bus', 'tap'] : chosenType === 'joiner' ? [...range('in', vals.inputs!), 'bus'] : ['bus', ...range('out', vals.outputs!)];
		case 'buffer': return ['in1', 'out1', ...(chosenType.startsWith('tristate') ? ['enable'] : [])];
		case 'mux': return [...range('in', vals.inputs!), ...range('out', vals.outputs!), 'select', 'enable'];
		case 'counter': return [...range('in', vals.inputs!), ...range('out', vals.outputs!), 'clock', 'enable', 'clear'];
		case 'encoder':
		case 'decoder':
		case 'adder': return [...range('in', vals.inputs!), ...range('out', vals.outputs!)];
		default: return ['in', 'out'];
	}
}
