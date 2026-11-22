import { mathLabelTextWidthAt, renderMathLabelTspans } from '../math-label.js';
import { NAMED_QUANTUM_GATE_KINDS, SchematicSyntaxError, type QuantumGateComponent, type QuantumSpecialComponent } from '../types.js';
import { toMilli } from '../geom.js';
import { C, colorAttributes, count, enumOption, fit, fitText, includesValue, indexed, n, only, orientation, P, port, R, T, u, width, type KindDef, type LocalPort } from './common.js';

export const trackSpan = (tracks: number): number => Math.max(16_000, (tracks - 1) * 18_000);
export const trackCoordinate = (index: number, tracks: number): number => (tracks <= 1 ? 0 : -trackSpan(tracks) / 2 + (index * trackSpan(tracks)) / (tracks - 1));
const railAt = (rails: readonly number[] | undefined, index: number, tracks: number): number => (rails === undefined ? trackCoordinate(index, tracks) : toMilli(rails[index]!));

export function gateDimensions(c: QuantumGateComponent): { bodyWidth: number; bodyHeight: number; stubExtent: number } {
	const details = [c.parameter, c.phase, c.matrix].filter((v): v is string => v !== undefined && v !== '');
	let widest = details.length > 0 && c.kind === 'qgate' ? mathLabelTextWidthAt(c.label, 14) : 16;
	for (const d of details) widest = Math.max(widest, mathLabelTextWidthAt(d, 10));
	const bodyWidth = Math.max(50, Math.min(104, widest + 20));
	return { bodyWidth, bodyHeight: 50 + details.length * 15, stubExtent: bodyWidth / 2 + 23 };
}

const GATE_SYMBOLS: Readonly<Record<QuantumGateComponent['kind'], string>> = {
	qgate: '', cnot: '⊕', hadamard: 'H', xgate: 'X', ygate: 'Y', zgate: 'Z', sgate: 'S', sdg: 'S†',
	tgate: 'T', tdg: 'T†', sx: '√X', phase: 'P', rx: 'Rx', ry: 'Ry', rz: 'Rz', ugate: 'U'
};

function gatePorts(c: QuantumGateComponent): LocalPort[] {
	const stub = Math.round(gateDimensions(c).stubExtent * 1000);
	return [{ id: 'in', x: -stub, y: 0, nx: -1, ny: 0 }, { id: 'out', x: stub, y: 0, nx: 1, ny: 0 }];
}

const operator: KindDef<QuantumGateComponent> = {
	parse(kind, common, options, line) {
		const detailed = kind === 'qgate' || includesValue(NAMED_QUANTUM_GATE_KINDS, kind);
		only(options, detailed ? ['parameter', 'matrix', 'phase', 'orientation'] : kind === 'cnot' ? ['orientation', 'fit'] : ['orientation'], line);
		const comp: QuantumGateComponent = { kind: kind as QuantumGateComponent['kind'], ...common, ...orientation(options, line), ...fit(options, line) };
		if (detailed) {
			for (const k of ['parameter', 'matrix', 'phase'] as const) {
				const v = options.get(k);
				if (v !== undefined) comp[k] = v;
			}
		}
		return comp;
	},
	extents(c) {
		const { bodyHeight, stubExtent } = gateDimensions(c);
		return [Math.round(stubExtent * 1000), bodyHeight * 500];
	},
	ports: gatePorts,
	resolve: (c, name) => gatePorts(c).find((e) => e.id === name),
	draw(c, p) {
		const { bodyWidth, bodyHeight, stubExtent } = gateDimensions(c);
		const half = bodyWidth / 2;
		return R(p, u(-half), u(-bodyHeight / 2), u(bodyWidth), u(bodyHeight), 3) + P(p, `M ${u(-stubExtent)} 0 H ${u(-half)} M ${u(half)} 0 H ${u(stubExtent)}`);
	},
	inner(c) {
		const rows = [c.kind === 'qgate' ? c.label : GATE_SYMBOLS[c.kind], ...[c.parameter, c.phase, c.matrix].filter((v): v is string => v !== undefined && v !== '')];
		const { bodyWidth } = gateDimensions(c);
		const start = -((rows.length - 1) * 15) / 2 + 4;
		return `<g ${colorAttributes(c.color)}>${rows.map((v, i) => T(i === 0 ? 'schematic-gate-symbol' : 'schematic-quantum-detail', 0, start + i * 15, i === 0 ? 14 : 10, renderMathLabelTspans(v), ' text-anchor="middle"', fitText(v, bodyWidth - 12, i === 0 ? 14 : 10))).join('')}</g>`;
	},
	symbol(c) {
		const { bodyWidth, bodyHeight } = gateDimensions(c);
		return `quantum-shell-${bodyWidth}-${bodyHeight}`;
	}
};

const cnotRails = (c: QuantumGateComponent): readonly [number, number] => [railAt(c.rails, 0, 2), railAt(c.rails, 1, 2)];

function cnotPorts(c: QuantumGateComponent): LocalPort[] {
	const [ctrl, tgt] = cnotRails(c);
	return [
		{ id: 'in1', x: -42_000, y: ctrl, nx: -1, ny: 0 },
		{ id: 'in2', x: -42_000, y: tgt, nx: -1, ny: 0 },
		{ id: 'out1', x: 42_000, y: ctrl, nx: 1, ny: 0 },
		{ id: 'out2', x: 42_000, y: tgt, nx: 1, ny: 0 },
		{ id: 'control', x: 0, y: ctrl, nx: 0, ny: ctrl > tgt ? 1 : -1 },
		{ id: 'target', x: 0, y: tgt, nx: 0, ny: ctrl > tgt ? -1 : 1 }
	];
}

const cnot: KindDef<QuantumGateComponent> = {
	parse: operator.parse,
	extents: (c) => [42_000, Math.max(...cnotRails(c).map(Math.abs)) + 15_000],
	ports: cnotPorts,
	resolve: (c, name) => cnotPorts(c).find((e) => e.id === (name === 'in' ? 'in1' : name === 'out' ? 'out1' : name)),
	draw(c, p, np) {
		const [ctrl, tgt] = cnotRails(c);
		const [cs, ts] = [n(ctrl), n(tgt)];
		return P(p, `M -42 ${cs} H 42 M -42 ${ts} H 42 M 0 ${cs} V ${ts} M -7 ${ts} H 7 M 0 ${n(tgt - 7_000)} V ${n(tgt + 7_000)}`) + C(np, 0, cs, 4) + C(p, 0, ts, 10);
	},
	symbol: (c) => (c.rails === undefined ? 'cnot' : `cnot-${c.rails.join('_')}`)
};

const CONTROLLED = new Set(['controlled', 'cz', 'cphase', 'toffoli']);
const COUNTED = new Set(['controlled', 'cz', 'cphase', 'toffoli', 'swap']);
const MULTI = new Set(['swap', 'cz', 'cphase', 'toffoli', 'controlled', 'barrier', 'delay']);
const tracksOf = (c: QuantumSpecialComponent): number => Math.max(c.wires, c.controls + c.targets);

function specialPorts(c: QuantumSpecialComponent): LocalPort[] {
	switch (c.kind) {
		case 'prepare': return [port('out', 40, 0, 1, 0)];
		case 'measure': return [port('in', -40, 0, -1, 0), port('out', 40, 0, 1, 0), port('classical', 0, 34, 0, 1)];
		case 'control': return [port('in', -42, 0, -1, 0), port('out', 42, 0, 1, 0), port('control', 0, 0, 0, -1)];
		case 'reset':
		case 'classical-bit':
		case 'classical-register': return [port('in', -40, 0, -1, 0), port('out', 40, 0, 1, 0)];
		default: {
			const tracks = tracksOf(c);
			const pts: LocalPort[] = [];
			let lowest = 0;
			for (let i = 0; i < tracks; i += 1) {
				const y = railAt(c.rails, i, tracks);
				if (y > railAt(c.rails, lowest, tracks)) lowest = i;
				pts.push({ id: `in${i + 1}`, x: -42_000, y, nx: -1, ny: 0 });
			}
			for (let i = 0; i < tracks; i += 1) pts.push({ id: `out${i + 1}`, x: 42_000, y: railAt(c.rails, i, tracks), nx: 1, ny: 0 });
			const vert = (id: string, i: number): LocalPort => ({ id, x: 0, y: railAt(c.rails, i, tracks), nx: 0, ny: tracks > 1 && i === lowest ? 1 : -1 });
			for (let i = 0; i < c.controls; i += 1) pts.push(vert(`control${i + 1}`, i));
			for (let i = 0; i < c.targets; i += 1) pts.push(vert(`target${i + 1}`, c.controls + i));
			return pts;
		}
	}
}

const special: KindDef<QuantumSpecialComponent> = {
	parse(kind, common, options, line) {
		only(options, ['control', 'operator', 'controls', 'targets', 'wires', 'width', 'orientation', 'fit'], line);
		if (options.has('fit') && !MULTI.has(kind)) throw new SchematicSyntaxError(`Option fit is not supported for ${kind}; it lines up the rails of a gate that spans several qubits.`, line);
		if (options.has('control') && kind !== 'control' && kind !== 'controlled') throw new SchematicSyntaxError(`Option control is not supported for ${kind}.`, line);
		if (options.has('operator') && kind !== 'controlled') throw new SchematicSyntaxError(`Option operator is not supported for ${kind}.`, line);
		if ((options.has('controls') || options.has('targets')) && !COUNTED.has(kind)) throw new SchematicSyntaxError(`Control/target counts are not supported for ${kind}.`, line);
		if (options.has('wires') && kind !== 'barrier' && kind !== 'delay') throw new SchematicSyntaxError(`Option wires is not supported for ${kind}.`, line);
		if (options.has('width') && kind !== 'classical-register') throw new SchematicSyntaxError(`Option width is not supported for ${kind}.`, line);
		const controlType = enumOption(options.get('control'), 'positive', ['positive', 'negative', 'classical'] as const, 'control', line);
		const ctrl = CONTROLLED.has(kind);
		const comp: QuantumSpecialComponent = {
			kind: kind as QuantumSpecialComponent['kind'],
			...common,
			controls: count(options.get('controls'), kind === 'toffoli' ? 2 : ctrl ? 1 : 0, 'controls', line),
			targets: count(options.get('targets'), kind === 'swap' ? 2 : ctrl ? 1 : 0, 'targets', line),
			wires: count(options.get('wires'), kind === 'barrier' || kind === 'delay' ? 2 : 1, 'wires', line),
			width: width(options.get('width'), kind === 'classical-register' ? 8 : 1, line),
			...orientation(options, line),
			...fit(options, line)
		};
		if (kind === 'classical-register' && comp.width < 2) throw new SchematicSyntaxError('Classical register width must be at least 2.', line);
		if (kind === 'control' || kind === 'controlled') comp.controlType = controlType;
		const op = options.get('operator');
		if (op !== undefined) comp.operator = op;
		return comp;
	},
	extents(c) {
		if (c.kind === 'measure') return [42_000, 34_000];
		const tracks = tracksOf(c);
		let reach = 0;
		for (let i = 0; i < tracks; i += 1) reach = Math.max(reach, Math.abs(railAt(c.rails, i, tracks)));
		return [42_000, Math.max(24_000, reach + 14_000)];
	},
	ports: specialPorts,
	resolve(c, name) {
		const pts = specialPorts(c);
		if (!MULTI.has(c.kind)) {
			if (c.kind === 'reset' && /^(in|out)1$/.test(name)) name = name.slice(0, -1);
			return pts.find((e) => e.id === name);
		}
		const tracks = tracksOf(c);
		const t = indexed(name, tracks, tracks);
		return t !== undefined ? pts[(t.output ? tracks : 0) + t.index] : pts.find((e) => e.id === name);
	},
	draw(c, p, np) {
		switch (c.kind) {
			case 'measure': return P(p, 'M -40 0 H -22 M 22 0 H 40 M 0 22 V 34') + R(p, -22, -22, 44, 44, 3) + P(p, 'M -12 8 A 15 15 0 0 1 12 8 M 0 8 L 11 -9');
			case 'prepare': return P(p, 'M 0 0 H 40 M -10 -10 L 10 0 -10 10 Z');
			case 'reset': return P(p, 'M -40 0 H -18 M 18 0 H 40') + R(p, -18, -18, 36, 36, 3) + P(p, 'M 9 -8 A 12 12 0 1 0 10 7 M 9 -8 H 1 M 9 -8 V 0');
			case 'control': return P(p, 'M -42 0 H 42') + C(c.controlType === 'negative' ? p : np, 0, 0, 5);
			case 'classical-bit':
			case 'classical-register': return P(p, 'M -40 -2 H 40 M -40 2 H 40');
		}
		const tracks = tracksOf(c);
		const rails = Array.from({ length: tracks }, (_, i) => railAt(c.rails, i, tracks));
		const top = c.rails === undefined ? -trackSpan(tracks) / 2 : Math.min(...rails);
		const bot = c.rails === undefined ? trackSpan(tracks) / 2 : Math.max(...rails);
		let lines = '';
		for (const r of rails) lines += P(p, `M -42 ${n(r)} H 42`);
		if (c.kind === 'barrier') return lines + `<path ${p} stroke-dasharray="4 3" d="M 0 ${n(top - 8_000)} V ${n(bot + 8_000)}" />`;
		if (c.kind === 'delay') return lines + R(p, -12, n(top - 7_000), 24, n(bot - top + 14_000), 2);
		let marks = '';
		for (let i = 0; i < tracks; i += 1) {
			const y = rails[i]!;
			const ys = n(y);
			if (c.kind === 'swap') marks += P(p, `M -6 ${n(y - 6_000)} L 6 ${n(y + 6_000)} M 6 ${n(y - 6_000)} L -6 ${n(y + 6_000)}`);
			else if (c.kind === 'cz') marks += C(np, 0, ys, 4);
			else if (i < c.controls) marks += c.controlType === 'negative' ? C(p, 0, ys, 5) : c.controlType === 'classical' ? R(np, -5, n(y - 5_000), 10, 10) : C(np, 0, ys, 4);
			else if (c.kind === 'controlled' || c.kind === 'cphase') marks += R(p, -10, n(y - 10_000), 20, 20, 2);
			else marks += C(p, 0, ys, 10) + P(p, `M -7 ${ys} H 7 M 0 ${n(y - 7_000)} V ${n(y + 7_000)}`);
		}
		return lines + P(p, `M 0 ${n(top)} V ${n(bot)}`) + marks;
	},
	inner: (c) =>
		c.kind === 'controlled' && c.operator !== undefined
			? `<text ${colorAttributes(c.color, 'schematic-gate-symbol')} stroke="none" x="0" y="4" text-anchor="middle" font-size="11">${renderMathLabelTspans(c.operator)}</text>`
			: '',
	symbol: (c) => `quantum-${c.kind}-${c.controlType ?? ''}-${c.controls}-${c.targets}-${c.wires}${c.rails === undefined ? '' : `-${c.rails.join('_')}`}`
};

export const QUANTUM_KINDS: Readonly<Record<string, KindDef<never>>> = {
	hadamard: operator, qgate: operator, xgate: operator, ygate: operator, zgate: operator, sgate: operator,
	sdg: operator, tgate: operator, tdg: operator, sx: operator, phase: operator, rx: operator, ry: operator,
	rz: operator, ugate: operator, cnot,
	measure: special, reset: special, prepare: special, swap: special, control: special, cz: special,
	cphase: special, toffoli: special, controlled: special, barrier: special, delay: special,
	'classical-bit': special, 'classical-register': special
} as unknown as Readonly<Record<string, KindDef<never>>>;
