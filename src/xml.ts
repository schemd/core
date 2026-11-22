const XML_UNSAFE = /[&<>"'\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]/;
const XML_ENT: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeXml(value: string): string {
	if (!XML_UNSAFE.test(value)) return value;
	let out = '';
	for (const ch of value) {
		const cp = ch.codePointAt(0)!;
		if (
			cp !== 9 &&
			cp !== 10 &&
			cp !== 13 &&
			!(cp >= 32 && cp <= 0xd7ff) &&
			!(cp >= 0xe000 && cp <= 0xfffd) &&
			!(cp >= 0x10000 && cp <= 0x10ffff)
		) {
			out += '\ufffd';
		} else {
			out += XML_ENT[ch] ?? ch;
		}
	}
	return out;
}
