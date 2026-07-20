/** First-class UML parsing, sizing, routing, and marker rendering verification. */
import { describe, expect, test } from 'vitest';
import {
	parseSchematic,
	renderSchematic,
	resolvePortPoint,
	type SchematicFence,
	type UmlClassComponent
} from '../src/index.js';

const fence: SchematicFence = {
	bounds: { width: 1200, height: 640 },
	title: 'Account service UML'
};

const source = `class:Account "Account" at (210, 150) #slate [stereotype="entity" attributes="- id: UUID;- balance: Money" operations="+ credit(amount: Money): void;+ debit(amount: Money): bool"]
class:Savings "SavingsAccount" at (560, 150) #blue [attributes="- rate: Decimal" operations="+ accrue(): Money"]
actor:User "Customer" at (90, 390) #purple
usecase:Login "Sign in" at (330, 390) #cyan
lifeline:Client "Client" at (680, 390) #slate [height=260]
lifeline:Server "Server" at (960, 390) #slate [height=260]
initial:Start "Start" at (90, 570) #slate
state:Idle "Idle" at (330, 570) #emerald [details="entry / reset();do / wait()"]
final:Done "Done" at (540, 570) #slate
state:Empty "Empty" at (700, 570) #blue
package:Domain "Domain" at (1060, 500) #slate
note:Hint "Retry once" at (1060, 590) #amber

Savings.left -> Account.right #blue [ortho generalization label="inherits"]
User.right -> Login.left #purple [association label="opens"]
Client.right80 -> Server.left120 #slate [ortho message label="authenticate(credentials)"]
Start.right -> Idle.left #emerald [transition]`;

describe('UML diagrams', () => {
	test('parses dynamic class compartments and semantic relationships', () => {
		const document = parseSchematic(source, fence);
		const account = document.components[0] as UmlClassComponent;
		expect(account).toMatchObject({
			kind: 'class',
			stereotype: 'entity',
			attributes: ['- id: UUID', '- balance: Money'],
			operations: ['+ credit(amount: Money): void', '+ debit(amount: Money): bool']
		});
		expect(account.bodyWidth).toBeGreaterThan(200);
		expect(account.bodyHeight).toBe(130);
		expect(document.connections).toMatchObject([
			{ relation: 'generalization', markerEnd: 'triangle', dashed: false },
			{ relation: 'association', label: 'opens' },
			{ relation: 'message', markerEnd: 'open-arrow', label: 'authenticate(credentials)' },
			{ relation: 'transition', markerEnd: 'open-arrow' }
		]);
		const client = document.components.find((component) => component.id === 'Client')!;
		const accountNode = document.components.find((component) => component.id === 'Account')!;
		expect(resolvePortPoint(client, 'right80')).toEqual({ x: 728, y: 340 });
		expect(() => resolvePortPoint(client, 'left999')).toThrow(/missing/);
		expect(() => resolvePortPoint(client, 'center')).toThrow(/missing/);
		expect(() => resolvePortPoint(accountNode, 'center')).toThrow(/missing/);
		expect(Object.isFrozen(account.attributes)).toBe(true);
	});

	test('renders class, sequence, state, use-case, and relation primitives', () => {
		const html = renderSchematic(parseSchematic(source, fence), { ...fence, mode: 'embedded-css' });
		expect(html).toContain('schematic-uml-stereotype');
		expect(html).toContain('«entity»');
		expect(html).toContain('- balance: Money');
		expect(html).toContain('stroke-dasharray="6 5"');
		expect(html).toContain('marker-triangle');
		expect(html).toContain('marker-open-arrow');
		expect(html).toContain('markerUnits="userSpaceOnUse"');
		expect(html).toContain('authenticate(credentials)');
		expect(html).not.toContain('>Start</text>');
		expect(html).toContain('Retry once');
		expect(html).toContain('>Domain</text>');
	});

	test('uses micro-math consistently in UML rows and stereotypes', () => {
		const mathDocument = parseSchematic(
			`class:Math "Transfer" at (300, 180) #slate [stereotype="\\Delta" attributes="- impedance: \\Omega" operations="+ gain(x^2): \\infty"]
state:Ready "Ready" at (720, 180) #blue [details="entry / f_c;do / e^{x^2}"]`,
			fence
		);
		const html = renderSchematic(mathDocument, fence);
		expect(html).toContain('«<tspan dy="0em" font-size="100%">Δ</tspan>»');
		expect(html).toContain('- impedance: Ω');
		expect(html).toContain('>+ gain(x</tspan><tspan dy="-0.7857em"');
		expect(html).toContain('): ∞</tspan>');
		expect(html).toContain('>c</tspan>');
		expect(html).not.toContain('\\Omega');
		expect(html).not.toContain('\\infty');
	});

	test('derives every UML marker and dependency dash convention', () => {
		const relationDocument = parseSchematic(
			`class:A "A" at (220, 180) #slate
class:B "B" at (620, 180) #blue
A.right -> B.left #slate [bezier relation=dependency label="calls"]
A.right -> B.left #slate [realization]
A.right -> B.left #slate [aggregation]
A.right -> B.left #slate [composition]
A.right -> B.left #slate [include]
A.right -> B.left #slate [extend]
A.right -> A.right #slate [dashed label="self"]`,
			fence
		);
		expect(relationDocument.connections).toMatchObject([
			{ relation: 'dependency', markerEnd: 'open-arrow', dashed: true, curve: 'bezier' },
			{ relation: 'realization', markerEnd: 'triangle', dashed: true },
			{ relation: 'aggregation', markerStart: 'diamond', dashed: false },
			{ relation: 'composition', markerStart: 'diamond-filled', dashed: false },
			{ relation: 'include', label: '«include»', dashed: true },
			{ relation: 'extend', label: '«extend»', dashed: true },
			{ relation: 'signal', label: 'self', dashed: true }
		]);
		const html = renderSchematic(relationDocument, fence);
		expect(html).toContain('marker-diamond');
		expect(html).toContain('marker-diamond-filled');
		expect(html).toContain('refX="12"');
		expect(html).toContain('stroke-dasharray="7 5"');
		expect(html).toContain('>calls</text>');
		expect(html).toContain('>self</text>');
	});

	test('rejects malformed and unbounded UML fields without hanging', () => {
		expect(() =>
			parseSchematic('class:C "C" at (200, 200) #slate [attributes="unterminated]', fence)
		).toThrow(/Malformed/);
		expect(() =>
			parseSchematic(
				`class:C "C" at (200, 200) #slate [attributes="${Array.from({ length: 65 }, (_, index) => `a${index}`).join(';')}"]`,
				fence
			)
		).toThrow(/at most 64 rows/);
		for (const declaration of [
			'class:C "C" at (200, 200) #slate [attributes="a;;b"]',
			`class:C "C" at (200, 200) #slate [operations="${'x'.repeat(257)}"]`,
			'class:C "C" at (200, 200) #slate [width=bad]',
			'class:C "C" at (200, 200) #slate [width=23]',
			'class:C "C" at (200, 200) #slate [width=2049]',
			'class:C "C" at (200, 200) #slate [stereotype=""]',
			`class:C "C" at (200, 200) #slate [stereotype="${'x'.repeat(129)}"]`,
			'class:C "C" at (200, 200) #slate [Inputs=2]'
		]) {
			expect(() => parseSchematic(declaration, fence)).toThrow();
		}
		const edgePrefix = 'class:A "A" at (200, 200) #slate\nclass:B "B" at (500, 200) #slate\n';
		for (const options of [
			'[dashed solid]',
			'[dependency realization]',
			'[label="x"junk]',
			'[relation=unknown]',
			'[label=""]',
			`[label="${'x'.repeat(257)}"]`
		]) {
			expect(() => parseSchematic(`${edgePrefix}A.right -> B.left #slate ${options}`, fence)).toThrow();
		}
	});
});
