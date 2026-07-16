/**
 * Hard compiler budgets shared by the parser, renderer, and Marked integration.
 *
 * `parseSchematic` and `renderSchematic` enforce these limits for one diagram.
 * `schematicMarkedExtension` additionally enforces them cumulatively across all
 * schematic fences encountered during one Marked document pass.
 *
 * @packageDocumentation
 */
/** Maximum UTF-16 source characters accepted in one compilation pass. */
export const MAX_SCHEMATIC_SOURCE_CHARACTERS = 131_072;
/** Maximum component declarations accepted in one document. */
export const MAX_SCHEMATIC_COMPONENTS = 512;
/** Maximum directed connections accepted in one document. */
export const MAX_SCHEMATIC_CONNECTIONS = 2_048;
/** Maximum UTF-8 bytes the bounded SVG writer may emit. */
export const MAX_SCHEMATIC_SVG_OUTPUT_BYTES = 2_097_152;

/** Frozen runtime-readable form of every compiler allocation ceiling. */
export const SCHEMATIC_LIMITS = Object.freeze({
	sourceCharacters: MAX_SCHEMATIC_SOURCE_CHARACTERS,
	components: MAX_SCHEMATIC_COMPONENTS,
	connections: MAX_SCHEMATIC_CONNECTIONS,
	svgOutputBytes: MAX_SCHEMATIC_SVG_OUTPUT_BYTES
});

/**
 * Return the exact UTF-8 byte length without allocating an encoded copy.
 *
 * @param value - JavaScript string whose encoded output cost is required.
 * @returns Number of UTF-8 bytes, including four-byte astral code points.
 */
export function utf8ByteLength(value: string): number {
	let bytes = 0;
	for (const character of value) {
		const codePoint = character.codePointAt(0)!;
		if (codePoint <= 0x7f) bytes += 1;
		else if (codePoint <= 0x7ff) bytes += 2;
		else if (codePoint <= 0xffff) bytes += 3;
		else bytes += 4;
	}
	return bytes;
}
