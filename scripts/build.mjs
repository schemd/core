import { readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const input = Object.fromEntries(
	Object.keys(manifest.exports).map((subpath) => {
		const name = subpath === '.' ? 'index' : subpath.slice(2);
		return [name, join(root, `src/${name}.ts`)];
	})
);

rmSync(join(root, 'dist'), { recursive: true, force: true });

await build({
	root,
	logLevel: 'error',
	configFile: false,
	build: {
		outDir: 'dist',
		emptyOutDir: false,
		minify: true,
		sourcemap: false,
		target: 'es2022',
		rollupOptions: {
			input,
			preserveEntrySignatures: 'strict',
			output: {
				format: 'es',
				entryFileNames: '[name].js',
				chunkFileNames: '_[name].js'
			}
		}
	}
});

execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.types.json')], {
	cwd: root,
	stdio: 'inherit'
});
