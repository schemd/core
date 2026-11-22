import { toMilli } from '../geom.js';
import { escapeXml } from '../xml.js';
import { renderMathLabelTspans } from '../math-label.js';
import {
	AMPLIFIER_TYPES,
	DIODE_TYPES,
	GROUND_STYLES,
	LOAD_TYPES,
	METER_TYPES,
	POWER_TYPES,
	PROTECTION_TYPES,
	RESONATOR_TYPES,
	SOURCE_TYPES,
	SWITCH_TYPES,
	SchematicSyntaxError,
	TRANSISTOR_TYPES,
	type DiodeComponent,
	type ElectricalComponent,
	type GroundComponent,
	type IcComponent,
	type IntegratedCircuitPins,
	type PassiveComponent,
	type PortComponent,
	type TransistorComponent
} from '../types.js';
import {
	byName,
	C,
	colorAttributes,
	distributed,
	enumOption,
	fit,
	fitText,
	n,
	named,
	only,
	orientation,
	P,
	port,
	R,
	T,
	width,
	type KindDef,
	type LocalPort
} from './common.js';

const IN = port('in', -42, 0, -1, 0);
const OUT = port('out', 42, 0, 1, 0);
const twoTerminal = (ports: readonly [LocalPort, LocalPort], aliases: Readonly<Record<string, 0 | 1>>) => ({
	ports: () => ports,
	resolve: (_: unknown, name: string) => {
		const i = aliases[name];
		return i === undefined ? undefined : ports[i];
	}
});

const PASSIVE_ALLOWED: Readonly<Record<PassiveComponent['kind'], readonly string[]>> = {
	resistor: ['fixed', 'variable', 'rheostat', 'potentiometer', 'thermistor', 'ldr'],
	capacitor: ['fixed', 'variable', 'polarized'],
	inductor: ['fixed', 'coupled', 'transformer']
};
const PASSIVE_RES_EXTRA: Readonly<Record<string, string>> = {
	variable: 'M -18 20 L 18 -20 M 11 -20 H 18 V -13',
	rheostat: 'M -18 20 L 18 -20 M 11 -20 H 18 V -13',
	potentiometer: 'M -18 20 L 18 -20 M 11 -20 H 18 V -13 M 0 28 V 12',
	thermistor: 'M -18 19 L 18 -19 M 10 -19 H 18 V -11',
	ldr: 'M 15 -27 L 4 -16 M 4 -16 H 9 V -21 M 27 -20 L 16 -9 M 16 -9 H 21 V -14'
};

const passive: KindDef<PassiveComponent> = {
	parse(kind, common, options, line) {
		only(options, ['type', 'orientation'], line);
		const k = kind as PassiveComponent['kind'];
		const passiveType = enumOption(options.get('type'), 'fixed', PASSIVE_ALLOWED[k], 'type', line) as PassiveComponent['passiveType'];
		const ori = orientation(options, line);
		return passiveType === 'fixed' ? { kind: k, ...common, ...ori } : { kind: k, ...common, passiveType: passiveType!, ...ori };
	},
	extents: () => [42_000, 18_000],
	...twoTerminal([IN, OUT], { in: 0, left: 0, l: 0, out: 1, right: 1, r: 1 }),
	draw(c, p) {
		const v = c.passiveType ?? 'fixed';
		if (c.kind === 'resistor') {
			const base = P(p, 'M -42 0 H -26 L -20 -12 L -10 12 L 0 -12 L 10 12 L 20 -12 L 26 0 H 42');
			const ex = PASSIVE_RES_EXTRA[v];
			return ex === undefined ? base : base + P(p, ex);
		}
		if (c.kind === 'capacitor') {
			return (
				P(p, `M -42 0 H -7 M -7 -18 V 18 ${v === 'polarized' ? 'M 7 -18 Q 13 0 7 18' : 'M 7 -18 V 18'} M 7 0 H 42`) +
				(v === 'variable' ? P(p, 'M -18 20 L 18 -20 M 11 -20 H 18 V -13') : v === 'polarized' ? P(p, 'M -17 -12 H -9 M -13 -16 V -8') : '')
			);
		}
		const base = P(p, 'M -42 0 H -28 C -28 -16 -14 -16 -14 0 C -14 -16 0 -16 0 0 C 0 -16 14 -16 14 0 C 14 -16 28 -16 28 0 H 42');
		return v === 'fixed'
			? base
			: base + P(p, `M -28 12 C -28 28 -14 28 -14 12 C -14 28 0 28 0 12 C 0 28 14 28 14 12 C 14 28 28 28 28 12${v === 'transformer' ? ' M -33 5 H 33 M -33 8 H 33' : ''}`);
	},
	symbol: (c) => (c.passiveType === undefined ? c.kind : `${c.kind}-${c.passiveType}`)
};

const DIODE_EXTRA: Readonly<Record<string, string>> = {
	schottky: 'M 10 -16 H 16 V -10 M 10 16 H 4 V 10',
	zener: 'M 4 -20 L 10 -16 M 10 16 L 16 20',
	led: 'M -1 -18 L 11 -30 M 6 -30 H 11 V -25 M 8 -14 L 20 -26 M 15 -26 H 20 V -21',
	photodiode: 'M 18 -30 L 6 -18 M 6 -18 H 11 V -23 M 27 -22 L 15 -10 M 15 -10 H 20 V -15',
	varactor: 'M 16 -16 V 16',
	scr: 'M 10 10 L 24 22 H 34'
};

const diode: KindDef<DiodeComponent> = {
	parse(_, common, options, line) {
		only(options, ['type', 'orientation'], line);
		return { kind: 'diode', ...common, diodeType: enumOption(options.get('type'), 'standard', DIODE_TYPES, 'type', line), ...orientation(options, line) };
	},
	extents: (c) => [42_000, c.diodeType === 'led' || c.diodeType === 'photodiode' ? 30_000 : 20_000],
	...twoTerminal([port('anode', -42, 0, -1, 0), port('cathode', 42, 0, 1, 0)], { anode: 0, a: 0, cathode: 1, k: 1, c: 1 }),
	draw(c, p) {
		if (c.diodeType === 'triac') return P(p, 'M -42 0 H -15 L 9 -15 V 15 L -15 0 M 42 0 H 15 L -9 15 V -15 L 15 0 M 5 12 L 23 25 H 34');
		const base = P(p, 'M -42 0 H -14 M -14 -16 L 10 0 L -14 16 Z M 10 -16 V 16 M 10 0 H 42');
		const ex = DIODE_EXTRA[c.diodeType];
		return ex === undefined ? base : base + P(p, ex);
	},
	symbol: (c) => `diode-${c.diodeType}`
};

const CONTROL = port('base', -42, 0, -1, 0);
const UPPER = port('collector', 42, -22, 1, 0);
const LOWER = port('emitter', 42, 22, 1, 0);
const BJT_PORTS = [CONTROL, UPPER, LOWER] as const;
const FET_PORTS = [named(CONTROL, 'gate'), named(UPPER, 'drain'), named(LOWER, 'source')] as const;
const TRANSISTOR_NAMES: Readonly<Record<string, 0 | 1 | 2>> = {
	base: 0, gate: 0, b: 0, g: 0, collector: 1, drain: 1, c: 1, d: 1, emitter: 2, source: 2, e: 2, s: 2
};

const transistor: KindDef<TransistorComponent> = {
	parse(_, common, options, line) {
		only(options, ['type', 'orientation'], line);
		return { kind: 'transistor', ...common, transistorType: enumOption(options.get('type'), 'npn', TRANSISTOR_TYPES, 'type', line), ...orientation(options, line) };
	},
	extents: () => [42_000, 38_000],
	ports: (c) => (c.transistorType === 'npn' || c.transistorType === 'pnp' ? BJT_PORTS : FET_PORTS),
	resolve(c, name) {
		const i = TRANSISTOR_NAMES[name];
		return i === undefined ? undefined : transistor.ports(c)[i];
	},
	draw(c, p) {
		const t = c.transistorType;
		const ring = C(p, 0, 0, 30);
		if (t === 'npn' || t === 'pnp') {
			return ring + P(p, `M -42 0 H -9 M -9 -18 V 18 M -9 -10 L 20 -22 H 42 M -9 10 L 20 22 H 42 ${t === 'npn' ? 'M 12 17 L 24 25 L 20 12' : 'M 0 7 L 12 17 L 0 20'}`);
		}
		const pCh = t[0] === 'p';
		if (t.endsWith('jfet')) {
			return ring + P(p, `M -42 0 H 4 M 4 -18 V 18 M 4 -12 L 20 -22 H 42 M 4 12 L 20 22 H 42 ${pCh ? 'M -5 -5 L 5 0 L -5 5' : 'M 5 -5 L -5 0 L 5 5'}`);
		}
		const ctrl = pCh ? P(p, 'M -42 0 H -16') + C(p, -11, 0, 5) : P(p, 'M -42 0 H -10');
		return ring + ctrl + P(p, `M -10 -19 V 19 M 4 -17 V 17 M 4 -11 L 20 -22 H 42 M 4 11 L 20 22 H 42 ${pCh ? 'M 16 -3 L 5 3 L 16 9' : 'M 5 -3 L 16 3 L 5 9'}${t.endsWith('igbt') ? ' M 9 -11 V 11' : ''}`);
	},
	symbol: (c) => `transistor-${c.transistorType}`
};

const boundary: KindDef<PortComponent> = {
	parse(_, common, options, line) {
		only(options, ['width', 'orientation'], line);
		const bits = width(options.get('width'), 1, line);
		const ori = orientation(options, line);
		return bits === 1 ? { kind: 'port', ...common, ...ori } : { kind: 'port', ...common, width: bits, ...ori };
	},
	extents: () => [42_000, 18_000],
	...twoTerminal([IN, OUT], { in: 0, out: 1 }),
	draw: (_, p) => P(p, 'M -42 0 H -24 M 24 0 H 42 M -24 -16 H 14 L 24 0 L 14 16 H -24 Z')
};

const GROUND_IN = port('in', 0, -42, 0, -1);
const GROUND_PATHS: Readonly<Record<GroundComponent['groundStyle'], string>> = {
	signal: 'M -15 -10 H 15 L 0 15 Z',
	earth: 'M -20 -10 H 20 M -13 -3 H 13 M -6 4 H 6',
	chassis: 'M -20 -10 H 20 M -14 -10 L -20 2 M 0 -10 L -6 2 M 14 -10 L 8 2'
};

const ground: KindDef<GroundComponent> = {
	parse(_, common, options, line) {
		only(options, ['style', 'orientation'], line);
		return { kind: 'ground', ...common, groundStyle: enumOption(options.get('style'), 'signal', GROUND_STYLES, 'style', line), ...orientation(options, line) };
	},
	extents: () => [22_000, 42_000],
	ports: () => [GROUND_IN],
	resolve: (_, name) => (name === 'in' ? GROUND_IN : undefined),
	draw: (c, p) => P(p, 'M 0 -42 V -10') + P(p, GROUND_PATHS[c.groundStyle]),
	symbol: (c) => `ground-${c.groundStyle}`
};

const NODE = port('node', 0, 0, -1, 0);
const DEPENDENT = new Set(['vcvs', 'vccs', 'ccvs', 'cccs']);
const ELEC_DEFAULTS: Readonly<Record<string, readonly [string, readonly string[]]>> = {
	source: ['voltage-dc', SOURCE_TYPES],
	power: ['vcc', POWER_TYPES],
	switch: ['spst', SWITCH_TYPES],
	protection: ['fuse', PROTECTION_TYPES],
	amplifier: ['opamp', AMPLIFIER_TYPES],
	resonator: ['crystal', RESONATOR_TYPES],
	meter: ['voltmeter', METER_TYPES],
	load: ['lamp', LOAD_TYPES]
};
const ELEC_EXTENTS: Readonly<Record<string, readonly [number, number]>> = {
	junction: [5_000, 5_000],
	testpoint: [12_000, 12_000],
	connector: [32_000, 18_000],
	power: [32_000, 18_000],
	source: [42_000, 34_000],
	amplifier: [48_000, 36_000]
};
const VOLTAGE_SIGNS = new Set(['voltage-dc', 'vcvs', 'ccvs']);
const PLUS_AT: Readonly<Record<string, readonly [number, number]>> = { right: [11, 0], down: [0, 11], left: [-11, 0], up: [0, -11] };
const LOAD_PATHS: Readonly<Record<string, string>> = {
	lamp: 'M -15 -15 L 15 15 M 15 -15 L -15 15',
	speaker: 'M -12 -9 H -3 L 8 -19 V 19 L -3 9 H -12 Z M 13 -10 Q 22 0 13 10',
	buzzer: 'M -12 -9 H -3 L 8 -18 V 18 L -3 9 H -12 Z M 13 -8 L 20 -14 M 15 0 H 24 M 13 8 L 20 14'
};

function electricalPorts(c: ElectricalComponent): LocalPort[] {
	const v = c.variant ?? '';
	switch (c.kind) {
		case 'junction':
		case 'testpoint': return [NODE];
		case 'connector': return [port('in', -32, 0, -1, 0), port('out', 32, 0, 1, 0)];
		case 'source': {
			const pts = [named(IN, 'negative'), named(OUT, 'positive')];
			if (DEPENDENT.has(v)) pts.push(port('control-positive', 0, -34, 0, -1), port('control-negative', 0, 34, 0, 1));
			return pts;
		}
		case 'power': return [port('in', -32, 0, -1, 0)];
		case 'switch':
			if (v === 'spdt') return [named(IN, 'common'), port('normally-open', 42, -12, 1, 0), port('normally-closed', 42, 12, 1, 0)];
			if (v === 'relay') return [IN, OUT, port('coil1', -12, 34, 0, 1), port('coil2', 12, 34, 0, 1)];
			return [IN, OUT];
		case 'amplifier': return [port('positive', -48, -13, -1, 0), port('negative', -48, 13, -1, 0), port('out', 48, 0, 1, 0), port('v+', 0, -36, 0, -1), port('v-', 0, 36, 0, 1)];
		default: return [IN, OUT];
	}
}

const electrical: KindDef<ElectricalComponent> = {
	parse(kind, common, options, line) {
		const k = kind as ElectricalComponent['kind'];
		if (k === 'junction' || k === 'testpoint') {
			only(options, [], line);
			return { kind: k, ...common } as ElectricalComponent;
		}
		if (k === 'connector') {
			only(options, ['orientation'], line);
			return { kind: k, ...common, ...orientation(options, line) } as ElectricalComponent;
		}
		only(options, ['type', 'orientation'], line);
		const [fb, vals] = ELEC_DEFAULTS[k]!;
		return { kind: k, ...common, variant: enumOption(options.get('type'), fb, vals, 'type', line) as ElectricalComponent['variant'], ...orientation(options, line) } as ElectricalComponent;
	},
	extents: (c) => (c.kind === 'switch' ? [42_000, c.variant === 'relay' ? 34_000 : 20_000] : ELEC_EXTENTS[c.kind] ?? [42_000, 24_000]),
	ports: electricalPorts,
	resolve(c, name) {
		const pts = electricalPorts(c);
		const exact = byName(pts, name);
		if (exact !== undefined) return exact;
		if (c.kind === 'junction' || c.kind === 'testpoint') return name === 'in' ? NODE : name === 'out' ? { ...NODE, nx: 1 } : undefined;
		if (c.kind === 'source') return name === 'in' ? pts[0] : name === 'out' ? pts[1] : undefined;
		if (c.kind === 'switch' && c.variant === 'spdt') return name === 'in' ? pts[0] : name === 'out' ? OUT : undefined;
		if (c.kind === 'amplifier') return name === 'in' ? pts[0] : undefined;
		return undefined;
	},
	draw(c, p, np) {
		const v = c.variant ?? '';
		switch (c.kind) {
			case 'junction': return C(np, 0, 0, 4);
			case 'testpoint': return C(p, 0, 0, 9) + C(np, 0, 0, 2);
			case 'connector': return P(p, 'M -32 0 H -9 M 9 0 H 32') + C(p, 0, 0, 9);
			case 'source': {
				if (v === 'battery') return P(p, 'M -42 0 H -8 M -8 -10 V 10 M 8 -16 V 16 M 8 0 H 42');
				const dep = DEPENDENT.has(v);
				const glyph = v.endsWith('ac')
					? P(p, 'M -13 0 C -8 -12 -4 -12 0 0 C 4 12 8 12 13 0')
					: v === 'voltage-pulse'
						? P(p, 'M -14 8 H -7 V -8 H 7 V 8 H 14')
						: v.startsWith('current') || v.endsWith('cs')
							? P(p, 'M 12 0 H -12 M -5 -6 L -12 0 -5 6')
							: '';
				return P(p, 'M -42 0 H -24 M 24 0 H 42') + (dep ? P(p, 'M -24 0 L 0 -24 24 0 0 24 Z') + P(p, 'M 0 -34 V -24 M 0 24 V 34') : C(p, 0, 0, 24)) + glyph;
			}
			case 'power': return P(p, 'M -32 0 H 0 M 0 -13 V 13 M 0 -13 L 15 0 0 13');
			case 'switch':
				return P(p, 'M -42 0 H -24 M -24 0 L 22 -12 M 26 -12 H 42') + (v === 'spdt' ? P(p, 'M 26 12 H 42') : v === 'relay' ? P(p, 'M -12 34 C -12 18 12 18 12 34 M 0 19 V 8') : '');
			case 'protection':
				return v === 'breaker' ? P(p, 'M -42 0 H -18 M -18 0 L 18 -12 M 18 0 H 42') : P(p, 'M -42 0 H -24 M 24 0 H 42') + R(p, -24, -9, 48, 18, 4);
			case 'amplifier': return P(p, 'M -48 -13 H -30 M -48 13 H -30 M -30 -30 L 30 0 -30 30 Z M 30 0 H 48 M 0 -36 V -15 M 0 15 V 36 M -25 -17 H -17 M -21 -21 V -13 M -25 13 H -17');
			case 'resonator': return P(p, 'M -42 0 H -12 M -12 -18 V 18 M 12 -18 V 18 M 12 0 H 42') + R(p, -7, -14, 14, 28);
			default: {
				const extra = LOAD_PATHS[v];
				return P(p, 'M -42 0 H -24 M 24 0 H 42') + C(p, 0, 0, 24) + (extra === undefined ? '' : P(p, extra));
			}
		}
	},
	inner(c) {
		if (c.kind === 'source') {
			if (!VOLTAGE_SIGNS.has(c.variant!)) return '';
			const [x, y] = PLUS_AT[('orientation' in c && c.orientation) || 'right']!;
			return P(colorAttributes(c.color), `M ${x - 7} ${y} H ${x + 7} M ${x} ${y - 7} V ${y + 7} M ${-x - 7} ${-y} H ${-x + 7}`);
		}
		const ch = c.variant === 'voltmeter' ? 'V' : c.variant === 'ammeter' ? 'A' : c.variant === 'motor' ? 'M' : '';
		return ch === '' ? '' : `<text ${colorAttributes(c.color, 'schematic-gate-symbol')} stroke="none" x="0" y="5" text-anchor="middle" font-size="14">${ch}</text>`;
	},
	symbol: (c) => `${c.kind}-${c.variant ?? ''}`
};

const SIDES = ['left', 'right', 'top', 'bottom'] as const;
type Side = (typeof SIDES)[number];
const NORMALS: Readonly<Record<Side, readonly [number, number]>> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

export function icPin(c: IcComponent, side: Side, index: number): LocalPort {
	const pins = c.pins[side];
	const w = c.bodyWidth * 1000;
	const h = c.bodyHeight * 1000;
	const [nx, ny] = NORMALS[side];
	const lr = side === 'left' || side === 'right';
	const fitted = lr ? c.rows?.[side][index] : undefined;
	return lr
		? { id: pins[index]!, x: nx * (w / 2 + 16_000), y: fitted === undefined ? distributed(index, pins.length, h) : toMilli(fitted), nx, ny }
		: { id: pins[index]!, x: distributed(index, pins.length, w), y: ny * (h / 2 + 16_000), nx, ny };
}

const icPorts = (c: IcComponent): LocalPort[] => SIDES.flatMap((side) => c.pins[side].map((_, i) => icPin(c, side, i)));

const ic: KindDef<IcComponent> = {
	parse(_, common, options, line) {
		only(options, ['left', 'right', 'top', 'bottom', 'orientation', 'fit'], line);
		const reg = new Set<string>();
		const side = (name: Side): readonly string[] => {
			const src = options.get(name);
			if (src === undefined || src.trim() === '') return [];
			const list = src.split(',').map((p) => p.trim());
			if (list.length > 64) throw new SchematicSyntaxError(`${name} supports at most 64 IC pins.`, line);
			for (const pin of list) {
				if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(pin)) throw new SchematicSyntaxError(`Invalid IC pin name ${pin || '(empty)'}.`, line);
				if (pin === 'in' || pin === 'out') throw new SchematicSyntaxError(`IC pin ${pin} collides with the reserved ${pin} alias. Use ${pin}1 or another pin name.`, line);
				if (reg.has(pin)) throw new SchematicSyntaxError(`Duplicate IC pin ${pin}.`, line);
				reg.add(pin);
			}
			return list;
		};
		const pins: IntegratedCircuitPins = { left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom') };
		if (reg.size === 0) throw new SchematicSyntaxError('An IC must declare at least one pin.', line);
		return {
			kind: 'ic',
			...common,
			pins,
			bodyWidth: Math.max(88, Math.max(pins.top.length, pins.bottom.length) * 22 + 24),
			bodyHeight: Math.max(64, Math.max(pins.left.length, pins.right.length) * 18 + 24),
			...orientation(options, line),
			...fit(options, line)
		};
	},
	extents: (c) => [c.bodyWidth * 500 + 16_000, c.bodyHeight * 500 + 16_000],
	ports: icPorts,
	resolve(c, name) {
		const pts = icPorts(c);
		if (name === 'in' || name === 'out') {
			const canon = byName(pts, `${name}1`);
			if (canon !== undefined) return named(canon, name);
			for (const side of name === 'in' ? (['left', 'top'] as const) : (['right', 'bottom'] as const)) {
				if (c.pins[side].length > 0) return named(icPin(c, side, 0), name);
			}
			return undefined;
		}
		return byName(pts, name);
	},
	draw(c, p) {
		const w = c.bodyWidth * 1000;
		const h = c.bodyHeight * 1000;
		let pins = '';
		for (const side of SIDES) {
			const list = c.pins[side];
			const sign = side === 'left' || side === 'top' ? -1 : 1;
			if (side === 'left' || side === 'right') {
				const stub = n(sign * (w / 2 + 16_000));
				const body = n((sign * w) / 2);
				const [hd, tl] = side === 'left' ? [stub, body] : [body, stub];
				const lx = n(sign * (w / 2 - 5_000));
				const fitted = Math.max(8, c.bodyWidth / 2 - 10);
				for (let i = 0; i < list.length; i += 1) {
					const pin = list[i]!;
					const { y } = icPin(c, side, i);
					pins += P(p, `M ${hd} ${n(y)} H ${tl}`) + T('schematic-pin-label', lx, n(y + 3_000), 10, escapeXml(pin), ` text-anchor="${side === 'left' ? 'start' : 'end'}"`, fitText(pin, fitted, 10));
				}
			} else {
				const stub = n(sign * (h / 2 + 16_000));
				const body = n((sign * h) / 2);
				const [hd, tl] = side === 'top' ? [stub, body] : [body, stub];
				const ly = n(sign * (h / 2 - 5_000));
				const fitted = Math.max(8, c.bodyHeight / 2 - 10);
				for (let i = 0; i < list.length; i += 1) {
					const pin = list[i]!;
					const x = n(distributed(i, list.length, w));
					pins += P(p, `M ${x} ${hd} V ${tl}`) + T('schematic-pin-label', x, ly, 10, escapeXml(pin), ' text-anchor="start"', `${fitText(pin, fitted, 10)} transform="rotate(${side === 'top' ? 90 : -90} ${x} ${ly})"`);
				}
			}
		}
		return R(p, n(-w / 2), n(-h / 2), n(w), n(h), 3) + pins;
	},
	inner: (c) => T('schematic-gate-symbol', 0, 4, 12, renderMathLabelTspans(c.label), ' text-anchor="middle"', fitText(c.label, c.bodyWidth - 12, 12))
};

export const ELECTRICAL_KINDS: Readonly<Record<string, KindDef<never>>> = {
	resistor: passive, capacitor: passive, inductor: passive, diode, transistor, port: boundary, ground,
	source: electrical, junction: electrical, testpoint: electrical, connector: electrical, power: electrical,
	switch: electrical, protection: electrical, amplifier: electrical, resonator: electrical, meter: electrical,
	load: electrical, ic
} as unknown as Readonly<Record<string, KindDef<never>>>;
