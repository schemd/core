import { toMilli } from '../geom.js';
import { mathLabelTextWidthAt, renderMathLabelTspans } from '../math-label.js';
import {
	SchematicSyntaxError,
	UML_COMPONENT_KINDS,
	type UmlActorComponent,
	type UmlClassComponent,
	type UmlComponent,
	type UmlPseudostateComponent,
	type UmlSizedComponent,
	type UmlStateComponent
} from '../types.js';
import { C, enumOption, only, P, R, T, u, type CommonFields, type KindDef, type LocalPort } from './common.js';

const ROW = 16;

function rows(value: string | undefined, name: string, line: number): readonly string[] {
	if (value === undefined || value.trim() === '') return [];
	const list = value.split(';').map((r) => r.trim());
	if (list.length > 64) throw new SchematicSyntaxError(`${name} supports at most 64 rows.`, line);
	for (const r of list) {
		if (r === '' || r.length > 256) throw new SchematicSyntaxError(`${name} rows must contain 1 through 256 characters.`, line);
	}
	return list;
}

function dimension(value: string | undefined, fallback: number, name: string, line: number): number {
	if (value === undefined) return fallback;
	const v = Number(value);
	if (!/^\d+(?:\.\d+)?$/.test(value) || v < 24 || v > 2048) throw new SchematicSyntaxError(`${name} must be a finite number from 24 through 2048.`, line);
	return v;
}

function widest(title: string, list: readonly string[], stereotype?: string): number {
	let v = mathLabelTextWidthAt(title, 13, true);
	if (stereotype !== undefined) v = Math.max(v, mathLabelTextWidthAt(`«${stereotype}»`, 11));
	for (const r of list) v = Math.max(v, mathLabelTextWidthAt(r, 12));
	return v;
}

const CLASS_KINDS = new Set(['class', 'interface', 'enumeration', 'datatype', 'object']);
const SIZED_KINDS = new Set(
	'usecase lifeline note package component artifact node device execution system action object-node partition activation fragment interaction region'.split(' ')
);
const SMALL: Readonly<Record<string, readonly [number, number]>> = {
	actor: [24, 50], decision: [18, 18], merge: [18, 18], choice: [18, 18], fork: [38, 5], join: [38, 5],
	'send-signal': [22, 15], 'receive-signal': [22, 15]
};

function half(c: UmlComponent): readonly [number, number] {
	if ('bodyWidth' in c) return [toMilli(c.bodyWidth / 2), toMilli(c.bodyHeight / 2)];
	const s = SMALL[c.kind];
	return s === undefined ? [12_000, 12_000] : [s[0] * 1000, s[1] * 1000];
}

function sides(c: UmlComponent): LocalPort[] {
	const [w, h] = half(c);
	return [
		{ id: 'left', x: -w, y: 0, nx: -1, ny: 0 },
		{ id: 'right', x: w, y: 0, nx: 1, ny: 0 },
		{ id: 'top', x: 0, y: -h, nx: 0, ny: -1 },
		{ id: 'bottom', x: 0, y: h, nx: 0, ny: 1 }
	];
}

const rowText = (v: string, x: number, y: number) => T('schematic-uml-text schematic-uml-row', u(x), u(y), 12, renderMathLabelTspans(v));
const labelText = (c: UmlComponent, y = '4', sz = 12) => T('schematic-uml-text', 0, y, sz, renderMathLabelTspans(c.label), ' text-anchor="middle"');

function classShape(c: UmlClassComponent, p: string): string {
	const l = -c.bodyWidth / 2;
	const t = -c.bodyHeight / 2;
	const attrY = t + 36 + (c.stereotype === undefined ? 0 : 14);
	const opY = attrY + Math.max(24, c.attributes.length * ROW + 8);
	const stereo = c.stereotype === undefined ? '' : T('schematic-uml-text schematic-uml-stereotype', 0, u(t + 13), 11, `«${renderMathLabelTspans(c.stereotype)}»`, ' text-anchor="middle"');
	return (
		R(p, u(l), u(t), u(c.bodyWidth), u(c.bodyHeight), 2) +
		P(p, `M ${u(l)} ${u(attrY)} H ${u(-l)} M ${u(l)} ${u(opY)} H ${u(-l)}`) +
		stereo +
		T('schematic-uml-text', 0, u(t + (c.stereotype === undefined ? 23 : 32)), 13, renderMathLabelTspans(c.label), ' text-anchor="middle"', ' font-weight="600"') +
		c.attributes.map((v, i) => rowText(v, l + 8, attrY + 17 + i * ROW)).join('') +
		c.operations.map((v, i) => rowText(v, l + 8, opY + 17 + i * ROW)).join('')
	);
}

function stateShape(c: UmlStateComponent, p: string): string {
	const l = -c.bodyWidth / 2;
	const t = -c.bodyHeight / 2;
	const sep = t + 32;
	return (
		R(p, u(l), u(t), u(c.bodyWidth), u(c.bodyHeight), 10) +
		(c.details.length === 0 ? '' : P(p, `M ${u(l)} ${u(sep)} H ${u(-l)}`)) +
		T('schematic-uml-text', 0, u(t + 21), 13, renderMathLabelTspans(c.label), ' text-anchor="middle"', ' font-weight="600"') +
		c.details.map((v, i) => rowText(v, l + 8, sep + 17 + i * ROW)).join('')
	);
}

function sizedShape(c: UmlSizedComponent, p: string): string {
	const l = -c.bodyWidth / 2;
	const t = -c.bodyHeight / 2;
	const r = -l;
	const b = -t;
	const box = (extra = '', rx?: number) => R(`${p}${extra}`, u(l), u(t), u(c.bodyWidth), u(c.bodyHeight), rx);
	switch (c.kind) {
		case 'usecase': return `<ellipse ${p} cx="0" cy="0" rx="${u(r)}" ry="${u(b)}" />${labelText(c, '4', 13)}`;
		case 'lifeline': return R(p, u(l), u(t), u(c.bodyWidth), 32, 2) + labelText(c, u(t + 21)) + `<path ${p} stroke-dasharray="6 5" d="M 0 ${u(t + 32)} V ${u(b)}" />`;
		case 'note': return P(p, `M ${u(l)} ${u(t)} H ${u(r - 14)} L ${u(r)} ${u(t + 14)} V ${u(b)} H ${u(l)} Z M ${u(r - 14)} ${u(t)} V ${u(t + 14)} H ${u(r)}`) + labelText(c);
		case 'package': return P(p, `M ${u(l)} ${u(t + 12)} V ${u(b)} H ${u(r)} V ${u(t)} H ${u(l + Math.min(54, r))} L ${u(l + Math.min(64, r + 10))} ${u(t + 12)} Z`) + labelText(c, '4', 13);
		case 'activation': return box();
		case 'fragment':
		case 'interaction':
			return box() + P(p, `M ${u(l)} ${u(t + 20)} H ${u(l + 58)} L ${u(l + 68)} ${u(t + 10)} V ${u(t)}`) + T('schematic-uml-text', u(l + 6), u(t + 14), 11, c.kind === 'interaction' ? 'ref' : 'alt') + labelText(c);
		default: {
			const icon =
				c.kind === 'component' ? P(p, `M ${u(r - 22)} ${u(t + 10)} h 14 v 10 h -14 z M ${u(r - 22)} ${u(t + 25)} h 14 v 10 h -14 z`)
				: c.kind === 'artifact' ? P(p, `M ${u(r - 16)} ${u(t)} v 16 h 16`)
				: c.kind === 'node' || c.kind === 'device' || c.kind === 'execution' ? P(p, `M ${u(l)} ${u(t + 10)} l 12 -10 h ${u(c.bodyWidth)} l -12 10 M ${u(r)} ${u(t)} v ${u(c.bodyHeight - 10)} l -12 10`)
				: c.kind === 'partition' ? P(p, `M ${u(l + 28)} ${u(t)} V ${u(b)}`)
				: '';
			return box(c.kind === 'region' ? ' stroke-dasharray="6 4"' : '', c.kind === 'action' ? 10 : 1) + icon + labelText(c);
		}
	}
}

const xPath = (d: number) => `M ${-d} ${-d} L ${d} ${d} M ${d} ${-d} L ${-d} ${d}`;

function smallShape(c: UmlActorComponent | UmlPseudostateComponent, p: string, np: string): string {
	switch (c.kind) {
		case 'actor': return C(p, 0, -28, 9) + P(p, 'M 0 -19 V 12 M -20 -5 H 20 M 0 12 L -17 37 M 0 12 L 17 37') + labelText(c, '49');
		case 'provided-interface':
		case 'entry': return C(p, 0, 0, 10);
		case 'exit': return C(p, 0, 0, 10) + P(p, xPath(6));
		case 'required-interface': return P(p, 'M 0 -10 A 10 10 0 0 0 0 10');
		case 'component-port': return R(p, -7, -7, 14, 14);
		case 'decision':
		case 'merge':
		case 'choice': return P(p, 'M 0 -17 L 17 0 0 17 -17 0 Z');
		case 'fork':
		case 'join': return R(np, -38, -4, 76, 8, 1);
		case 'activity-final':
		case 'final': return C(p, 0, 0, 11) + C(np, 0, 0, 6);
		case 'flow-final': return C(p, 0, 0, 11) + P(p, xPath(7));
		case 'send-signal': return P(p, 'M -21 -14 H 5 L 21 0 5 14 H -21 Z');
		case 'receive-signal': return P(p, 'M -21 -14 H 21 L 5 0 21 14 H -21 Z');
		case 'destruction': return P(p, xPath(10));
		case 'terminate': return P(p, xPath(9));
		case 'gate':
		case 'found':
		case 'lost': return C(c.kind === 'lost' ? p : np, 0, 0, 5);
		case 'state-junction': return C(np, 0, 0, 7);
		case 'history': return C(p, 0, 0, 11) + T('schematic-uml-text', 0, 4, 11, c.variant === 'deep' ? 'H*' : 'H', ' text-anchor="middle"');
		case 'initial': return C(np, 0, 0, 10);
	}
}

const uml: KindDef<UmlComponent> = {
	parse(kind, common: CommonFields, options, line): UmlComponent {
		if (CLASS_KINDS.has(kind)) {
			only(options, ['attributes', 'operations', 'stereotype', 'width'], line);
			const attributes = rows(options.get('attributes'), 'attributes', line);
			const operations = rows(options.get('operations'), 'operations', line);
			const stereotype = options.get('stereotype') ?? (kind === 'interface' || kind === 'enumeration' || kind === 'datatype' ? kind : undefined);
			if (stereotype !== undefined && (stereotype === '' || stereotype.length > 128)) throw new SchematicSyntaxError('stereotype must contain 1 through 128 characters.', line);
			const calc = Math.max(120, widest(common.label, [...attributes, ...operations], stereotype) + 24);
			const comp: UmlClassComponent = {
				kind: kind as UmlClassComponent['kind'],
				...common,
				attributes,
				operations,
				bodyWidth: Math.max(calc, dimension(options.get('width'), calc, 'width', line)),
				bodyHeight: 36 + Math.max(24, attributes.length * ROW + 8) + Math.max(24, operations.length * ROW + 8) + (stereotype === undefined ? 0 : 14)
			};
			if (stereotype !== undefined) comp.stereotype = stereotype;
			return comp;
		}
		if (kind === 'state') {
			only(options, ['details', 'width'], line);
			const details = rows(options.get('details'), 'details', line);
			const calc = Math.max(112, widest(common.label, details) + 28);
			return { kind: 'state', ...common, details, bodyWidth: Math.max(calc, dimension(options.get('width'), calc, 'width', line)), bodyHeight: 40 + details.length * ROW };
		}
		if (kind === 'history') {
			only(options, ['type'], line);
			return { kind: 'history', ...common, variant: enumOption(options.get('type'), 'shallow', ['shallow', 'deep'] as const, 'type', line) };
		}
		if (SIZED_KINDS.has(kind)) {
			only(options, ['width', 'height'], line);
			const dw = Math.max(kind === 'usecase' ? 112 : 96, mathLabelTextWidthAt(common.label, 12) + 28);
			const dh = kind === 'lifeline' ? 180 : kind === 'activation' ? 96 : kind === 'usecase' ? 56 : 64;
			return { kind: kind as UmlSizedComponent['kind'], ...common, bodyWidth: Math.max(dw, dimension(options.get('width'), dw, 'width', line)), bodyHeight: Math.max(dh, dimension(options.get('height'), dh, 'height', line)) };
		}
		only(options, [], line);
		return { kind: kind as UmlPseudostateComponent['kind'], ...common } as UmlComponent;
	},
	extents: half,
	ports: sides,
	resolve(c, name) {
		const pts = sides(c);
		if (name === 'in') return { ...pts[0]!, id: 'in' };
		if (name === 'out') return { ...pts[1]!, id: 'out' };
		const exact = pts.find((e) => e.id === name);
		if (exact !== undefined || c.kind !== 'lifeline') return exact;
		const m = /^(left|right)(\d+)$/.exec(name);
		if (m === null) return undefined;
		const off = Number(m[2]);
		if (off > c.bodyHeight) return undefined;
		const [w, h] = half(c);
		return { id: name, x: m[1] === 'left' ? -w : w, y: -h + off * 1000, nx: m[1] === 'left' ? -1 : 1, ny: 0 };
	},
	draw(c, p, np) {
		if (CLASS_KINDS.has(c.kind)) return classShape(c as UmlClassComponent, p);
		if (c.kind === 'state') return stateShape(c, p);
		if (SIZED_KINDS.has(c.kind)) return sizedShape(c as UmlSizedComponent, p);
		return smallShape(c as UmlActorComponent | UmlPseudostateComponent, p, np);
	}
};

export const UML_KINDS: Readonly<Record<string, KindDef<never>>> = Object.fromEntries(
	UML_COMPONENT_KINDS.map((k) => [k, uml])
) as unknown as Readonly<Record<string, KindDef<never>>>;
