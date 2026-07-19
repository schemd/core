import { describe, expect, test } from 'vitest';
import {
	compileSchematic,
	parseSchematic,
	parseSchematicFence,
	renderSchematic,
	resolvePortGeometry,
	resolvePortPoint
} from '../src/index.js';

const fence = parseSchematicFence('schemd bounds="4096x4096" title="Primitive matrix"')!;

function grid(lines: readonly string[]): string {
	return lines
		.map((line, index) => {
			const x = 100 + (index % 20) * 190;
			const y = 100 + Math.floor(index / 20) * 170;
			return line.replace('(X,Y)', `(${x},${y})`);
		})
		.join('\n');
}

describe('phase-two primitive expansion', () => {
	test('parses and renders every electrical family through compact variants', () => {
		const declarations: string[] = [];
		for (const type of ['voltage-dc', 'voltage-ac', 'voltage-pulse', 'current-dc', 'current-ac', 'battery', 'vcvs', 'vccs', 'ccvs', 'cccs']) {
			declarations.push(`source:S${declarations.length} "${type}" at (X,Y) #blue [type=${type}]`);
		}
		for (const [kind, types] of [
			['resistor', ['fixed', 'variable', 'rheostat', 'potentiometer', 'thermistor', 'ldr']],
			['capacitor', ['fixed', 'variable', 'polarized']],
			['inductor', ['fixed', 'coupled', 'transformer']],
			['diode', ['standard', 'schottky', 'zener', 'led', 'photodiode', 'varactor', 'scr', 'triac']],
			['transistor', ['npn', 'pnp', 'nmos', 'pmos', 'njfet', 'pjfet', 'nigbt', 'pigbt']],
			['power', ['vcc', 'vdd', 'vss', 'positive', 'negative']],
			['switch', ['spst', 'spdt', 'pushbutton', 'relay']],
			['protection', ['fuse', 'breaker']],
			['amplifier', ['opamp', 'comparator', 'instrumentation']],
			['resonator', ['crystal', 'ceramic']],
			['meter', ['voltmeter', 'ammeter']],
			['load', ['lamp', 'motor', 'speaker', 'buzzer']]
		] as const) {
			for (const type of types) {
				declarations.push(`${kind}:E${declarations.length} "${type}" at (X,Y) #cyan [type=${type}]`);
			}
		}
		declarations.push('junction:J1 "node" at (X,Y) #amber');
		declarations.push('testpoint:TP1 "probe" at (X,Y) #amber');
		declarations.push('connector:C1 "terminal" at (X,Y) #amber [orientation=down]');
		const result = compileSchematic(grid(declarations), fence);
		expect(result.document.components).toHaveLength(declarations.length);
		expect(result.svg).not.toMatch(/NaN|Infinity|-0(?:\D|$)/);
	});

	test('uses exact quarter turns for vectors, ports, normals, hotspots, and bounds', () => {
		const document = parseSchematic(
			'resistor:R1 "rotated" at (200, 200) #amber [orientation=down]',
			fence
		);
		const resistor = document.components[0]!;
		expect(resolvePortPoint(resistor, 'in')).toEqual({ x: 200, y: 158 });
		expect(resolvePortGeometry(resistor, 'out')).toEqual({
			point: { x: 200, y: 242 },
			normal: { x: 0, y: 1 }
		});
		const svg = renderSchematic(document, { ...fence, mode: 'full' });
		expect(svg).toContain('transform="rotate(90)"');
		expect(svg).toContain('data-port-id="in"');
		expect(svg).toContain('cx="0" cy="-42"');
		expect(() => parseSchematic('junction:J1 "x" at (100, 100) #amber [orientation=up]', fence)).toThrow(/Option orientation/);
	});

	test('renders digital blocks, named quantum gates, track-aware structures, and UML nodes', () => {
		const declarations = [
			'xnor:XN "XNOR" at (X,Y) #cyan',
			'buffer:B1 "tri" at (X,Y) #cyan [type=tristate-inverter]',
			'logic:L1 "high" at (X,Y) #cyan [type=high]',
			'clock:CLK "clock" at (X,Y) #cyan',
			'flipflop:F1 "JK" at (X,Y) #cyan [type=jk]',
			'mux:M1 "mux" at (X,Y) #cyan [inputs=4]',
			'encoder:E1 "encoder" at (X,Y) #cyan',
			'decoder:D1 "decoder" at (X,Y) #cyan',
			'register:R1 "register" at (X,Y) #cyan [width=16]',
			'counter:C1 "counter" at (X,Y) #cyan',
			'adder:A1 "full" at (X,Y) #cyan [type=full]',
			'comparator:CMP "magnitude" at (X,Y) #cyan',
			'bus:BUS "split" at (X,Y) #cyan [type=splitter width=8 outputs=4]',
			...['xgate', 'ygate', 'zgate', 'sgate', 'sdg', 'tgate', 'tdg', 'sx', 'phase', 'rx', 'ry', 'rz', 'ugate'].map((kind, index) => `${kind}:Q${index} "${kind}" at (X,Y) #purple`),
			'measure:QM "measure" at (X,Y) #purple',
			'reset:QR "reset" at (X,Y) #purple',
			'prepare:QP "prepare" at (X,Y) #purple',
			'swap:QS "swap" at (X,Y) #purple [targets=2]',
			'control:QC "negative" at (X,Y) #purple [control=negative]',
			'toffoli:QT "toffoli" at (X,Y) #purple',
			'controlled:QG "multi" at (X,Y) #purple [controls=2 targets=2 operator="X"]',
			'barrier:QB "barrier" at (X,Y) #purple [wires=4]',
			'delay:QD "delay" at (X,Y) #purple [wires=3]',
			'classical-register:CR "c8" at (X,Y) #slate [width=8]',
			...['interface', 'provided-interface', 'required-interface', 'enumeration', 'datatype', 'object', 'component', 'component-port', 'artifact', 'node', 'device', 'execution', 'system', 'action', 'decision', 'merge', 'fork', 'join', 'activity-final', 'flow-final', 'object-node', 'send-signal', 'receive-signal', 'partition', 'activation', 'destruction', 'fragment', 'interaction', 'gate', 'found', 'lost', 'choice', 'state-junction', 'entry', 'exit', 'terminate', 'region'].map((kind, index) => `${kind}:U${index} "${kind}" at (X,Y) #slate`),
			'history:H1 "deep" at (X,Y) #slate [type=deep]'
		];
		const result = compileSchematic(grid(declarations), { ...fence, mode: 'full' });
		expect(result.document.components).toHaveLength(declarations.length);
		expect(result.svg).toContain('>H*</text>');
		expect(result.svg).toContain('data-port-id="control1"');
		expect(result.svg).not.toMatch(/NaN|Infinity/);
	});

	test('requires explicit compatible bus widths and distinguishes connection domains', () => {
		const source = `bus:B1 "bus" at (200, 200) #cyan [width=8]
port:P1 "port" at (500, 200) #cyan [width=8]
B1.bus -> P1.in #cyan [ortho width=8 signal=digital]`;
		const document = parseSchematic(source, fence);
		expect(document.connections[0]).toMatchObject({ width: 8, signalKind: 'digital' });
		expect(renderSchematic(document, { ...fence, mode: 'full' })).toContain('data-signal-kind="digital"');
		expect(() => parseSchematic(source.replace(' width=8 signal=digital', ' signal=digital'), fence)).toThrow(/explicit width/);
		expect(() => parseSchematic(source.replace('width=8 signal=digital', 'width=4 signal=digital'), fence)).toThrow(/incompatible/);
	});

	test('shares one polished shell between plain hadamard and qgate instances', () => {
		const svg = compileSchematic(
			'hadamard:H1 "Hadamard" at (150, 150) #purple\nqgate:Q1 "Custom" at (350, 150) #purple',
			fence
		).svg;
		expect(svg.match(/id="[^"]+-symbol-quantum-shell-50-50"/g)).toHaveLength(1);
		expect(svg.match(/href="#[^"]+-symbol-quantum-shell-50-50"/g)).toHaveLength(2);
	});
});
