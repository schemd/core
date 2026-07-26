import { describe, expect, it } from 'vitest';

import { buildNetlist, parseSchematic, parseSchematicFence } from '../src/index.js';
import { describeNetlist, describeSchematic, joinPhrases } from '../src/describe.js';

const fence = parseSchematicFence('schemd bounds="900x600" title="Description fixture"')!;
const parse = (source: string) => parseSchematic(source, fence);

const RC = `source:VIN "V_{in}" at (80, 120) #blue [type=voltage-ac]
resistor:R1 "10 k\\Omega" at (260, 120) #amber
junction:VOUT "output node" at (440, 120) #cyan
capacitor:C1 "100 nF" at (440, 242) #cyan [orientation=down]
ground:GND "0 V" at (220, 350) #slate
port:OUT "V_{out}" at (680, 120) #emerald

VIN.positive -> R1.in #blue [line]
VIN.negative -> GND.in #slate [ortho]
R1.out -> VOUT.node #amber [line]
VOUT.node -> C1.in #cyan [line]
C1.out -> GND.in #cyan [ortho]
VOUT.node -> OUT.in #emerald [line marker-end=arrow]`;

describe('joinPhrases', () => {
	it('reads lists the way a person would', () => {
		expect(joinPhrases([])).toBe('');
		expect(joinPhrases(['one'])).toBe('one');
		expect(joinPhrases(['one', 'two'])).toBe('one and two');
		expect(joinPhrases(['one', 'two', 'three'])).toBe('one, two, and three');
	});
});

describe('describeSchematic', () => {
	it('states scale and domain in a sentence fit for an alt attribute', () => {
		const description = describeSchematic(parse(RC));
		expect(description.headline).toBe(
			'Six components joined by three nets, carrying electrical signals.'
		);
		expect(description.counts).toEqual({ components: 6, nets: 3, connections: 6 });
		expect(description.domains).toEqual(['electrical']);
	});

	it('flattens the compiler math syntax labels carry', () => {
		const description = describeSchematic(parse(RC));
		/* `V_{in}` is glyph-layout syntax, not something to read aloud. */
		expect(description.inventory).toContain('VIN (Vin)');
		expect(description.inventory).toContain('R1 (10 kΩ)');
		expect(description.inventory).not.toContain('_{');
		expect(description.inventory).not.toContain('\\Omega');
	});

	it('names each net and the terminals it ties', () => {
		const description = describeSchematic(parse(RC));
		expect(description.connections).toHaveLength(3);
		expect(description.connections).toContain('An unnamed net ties VIN.positive and R1.in.');
		expect(description.connections).toContain(
			'An unnamed net ties R1.out, VOUT.node, C1.in, and OUT.in.'
		);
	});

	it('uses an author-declared net name when the source supplies one', () => {
		const source = `port:A "A" at (100, 150) #blue
port:B "B" at (400, 150) #blue
A.out -> B.in #blue [line net=bus]`;
		const description = describeSchematic(parse(source));
		expect(description.connections[0]).toBe('Net bus ties A.out and B.in.');
	});

	it('groups repeated kinds and pluralises their nouns', () => {
		const source = `resistor:R1 "1 k" at (100, 120) #amber
resistor:R2 "2 k" at (300, 120) #amber
resistor:R3 "3 k" at (500, 120) #amber
mux:M1 "M" at (300, 320) #cyan
R1.out -> R2.in #amber [line]
R2.out -> R3.in #amber [line]`;
		const description = describeSchematic(parse(source));
		expect(description.inventory).toContain('three resistors (R1 (1 k), R2 (2 k), R3 (3 k))');
		expect(description.inventory).toContain('one multiplexer M1 (M)');
	});

	it('spells the nouns that are not their kind identifier', () => {
		const source = `prepare:Q0 "q_0" at (80, 120) #blue
hadamard:H1 "H" at (280, 120) #cyan
cnot:CX "CNOT" at (480, 200) #purple
measure:M0 "M" at (700, 120) #emerald
Q0.out -> H1.in #blue [quantum]
H1.out -> CX.in1 #cyan [quantum]
CX.out1 -> M0.in #purple [quantum]`;
		const description = describeSchematic(parse(source));
		expect(description.inventory).toContain('one state preparation Q0');
		expect(description.inventory).toContain('one Hadamard gate H1');
		expect(description.inventory).toContain('one CNOT gate CX');
		expect(description.inventory).toContain('one measurement M0');
		expect(description.domains).toEqual(['quantum']);
	});

	it('falls back to the id when a label only repeats it', () => {
		const source = `port:A "A" at (100, 150) #blue
port:B "B" at (400, 150) #blue
A.out -> B.in #blue [line]`;
		const description = describeSchematic(parse(source));
		expect(description.inventory).toBe('It contains two ports (A, B).');
	});

	it('reports several domains when a document mixes them', () => {
		const source = `port:A "A" at (80, 120) #blue [width=8]
register:REG "Q" at (330, 120) #purple [width=8]
port:Q "Q" at (620, 120) #emerald [width=8]
resistor:R1 "R" at (200, 380) #amber
capacitor:C1 "C" at (520, 380) #cyan
A.out -> REG.in #blue [digital width=8]
REG.out -> Q.in #emerald [digital width=8]
R1.out -> C1.in #amber [line]`;
		const description = describeSchematic(parse(source));
		expect(description.domains.length).toBeGreaterThan(1);
		expect(description.headline).toContain(' and ');
		expect(description.headline).toContain('signals.');
	});

	it('describes a document that declares nothing', () => {
		const description = describeNetlist(buildNetlist({ components: [], connections: [] }));
		expect(description.headline).toBe('No components joined by no nets, carrying no wired signals.');
		expect(description.inventory).toBe('The diagram declares no components.');
		expect(description.connections).toEqual([]);
		expect(description.text).toBe(
			'No components joined by no nets, carrying no wired signals. The diagram declares no components.'
		);
	});

	it('uses singular nouns for a single component on a single net', () => {
		const source = `port:A "A" at (100, 150) #blue
port:B "B" at (400, 150) #blue
A.out -> B.in #blue [line]`;
		const description = describeSchematic(parse(source));
		expect(description.headline).toBe(
			'Two components joined by one net, carrying electrical signals.'
		);
	});

	it('counts past ten in digits', () => {
		const lines: string[] = [];
		for (let index = 0; index < 12; index += 1) {
			lines.push(
				`port:P${index} "p" at (${70 + (index % 6) * 140}, ${120 + Math.floor(index / 6) * 220}) #blue`
			);
		}
		for (let index = 0; index + 1 < 12; index += 1) {
			lines.push(`P${index}.out -> P${index + 1}.in #blue [line]`);
		}
		const description = describeSchematic(parse(lines.join('\n')));
		expect(description.headline).toContain('12 components');
		expect(description.inventory).toContain('12 ports');
	});

	it('pluralises sibilant and consonant-y nouns correctly', () => {
		const sibilant = `switch:S1 "S" at (120, 120) #amber
switch:S2 "S" at (380, 120) #amber
bus:B1 "B" at (120, 340) #cyan
bus:B2 "B" at (380, 340) #cyan
S1.out -> S2.in #amber [line]`;
		const description = describeSchematic(parse(sibilant));
		expect(description.inventory).toContain('two switches');
		expect(description.inventory).toContain('two buses');

		const consonantY = `entry:E1 "start" at (150, 150) #blue
entry:E2 "resume" at (450, 150) #blue`;
		expect(describeSchematic(parse(consonantY)).inventory).toContain('two entries');
	});

	it('describes a lone component in the singular', () => {
		const description = describeSchematic(parse('resistor:R1 "1 k" at (200, 150) #amber'));
		expect(description.headline).toBe(
			'One component joined by no nets, carrying no wired signals.'
		);
		expect(description.inventory).toBe('It contains one resistor R1 (1 k).');
		expect(description.connections).toEqual([]);
	});

	it('is a pure function of the document', () => {
		expect(describeSchematic(parse(RC)).text).toBe(describeSchematic(parse(RC)).text);
	});

	it('describes an isolated terminal without inventing a partner', () => {
		const source = `resistor:R1 "R" at (200, 150) #amber
capacitor:C1 "C" at (500, 150) #cyan
R1.out -> C1.in #amber [line]`;
		const netlist = buildNetlist(parse(source));
		const lonely = {
			...netlist,
			nets: [
				...netlist.nets,
				{
					id: '$solo',
					name: 'solo',
					signalKinds: [] as const,
					widths: [] as const,
					terminals: [{ componentId: 'R1', port: 'in' }],
					lines: [1]
				}
			]
		};
		expect(describeNetlist(lonely).connections).toContain('Net solo reaches only R1.in.');
	});

	it('skips a net that ties no terminals at all', () => {
		const netlist = buildNetlist(parse(RC));
		const withEmpty = {
			...netlist,
			nets: [
				...netlist.nets,
				{
					id: '$empty',
					name: undefined,
					signalKinds: [] as const,
					widths: [] as const,
					terminals: [] as const,
					lines: [] as const
				}
			]
		};
		expect(describeNetlist(withEmpty).connections).toHaveLength(3);
	});
});
