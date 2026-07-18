import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const MAX_GZIP_BYTES = 20 * 1024;
const virtualEntry = 'virtual:schemd-size-entry';
const compilerPath = fileURLToPath(new URL('../src/compiler.ts', import.meta.url));

const result = await build({
	configFile: false,
	logLevel: 'silent',
	plugins: [
		{
			name: 'schemd-size-entry',
			enforce: 'pre',
			resolveId(id) {
				if (id === virtualEntry) return `\0${virtualEntry}`;
			},
			load(id) {
				if (id === `\0${virtualEntry}`) {
					return `import { compileSchematic } from ${JSON.stringify(compilerPath)};globalThis.schemdCompile=compileSchematic;`;
				}
			}
		}
	],
	build: {
		minify: true,
		rollupOptions: { input: virtualEntry, treeshake: true },
		target: 'es2022',
		write: false
	}
});

const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
const chunks = outputs.filter((item) => item.type === 'chunk' && item.code.length > 0);
if (chunks.length !== 1) throw new Error(`Expected one compiler chunk; received ${chunks.length}.`);

const minifiedBytes = Buffer.byteLength(chunks[0].code);
const gzipBytes = gzipSync(chunks[0].code, { level: 9 }).byteLength;
console.log(
	`Compiler bundle: ${minifiedBytes.toLocaleString('en-US')} B minified, ${gzipBytes.toLocaleString('en-US')} B gzip`
);

if (gzipBytes > MAX_GZIP_BYTES) {
	throw new Error(
		`Compiler bundle exceeds the ${MAX_GZIP_BYTES.toLocaleString('en-US')} B gzip budget by ${(gzipBytes - MAX_GZIP_BYTES).toLocaleString('en-US')} B.`
	);
}
