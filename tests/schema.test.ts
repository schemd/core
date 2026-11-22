/**
 * The component schema is a claim about the parser, and this suite holds it to
 * the claim.
 *
 * The parser checks options in code; the schema states them as data. Nothing
 * ties the two together except these probes, run for every kind and every
 * option: each declared value compiles, each value just past a declared bound
 * fails, each option a kind does not declare fails, and each declared default
 * draws exactly the figure that leaving the option out draws. A schema that
 * drifts from the parser in any direction fails here, by kind and option.
 */
import { describe, expect, test } from 'vitest';

import { COMPONENT_KINDS, compileSchematic, diagnoseSchematic, enumerateComponentPorts, parseSchematic, SchematicSyntaxError, type SchematicFence } from '../src/index.js';
import { describeComponentPorts, SCHEMATIC_COMPONENT_SCHEMAS, type SchematicOptionSchema } from '../src/schema.js';

const fence: SchematicFence = { bounds: { width: 4000, height: 4000 }, title: 'Schema' };

function declaration(kind: string, options: Readonly<Record<string, string>>): string {
	const written = Object.entries(options).map(([name, value]) => `${name}="${value}"`);
	return `${kind}:X at (2000, 2000) #slate${written.length === 0 ? '' : ` [${written.join(' ')}]`}`;
}

/* An IC with no pins is invalid on its own, so its probes carry one unless they test pins. */
function base(kind: string, testing: string): Record<string, string> {
	const schema = SCHEMATIC_COMPONENT_SCHEMAS[kind as keyof typeof SCHEMATIC_COMPONENT_SCHEMAS];
	if (schema.requiresOneOf === undefined || schema.requiresOneOf.includes(testing)) return {};
	return { [schema.requiresOneOf[0]!]: 'p' };
}

function accepts(kind: string, name: string, value: string): boolean {
	return diagnoseSchematic(declaration(kind, { ...base(kind, name), [name]: value }), fence).length === 0;
}

function svg(kind: string, options: Readonly<Record<string, string>>): string {
	/* A fixed namespace: the default one hashes the source, which differs by design. */
	return compileSchematic(declaration(kind, { ...base(kind, ''), ...options }), { ...fence, idPrefix: 'probe' }).svg;
}

const pinList = (count: number) => Array.from({ length: count }, (_, index) => `p${index + 1}`).join(',');
const rowList = (count: number) => Array.from({ length: count }, (_, index) => `r${index + 1}`).join(';');

/** Values the option must accept. */
function valid(option: SchematicOptionSchema): string[] {
	switch (option.type) {
		case 'enum':
			return [...option.values];
		case 'integer':
		case 'number':
			return [String(option.min), String(option.max)];
		case 'text':
			return ['x'.repeat(option.minLength), ...(option.maxLength === undefined ? ['a longer value, with spaces'] : ['x'.repeat(option.maxLength)])];
		case 'pins':
			return ['a,b', pinList(option.maxItems)];
		case 'rows':
			return ['one;two', rowList(option.maxItems), 'r'.repeat(option.maxLength)];
	}
}

/** Values the option must reject. */
function invalid(option: SchematicOptionSchema): string[] {
	switch (option.type) {
		case 'enum':
			return ['not-a-value'];
		case 'integer':
			return [String(option.min - 1), String(option.max + 1), '1.5'];
		case 'number':
			return [String(option.min - 1), String(option.max + 1), 'wide'];
		case 'text':
			return [...(option.minLength > 0 ? ['x'.repeat(option.minLength - 1)] : []), ...(option.maxLength === undefined ? [] : ['x'.repeat(option.maxLength + 1)])];
		case 'pins':
			return [pinList(option.maxItems + 1), '9p', option.reserved[0]!, 'a,a'];
		case 'rows':
			return [rowList(option.maxItems + 1), 'r'.repeat(option.maxLength + 1)];
	}
}

const kinds = Object.keys(SCHEMATIC_COMPONENT_SCHEMAS);
const everyOption = new Map<string, SchematicOptionSchema>();
for (const schema of Object.values(SCHEMATIC_COMPONENT_SCHEMAS)) for (const option of schema.options) if (!everyOption.has(option.name)) everyOption.set(option.name, option);

describe('the component schema', () => {
	test('describes every kind the compiler accepts, and nothing else', () => {
		expect([...kinds].sort()).toEqual([...COMPONENT_KINDS].sort());
		for (const kind of kinds) expect(SCHEMATIC_COMPONENT_SCHEMAS[kind as keyof typeof SCHEMATIC_COMPONENT_SCHEMAS].kind).toBe(kind);
	});

	test('is frozen', () => {
		expect(Object.isFrozen(SCHEMATIC_COMPONENT_SCHEMAS)).toBe(true);
		expect(Object.isFrozen(SCHEMATIC_COMPONENT_SCHEMAS.resistor)).toBe(true);
	});

	test('names each option once per kind', () => {
		for (const schema of Object.values(SCHEMATIC_COMPONENT_SCHEMAS)) {
			const names = schema.options.map((option) => option.name);
			expect(new Set(names).size, schema.kind).toBe(names.length);
		}
	});

	test.each(kinds)('%s accepts every value it declares', (kind) => {
		for (const option of SCHEMATIC_COMPONENT_SCHEMAS[kind as keyof typeof SCHEMATIC_COMPONENT_SCHEMAS].options) {
			for (const value of valid(option)) expect(accepts(kind, option.name, value), `${kind} ${option.name}="${value}"`).toBe(true);
		}
	});

	test.each(kinds)('%s rejects every value just outside what it declares', (kind) => {
		for (const option of SCHEMATIC_COMPONENT_SCHEMAS[kind as keyof typeof SCHEMATIC_COMPONENT_SCHEMAS].options) {
			for (const value of invalid(option)) expect(accepts(kind, option.name, value), `${kind} ${option.name}="${value}"`).toBe(false);
		}
	});

	test.each(kinds)('%s rejects every option it does not declare', (kind) => {
		const declared = new Set(SCHEMATIC_COMPONENT_SCHEMAS[kind as keyof typeof SCHEMATIC_COMPONENT_SCHEMAS].options.map((option) => option.name));
		for (const [name, option] of [...everyOption, ['bogus', { name: 'bogus', type: 'text', minLength: 1 }] as const]) {
			if (declared.has(name)) continue;
			expect(accepts(kind, name, valid(option)[0]!), `${kind} ${name}`).toBe(false);
		}
	});

	test.each(kinds)('%s draws its declared defaults exactly as it draws them left out', (kind) => {
		const schema = SCHEMATIC_COMPONENT_SCHEMAS[kind as keyof typeof SCHEMATIC_COMPONENT_SCHEMAS];
		for (const option of schema.options) {
			if (option.type !== 'enum' && option.type !== 'integer' && option.type !== 'number') continue;
			/* A default below the written minimum, such as a swap's zero controls, cannot be written. */
			if (option.default !== undefined && (option.type === 'enum' || option.default >= option.min)) {
				expect(svg(kind, { [option.name]: String(option.default) }), `${kind} ${option.name}`).toBe(svg(kind, {}));
			}
			if (option.type !== 'enum' && option.defaultsByType !== undefined) {
				for (const [type, value] of Object.entries(option.defaultsByType)) {
					expect(svg(kind, { type, [option.name]: String(value) }), `${kind} type=${type} ${option.name}`).toBe(svg(kind, { type }));
				}
			}
		}
	});

	test('a default that depends on type differs from the plain default', () => {
		/* Otherwise defaultsByType would be decoration. */
		expect(svg('adder', { type: 'full' })).not.toBe(svg('adder', { type: 'full', inputs: '2' }));
		expect(svg('mux', { type: 'demux' })).not.toBe(svg('mux', { type: 'demux', outputs: '1' }));
		expect(svg('bus', { type: 'joiner' })).not.toBe(svg('bus', { type: 'joiner', outputs: '2' }));
	});

	test('requires one of exactly the options that satisfy the parser', () => {
		expect(diagnoseSchematic(declaration('ic', {}), fence)).not.toEqual([]);
		/* Derived from the parser, not from the list: every option that alone makes a valid IC must be listed. */
		const satisfying = SCHEMATIC_COMPONENT_SCHEMAS.ic.options
			.filter((option) => diagnoseSchematic(declaration('ic', { [option.name]: valid(option)[0]! }), fence).length === 0)
			.map((option) => option.name);
		expect([...SCHEMATIC_COMPONENT_SCHEMAS.ic.requiresOneOf!].sort()).toEqual(satisfying.sort());
	});

	test.each(kinds.filter((kind) => SCHEMATIC_COMPONENT_SCHEMAS[kind as keyof typeof SCHEMATIC_COMPONENT_SCHEMAS].conflicts !== undefined))(
		'%s rejects the option pairs it says conflict',
		(kind) => {
			for (const [first, second] of SCHEMATIC_COMPONENT_SCHEMAS[kind as keyof typeof SCHEMATIC_COMPONENT_SCHEMAS].conflicts!) {
				const value = (name: string) => valid(everyOption.get(name)!)[0]!;
				expect(accepts(kind, first, value(first)), kind).toBe(true);
				expect(diagnoseSchematic(declaration(kind, { ...base(kind, first), [first]: value(first), [second]: value(second) }), fence), kind).not.toEqual([]);
			}
		}
	);

	test('declares a conflict wherever fit and orientation are both accepted', () => {
		for (const schema of Object.values(SCHEMATIC_COMPONENT_SCHEMAS)) {
			const names = schema.options.map((option) => option.name);
			if (names.includes('fit') && names.includes('orientation')) expect(schema.conflicts, schema.kind).toContainEqual(['fit', 'orientation']);
		}
	});
});

describe('describeComponentPorts', () => {
	test('asks the parser, so ports follow the options', () => {
		expect(describeComponentPorts('resistor')).toEqual(['in', 'out']);
		expect(describeComponentPorts('and', { inputs: '3' })).toEqual(['in1', 'in2', 'in3', 'out1']);
		expect(describeComponentPorts('switch', { type: 'spdt' })).toEqual(['common', 'normally-open', 'normally-closed']);
		expect(describeComponentPorts('source', { type: 'vcvs' })).toEqual(['negative', 'positive', 'control-positive', 'control-negative']);
		expect(describeComponentPorts('ic', { left: 'VIN,EN', right: 'OUT' })).toEqual(['VIN', 'EN', 'OUT']);
	});

	test('rejects a bad option with the parser’s own message, and no line', () => {
		const attempt = () => describeComponentPorts('resistor', { tolerance: '1%' });
		expect(attempt).toThrow(SchematicSyntaxError);
		expect(attempt).toThrow(/^Option tolerance is not supported\.$/);
		try {
			attempt();
		} catch (error) {
			expect((error as SchematicSyntaxError).line).toBeUndefined();
		}
	});

	test('rejects an unknown kind', () => {
		expect(() => describeComponentPorts('flux-capacitor')).toThrow('Unsupported component kind flux-capacitor.');
	});

	test('matches enumerateComponentPorts across every kind and every declared variant', () => {
		for (const kind of kinds) {
			const schema = SCHEMATIC_COMPONENT_SCHEMAS[kind as keyof typeof SCHEMATIC_COMPONENT_SCHEMAS];
			const req = base(kind, '');
			const parsed = parseSchematic(declaration(kind, req), fence).components[0]!;
			expect(describeComponentPorts(kind, req), kind).toEqual(enumerateComponentPorts(parsed).map((p) => p.id));
			const typeOpt = schema.options.find((o) => o.name === 'type' && o.type === 'enum');
			if (typeOpt !== undefined && typeOpt.type === 'enum') {
				for (const value of typeOpt.values) {
					const opts = { ...req, type: value };
					const comp = parseSchematic(declaration(kind, opts), fence).components[0]!;
					expect(describeComponentPorts(kind, opts), `${kind} type=${value}`).toEqual(enumerateComponentPorts(comp).map((p) => p.id));
				}
			}
		}
	});

	test('validates option types, bounds, conflicts, pins, and rows identically to the parser', () => {
		expect(() => describeComponentPorts('cnot', { fit: 'wires', orientation: 'down' })).toThrow('fit=wires');
		expect(() => describeComponentPorts('resistor', { type: 'bogus' })).toThrow('Option type must be one of');
		expect(() => describeComponentPorts('resistor', { orientation: 'diagonal' })).toThrow('Option orientation must be one of');
		expect(() => describeComponentPorts('and', { inputs: '0' })).toThrow('inputs must be an integer');
		expect(() => describeComponentPorts('class', { width: '10' })).toThrow('width must be a finite number');
		expect(describeComponentPorts('class', { width: '160', stereotype: 'service', attributes: 'a;b', operations: 'f()' })).toEqual(['left', 'right', 'top', 'bottom']);
		expect(() => describeComponentPorts('class', { stereotype: '' })).toThrow('stereotype must contain');
		expect(() => describeComponentPorts('class', { stereotype: 'x'.repeat(129) })).toThrow('stereotype must contain');
		expect(describeComponentPorts('qgate', { parameter: 'theta' })).toEqual(['in', 'out']);
		expect(() => describeComponentPorts('ic', {})).toThrow('An IC must declare at least one pin.');
		expect(() => describeComponentPorts('ic', { left: Array.from({ length: 65 }, (_, i) => `P${i}`).join(',') })).toThrow('supports at most 64 IC pins');
		expect(() => describeComponentPorts('ic', { left: '1BAD' })).toThrow('Invalid IC pin name');
		expect(() => describeComponentPorts('ic', { left: 'A,' })).toThrow('Invalid IC pin name (empty)');
		expect(() => describeComponentPorts('ic', { left: 'in' })).toThrow('collides with the reserved');
		expect(() => describeComponentPorts('ic', { left: 'A,A' })).toThrow('Duplicate IC pin A');
		expect(() => describeComponentPorts('class', { attributes: Array.from({ length: 65 }, (_, i) => `a${i}`).join(';') })).toThrow('supports at most 64 rows');
		expect(() => describeComponentPorts('class', { attributes: 'a;;b' })).toThrow('attributes rows must contain');
	});
});
