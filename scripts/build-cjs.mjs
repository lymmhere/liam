// Bundles src/ into a single CommonJS file so `require('@lymmhere/liam')` works on every Node >= 20,
// without relying on require(esm). Dependencies stay external (installed from package.json).
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('cjs', { recursive: true })

await build({
	entryPoints: ['src/index.ts'],
	outfile: 'cjs/index.cjs',
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	packages: 'external',
	sourcemap: true,
	logLevel: 'info'
})

// esbuild's CJS output puts everything on module.exports; make `require(...).default` and the
// named export both point to makeWASocket, the way old Baileys behaved.
writeFileSync('cjs/package.json', JSON.stringify({ type: 'commonjs' }) + '\n')
console.log('cjs build ok')
