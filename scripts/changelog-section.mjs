/**
 * Print one version's section of CHANGELOG.md.
 *
 * The changelog is already the prose of record for a release; cutting a GitHub
 * Release used to mean copying that section into the web UI by hand, and the
 * website then copied it a second time into its own source. This makes the
 * changelog the single origin: the release workflow pipes this into the
 * release body, and the website reads the published body from the API.
 *
 *   node scripts/changelog-section.mjs 0.4.0
 *
 * Exits non-zero when the version has no section, so a release cannot be cut
 * for a version nobody wrote down.
 */
import { readFile } from 'node:fs/promises';

const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
	console.error('Usage: node scripts/changelog-section.mjs <version>');
	process.exit(2);
}

const markdown = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
/* Sections are `## [0.4.0] - 07/26/2026` and run until the next `## `. */
const sections = markdown.split(/^## +/m).slice(1);
const escaped = version.replace(/\./g, '\\.');
const section = sections.find((entry) =>
	new RegExp(`^\\[?${escaped}\\]?(?:\\s|$)`).test(entry.trimStart())
);

if (!section) {
	console.error(`CHANGELOG.md has no section for ${version}.`);
	process.exit(1);
}

/* Drop the heading line: the release already carries the version and date. */
process.stdout.write(`${section.slice(section.indexOf('\n') + 1).trim()}\n`);
