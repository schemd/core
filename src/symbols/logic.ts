import { toMilli } from '../geom.js';
import {
	ADDER_TYPES,
	BUFFER_TYPES,
	BUS_TYPES,
	FLIPFLOP_TYPES,
	LOGIC_STATES,
	MUX_TYPES,
	SchematicSyntaxError,
	type ClassicalGateComponent,
	type DigitalComponent
} from '../types.js';
import { C, colorAttributes, count, distributed, enumOption, fit, indexed, n, only, orientation, P, R, T, u, width, type KindDef, type LocalPort } from './common.js';

export const gateHeight = (c: ClassicalGateComponent): number => Math.max(48, Math.max(c.inputs, c.outputs) * 16);

const gatePort = (c: ClassicalGateComponent, output: boolean, index: number): LocalPort => ({
	id: `${output ? 'out' : 'in'}${index + 1}`,
	x: output ? 48_000 : -48_000,
	y: distributed(index, output ? c.outputs : c.inputs, gateHeight(c) * 1000),
	nx: output ? 1 : -1,
	ny: 0
});

const OR_FAMILY = new Set(['or', 'nor', 'xor', 'xnor']);
const INVERTING = new Set(['nand', 'nor', 'xnor', 'not']);
const IEC_SYMBOLS: Readonly<Record<ClassicalGateComponent['kind'], string>> = {
	and: '&amp;', nand: '&amp;', or: '≥1', nor: '≥1', xor: '=1', xnor: '=1', not: '1'
};

function boundary(c: ClassicalGateComponent, output: boolean, y: number): number {
	if (c.standard === 'iec') return output ? 32 : -32;
	const half = gateHeight(c) / 2;
	if (!output) {
		if (OR_FAMILY.has(c.kind)) {
			const p = (1 - y / half) / 2;
			return (c.kind === 'xor' || c.kind === 'xnor' ? -38 : -32) + 40 * p * (1 - p);
		}
		return c.kind === 'not' ? -30 : -32;
	}
	if (c.kind === 'and' || c.kind === 'nand') {
		const norm = y / half;
		return 32 * Math.sqrt(Math.max(0, 1 - norm * norm));
	}
	if (OR_FAMILY.has(c.kind)) {
		const p = Math.sqrt(Math.max(0, 1 - Math.abs(y) / half));
		const q = 1 - p;
		return -32 * q * q + 6 * q * p + 32 * p * p;
	}
	return 30 - 60 * (Math.abs(y) / half);
}

const gate: KindDef<ClassicalGateComponent> = {
	parse(kind, common, options, line) {
		only(options, ['inputs', 'outputs', 'standard', 'orientation'], line);
		const standard = options.get('standard') ?? 'ieee';
		if (standard !== 'ieee' && standard !== 'iec') throw new SchematicSyntaxError('standard must be ieee or iec.', line);
		return {
			kind: kind as ClassicalGateComponent['kind'],
			...common,
			inputs: count(options.get('inputs'), kind === 'not' ? 1 : 2, 'inputs', line),
			outputs: count(options.get('outputs'), 1, 'outputs', line),
			standard,
			...orientation(options, line)
		};
	},
	extents: (c) => [48_000, gateHeight(c) * 500],
	ports(c) {
		const pts: LocalPort[] = [];
		for (let i = 0; i < c.inputs; i += 1) pts.push(gatePort(c, false, i));
		for (let i = 0; i < c.outputs; i += 1) pts.push(gatePort(c, true, i));
		return pts;
	},
	resolve(c, name) {
		const t = indexed(name, c.inputs, c.outputs);
		return t === undefined ? undefined : gatePort(c, t.output, t.index);
	},
	draw(c, p) {
		const h = gateHeight(c);
		const hm = h * 1000;
		const top = -h / 2;
		const bot = h / 2;
		const inv = INVERTING.has(c.kind);
		let out =
			c.standard === 'iec'
				? R(p, -32, top, 64, h, 2) + T('schematic-gate-symbol', 0, 4, 14, IEC_SYMBOLS[c.kind], ' text-anchor="middle"')
				: c.kind === 'not'
					? P(p, `M -30 ${top} L 30 0 L -30 ${bot} Z`)
					: c.kind === 'and' || c.kind === 'nand'
						? P(p, `M -32 ${top} H 0 A 32 ${bot} 0 0 1 0 ${bot} H -32 Z`)
						: P(p, `M -32 ${top} Q 3 ${top} 32 0 Q 3 ${bot} -32 ${bot} Q -12 0 -32 ${top} Z`) +
							(c.kind === 'xor' || c.kind === 'xnor' ? P(p, `M -38 ${top} Q -18 0 -38 ${bot}`) : '');
		if (inv) {
			for (let i = 0; i < c.outputs; i += 1) {
				const y = distributed(i, c.outputs, hm);
				out += C(p, u(boundary(c, true, y / 1000) + 4), n(y), 4);
			}
		}
		for (let i = 0; i < c.inputs; i += 1) {
			const y = distributed(i, c.inputs, hm);
			out += P(p, `M -48 ${n(y)} H ${u(boundary(c, false, y / 1000))}`);
		}
		for (let i = 0; i < c.outputs; i += 1) {
			const y = distributed(i, c.outputs, hm);
			out += P(p, `M ${u(boundary(c, true, y / 1000) + (inv ? 8 : 0))} ${n(y)} H 48`);
		}
		return out;
	}
};

const DIGITAL_DEFAULTS: Readonly<Record<DigitalComponent['kind'], readonly [number, number]>> = {
	buffer: [1, 1], logic: [0, 1], clock: [0, 1], flipflop: [3, 2], mux: [2, 1],
	encoder: [4, 2], decoder: [2, 4], register: [3, 2], counter: [3, 2], adder: [2, 2],
	comparator: [2, 3], bus: [1, 2]
};
const DIGITAL_VARIANTS: Readonly<Partial<Record<DigitalComponent['kind'], readonly [string, readonly string[]]>>> = {
	buffer: ['plain', BUFFER_TYPES], logic: ['low', LOGIC_STATES], flipflop: ['d', FLIPFLOP_TYPES],
	mux: ['mux', MUX_TYPES], adder: ['half', ADDER_TYPES], bus: ['splitter', BUS_TYPES]
};
const DIGITAL_LABELS: Readonly<Partial<Record<DigitalComponent['kind'], string>>> = {
	clock: 'CLK', encoder: 'ENC', decoder: 'DEC', register: 'REG', counter: 'CTR', comparator: 'CMP'
};
const LOGIC_TEXT: Readonly<Record<string, string>> = { high: '1', low: '0', 'high-z': 'Z', unknown: 'X' };

const range = (prefix: string, total: number) => Array.from({ length: total }, (_, i) => `${prefix}${i + 1}`);

function digitalSides(c: DigitalComponent) {
	switch (c.kind) {
		case 'logic':
		case 'clock': return { left: [] as string[], right: ['out'], bottom: [] as string[], top: [] as string[] };
		case 'flipflop': {
			const v = c.variant;
			return {
				left: v === 'jk' ? ['j', 'k'] : v === 't' ? ['t'] : v === 'sr-latch' ? ['s', 'r'] : ['d'],
				right: ['q', 'nq'],
				bottom: v === 'sr-latch' ? ['enable'] : ['clock'],
				top: v === 'd' || v === 't' ? ['preset', 'clear'] : ['preset']
			};
		}
		case 'register':
			return { left: ['in', ...range('in', c.inputs).slice(1)], right: ['out', ...range('out', c.outputs).slice(1)], bottom: ['clock', 'enable'], top: ['clear'] };
		case 'comparator': return { left: ['in1', 'in2'], right: ['gt', 'eq', 'lt'], bottom: [] as string[], top: [] as string[] };
		case 'bus':
			return c.variant === 'tap'
				? { left: ['bus'], right: ['tap'], bottom: [] as string[], top: [] as string[] }
				: c.variant === 'joiner'
					? { left: range('in', c.inputs), right: ['bus'], bottom: [] as string[], top: [] as string[] }
					: { left: ['bus'], right: range('out', c.outputs), bottom: [] as string[], top: [] as string[] };
		default:
			return {
				left: range('in', c.inputs),
				right: range('out', c.outputs),
				bottom: c.kind === 'counter' ? ['clock', 'enable'] : c.kind === 'mux' ? ['select', 'enable'] : c.kind === 'buffer' && c.variant?.startsWith('tristate') === true ? ['enable'] : [],
				top: c.kind === 'counter' ? ['clear'] : []
			};
	}
}

function digitalPorts(c: DigitalComponent): LocalPort[] {
	const { left, right, bottom, top } = digitalSides(c);
	const w = c.bodyWidth * 1000;
	const h = c.bodyHeight * 1000;
	const across = (names: readonly string[], x: number, nx: number, fitted?: readonly number[]) =>
		names.map((id, i) => ({ id, x, y: fitted === undefined ? distributed(i, names.length, h) : toMilli(fitted[i]!), nx, ny: 0 }));
	const along = (names: readonly string[], y: number, ny: number) =>
		names.map((id, i) => ({ id, x: distributed(i, names.length, w), y, nx: 0, ny }));
	return [...across(left, -(w / 2 + 16_000), -1, c.rows?.left), ...across(right, w / 2 + 16_000, 1, c.rows?.right), ...along(bottom, h / 2 + 16_000, 1), ...along(top, -(h / 2 + 16_000), -1)];
}

const digital: KindDef<DigitalComponent> = {
	parse(kind, common, options, line) {
		const k = kind as DigitalComponent['kind'];
		only(options, ['type', 'inputs', 'outputs', 'width', 'orientation', 'fit'], line);
		const fixed = k === 'buffer' || k === 'logic' || k === 'clock';
		if (options.has('fit') && fixed) {
			throw new SchematicSyntaxError(`Option fit is not supported for ${k}; it lines up the terminals of a block with several on one side.`, line);
		}
		const [di, do_] = DIGITAL_DEFAULTS[k];
		let inputs = count(options.get('inputs'), di === 0 ? 1 : di, 'inputs', line);
		let outputs = count(options.get('outputs'), do_, 'outputs', line);
		if ((k === 'logic' || k === 'clock') && options.has('inputs')) throw new SchematicSyntaxError(`${k} does not accept inputs.`, line);
		const bits = width(options.get('width'), k === 'bus' || k === 'register' ? 8 : 1, line);
		if (options.has('width') && k !== 'bus' && k !== 'register') throw new SchematicSyntaxError(`Option width is not supported for ${k}.`, line);
		if (k === 'bus' && bits < 2) throw new SchematicSyntaxError('Bus width must be at least 2.', line);
		const vars = DIGITAL_VARIANTS[k];
		const v = vars === undefined ? undefined : enumOption(options.get('type'), vars[0], vars[1], 'type', line);
		if (v === undefined && options.has('type')) throw new SchematicSyntaxError(`Option type is not supported for ${k}.`, line);
		if (k === 'adder' && v === 'full' && !options.has('inputs')) inputs = 3;
		if (k === 'mux' && v === 'demux') {
			if (!options.has('inputs')) inputs = 1;
			if (!options.has('outputs')) outputs = 2;
		}
		if (k === 'bus' && v === 'joiner' && !options.has('outputs')) outputs = 1;
		if ((k === 'buffer' && (inputs !== 1 || outputs !== 1)) || ((k === 'logic' || k === 'clock') && outputs !== 1)) {
			throw new SchematicSyntaxError(`${k} has fixed terminal counts.`, line);
		}
		const comp: DigitalComponent = {
			kind: k,
			...common,
			inputs: k === 'logic' || k === 'clock' ? 0 : inputs,
			outputs,
			width: bits,
			bodyWidth: fixed ? 56 : 84,
			bodyHeight: Math.max(52, Math.max(inputs, outputs) * 16 + 20),
			...orientation(options, line),
			...fit(options, line)
		};
		if (v !== undefined) comp.variant = v as NonNullable<DigitalComponent['variant']>;
		return comp;
	},
	extents: (c) => [c.bodyWidth * 500 + 16_000, c.bodyHeight * 500 + 16_000],
	ports: digitalPorts,
	resolve(c, name) {
		const pts = digitalPorts(c);
		const exact = pts.find((e) => e.id === name);
		if (exact !== undefined) return exact;
		const { left, right } = digitalSides(c);
		if (c.kind === 'bus' && name === 'tap') return pts.find((e) => e.id === right[0]);
		const t = indexed(name, left.length, right.length);
		if (t === undefined) return undefined;
		const id = (t.output ? right : left)[t.index];
		return pts.find((e) => e.id === id);
	},
	draw(c, p) {
		if (c.kind === 'buffer') {
			const bubble = c.variant === 'tristate-inverter' || c.variant === 'schmitt-inverter';
			return (
				P(p, `M -44 0 H -28 M -28 -22 L 24 0 -28 22 Z M ${bubble ? 32 : 24} 0 H 44${c.variant?.startsWith('schmitt') === true ? ' M -17 -8 H -6 V 8 H 5' : ''}`) +
				(bubble ? C(p, 28, 0, 4) : '') +
				(c.variant?.startsWith('tristate') === true ? P(p, 'M 0 42 V 12') : '')
			);
		}
		const w = c.bodyWidth * 1000;
		const h = c.bodyHeight * 1000;
		let stubs = '';
		for (const pt of digitalPorts(c)) {
			stubs += P(p, pt.ny === 0 ? `M ${n(pt.x)} ${n(pt.y)} H ${n(pt.nx * (w / 2))}` : `M ${n(pt.x)} ${n(pt.y)} V ${n(pt.ny * (h / 2))}`);
		}
		return R(p, n(-w / 2), n(-h / 2), c.bodyWidth, c.bodyHeight, 3) + stubs;
	},
	inner(c) {
		const val =
			c.kind === 'buffer'
				? ''
				: c.kind === 'logic'
					? LOGIC_TEXT[c.variant!]!
					: c.kind === 'mux'
						? c.variant === 'demux' ? 'DEMUX' : 'MUX'
						: c.kind === 'adder'
							? c.variant === 'full' ? 'FA' : 'HA'
							: c.kind === 'flipflop' || c.kind === 'bus'
								? String(c.variant).toUpperCase()
								: DIGITAL_LABELS[c.kind]!;
		return val === '' ? '' : `<text ${colorAttributes(c.color, 'schematic-gate-symbol')} stroke="none" x="0" y="4" text-anchor="middle" font-size="11">${val}</text>`;
	},
	symbol: (c) =>
		`digital-${c.kind}-${c.variant ?? ''}-${c.inputs}-${c.outputs}-${c.bodyWidth}-${c.bodyHeight}${c.rows === undefined ? '' : `-${c.rows.left.join('_')}-${c.rows.right.join('_')}`}`
};

export const LOGIC_KINDS: Readonly<Record<string, KindDef<never>>> = {
	nand: gate, nor: gate, xor: gate, xnor: gate, and: gate, or: gate, not: gate,
	buffer: digital, logic: digital, clock: digital, flipflop: digital, mux: digital, encoder: digital,
	decoder: digital, register: digital, counter: digital, adder: digital, comparator: digital, bus: digital
} as unknown as Readonly<Record<string, KindDef<never>>>;
