import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('cjs', { recursive: true })

writeFileSync(
	'cjs/index.cjs',
	`'use strict'
try {
	module.exports = require('../lib/index.js')
} catch (err) {
	if (err && (err.code === 'ERR_REQUIRE_ESM' || err.code === 'ERR_REQUIRE_ASYNC_MODULE')) {
		throw new Error(
			'Liam needs Node.js >= 20.19 or >= 22.12 to be loaded with require() (you have ' + process.version + '). ' +
				'Upgrade Node, or load it with: await import("@lymmhere/liam")'
		)
	}
	throw err
}
`
)
writeFileSync('cjs/package.json', JSON.stringify({ type: 'commonjs' }) + '\n')
console.log('cjs shim ok')
