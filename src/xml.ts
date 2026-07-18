/** Shared single-pass XML character-data escaping for generated SVG markup. */

/** Determine whether XML 1.0 permits one Unicode scalar value. */
function validXmlCodePoint(codePoint: number): boolean {
	if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) return true;
	if (codePoint >= 0x20 && codePoint <= 0xd7ff) return true;
	if (codePoint >= 0xe000 && codePoint <= 0xfffd) return true;
	return codePoint >= 0x10000 && codePoint <= 0x10ffff;
}

/**
 * Replace XML-forbidden code points and escape XML-significant characters in
 * one pass, avoiding the normalized copy plus five full-string replacements.
 */
export function escapeXml(value: string): string {
	let escaped = '';
	for (const character of value) {
		if (!validXmlCodePoint(character.codePointAt(0)!)) {
			escaped += '\ufffd';
			continue;
		}
		switch (character) {
			case '&':
				escaped += '&amp;';
				break;
			case '<':
				escaped += '&lt;';
				break;
			case '>':
				escaped += '&gt;';
				break;
			case '"':
				escaped += '&quot;';
				break;
			case "'":
				escaped += '&#39;';
				break;
			default:
				escaped += character;
		}
	}
	return escaped;
}
