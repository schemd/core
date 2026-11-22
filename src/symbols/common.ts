import { fmt, roundDiv, toMilli } from '../geom.js';
import { mathLabelTextWidthAt } from '../math-label.js';
import { escapeXml } from '../xml.js';
import {
	SCHEMATIC_ORIENTATIONS,
	SchematicSyntaxError,
	type SchematicColor,
	type SchematicComponent,
	type SchematicFit,
	type SchematicOrientation
} from '../types.js';

const SCHEMATIC_FITS = ['wires'] as const;

export interface LocalPort {
	readonly id: string;
	readonly x: number;
	readonly y: number;
	readonly nx: number;
	readonly ny: number;
}

export interface CommonFields {
	readonly id: string;
	readonly label: string;
	readonly x: number;
	readonly y: number;
	readonly color: SchematicColor;
	readonly line: number;
}

export interface KindDef<C extends SchematicComponent = SchematicComponent> {
	readonly parse: (kind: string, common: CommonFields, options: ReadonlyMap<string, string>, line: number) => C;
	readonly extents: (component: C) => readonly [number, number];
	readonly ports: (component: C) => readonly LocalPort[];
	readonly resolve: (component: C, name: string) => LocalPort | undefined;
	readonly draw: (component: C, paint: string, nodePaint: string) => string;
	readonly inner?: (component: C) => string;
	readonly symbol?: (component: C) => string | undefined;
}

export const TEXT_PAINT = 'fill="currentColor" stroke="none"';
export const LENGTH_FIT = 'lengthAdjust="spacingAndGlyphs"';
export const n = fmt;
export const u = (value: number): string => fmt(toMilli(value));
export const distributed = (index: number, count: number, span: number): number =>
	roundDiv((index + 1) * span * 2 - span * (count + 1), 2 * (count + 1));
export const port = (id: string, x: number, y: number, nx: number, ny: number): LocalPort => ({ id, x: x * 1000, y: y * 1000, nx, ny });
export const named = (source: LocalPort, id: string): LocalPort => ({ ...source, id });

export const P = (p: string, d: string): string => `<path ${p} d="${d}" />`;
export const C = (p: string, x: string | number, y: string | number, r: string | number): string => `<circle ${p} cx="${x}" cy="${y}" r="${r}" />`;
export const R = (p: string, x: string | number, y: string | number, w: string | number, h: string | number, rx?: string | number): string =>
	`<rect ${p} x="${x}" y="${y}" width="${w}" height="${h}"${rx === undefined ? '' : ` rx="${rx}"`} />`;
export const T = (cls: string, x: string | number, y: string | number, sz: number, body: string, pre = '', post = ''): string =>
	`<text class="${cls}" ${TEXT_PAINT} x="${x}" y="${y}"${pre} font-size="${sz}"${post}>${body}</text>`;

export function fitText(value: string, maximum: number, fontSize: number): string {
	return mathLabelTextWidthAt(value, fontSize) <= maximum ? '' : ` textLength="${Math.max(1, Math.floor(maximum))}" ${LENGTH_FIT}`;
}

export function colorAttributes(color: SchematicColor, extraClass = ''): string {
	const suffix = extraClass === '' ? '' : ` ${extraClass}`;
	const fill = extraClass.includes('schematic-node-fill') ? ' fill="currentColor"' : '';
	if (color.kind === 'token') return `class="schematic-token schematic-token--${color.value}${suffix}"${fill}`;
	if (color.kind === 'css') {
		const v = escapeXml(color.value);
		return `class="schematic-token schematic-token--custom${suffix}"${fill} style="color:${v};--schematic-vector:${v}"`;
	}
	const safe = color.value.replace(/[^a-z0-9-]/gi, '-');
	const v = `var(--schematic-color-${safe},var(--schematic-vector-fallback,currentColor))`;
	return `class="schematic-token schematic-token--alias schematic-color--${safe}${suffix}"${fill} style="color:${v};--schematic-vector:${v}"`;
}

export function includesValue<const T extends readonly string[]>(values: T, value: string): value is T[number] {
	return values.includes(value);
}

export function only(options: ReadonlyMap<string, string>, allowed: readonly string[], line: number): void {
	for (const key of options.keys()) {
		if (!allowed.includes(key)) throw new SchematicSyntaxError(`Option ${key} is not supported.`, line);
	}
}

export function enumOption<const T extends readonly string[]>(value: string | undefined, fallback: T[number], values: T, name: string, line: number): T[number] {
	if (value === undefined) return fallback;
	if (!includesValue(values, value)) throw new SchematicSyntaxError(`Option ${name} must be one of: ${values.join(', ')}.`, line);
	return value;
}

function intRange(value: string | undefined, fallback: number, max: number, name: string, line: number): number {
	if (value === undefined) return fallback;
	const v = Number(value);
	if (!/^\d+$/.test(value) || v < 1 || v > max) throw new SchematicSyntaxError(`${name} must be an integer from 1 through ${max}.`, line);
	return v;
}

export const count = (value: string | undefined, fallback: number, name: string, line: number): number => intRange(value, fallback, 32, name, line);
export const width = (value: string | undefined, fallback: number, line: number): number => intRange(value, fallback, 256, 'width', line);

export function orientation(options: ReadonlyMap<string, string>, line: number): { orientation?: SchematicOrientation } {
	const value = options.get('orientation');
	return value === undefined ? {} : { orientation: enumOption(value, 'right', SCHEMATIC_ORIENTATIONS, 'orientation', line) };
}

export function fit(options: ReadonlyMap<string, string>, line: number): { fit?: SchematicFit } {
	const value = options.get('fit');
	if (value === undefined) return {};
	const chosen = enumOption(value, 'wires', SCHEMATIC_FITS, 'fit', line);
	if (options.has('orientation')) {
		throw new SchematicSyntaxError('fit=wires lines terminals up with their wires vertically; remove orientation or fit.', line, undefined, 'option');
	}
	return { fit: chosen };
}

export function indexed(name: string, inputs: number, outputs: number): { output: boolean; index: number } | undefined {
	if (name === 'in') return inputs > 0 ? { output: false, index: 0 } : undefined;
	if (name === 'out') return { output: true, index: 0 };
	const m = /^(in|out)([1-9]\d*)$/.exec(name);
	if (m === null) return undefined;
	const index = Number(m[2]) - 1;
	const output = m[1] === 'out';
	return index < (output ? outputs : inputs) ? { output, index } : undefined;
}

export const byName = (ports: readonly LocalPort[], name: string): LocalPort | undefined => ports.find((e) => e.id === name);
