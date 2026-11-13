// Run after `npm run build`: checks that every name Cantarella-style scripts destructure is present.
const L = require('../cjs/index.cjs')
const need = [
	'makeWASocket', 'default', 'makeCacheableSignalKeyStore', 'downloadContentFromMessage', 'generateWAMessageFromContent',
	'generateWAMessage', 'generateWAMessageContent', 'generateForwardMessageContent', 'prepareWAMessageMedia',
	'useMultiFileAuthState', 'useSingleFileAuthState', 'makeInMemoryStore', 'fetchLatestBaileysVersion',
	'fetchLatestWaWebVersion', 'MessageType', 'proto', 'Browsers', 'getContentType', 'DisconnectReason',
	'areJidsSameUser', 'InteractiveMessage', 'WA_DEFAULT_EPHEMERAL', 'jidDecode', 'jidNormalizedUser', 'delay',
	'extractMessageContent', 'getDevice', 'generateMessageIDV2', 'getAggregateVotesInPollMessage'
]
const missing = need.filter(n => L[n] === undefined)
if (missing.length) { console.error('MISSING exports:', missing.join(', ')); process.exit(1) }

// legacy buttons -> native flow
;(async () => {
	const content = await L.generateWAMessageContent(
		{ text: 'hi', footer: 'f', buttons: [{ buttonId: '.menu', buttonText: { displayText: 'Menu' }, type: 1 }], headerType: 1 },
		{ logger: { debug() {}, info() {}, warn() {}, error() {}, trace() {}, child() { return this } }, getUrlInfo: async () => undefined, upload: async () => ({}), options: {} }
	)
	const nf = content.interactiveMessage?.nativeFlowMessage?.buttons?.[0]
	if (!nf || nf.name !== 'quick_reply') { console.error('legacy buttons conversion failed', JSON.stringify(content)); process.exit(1) }
	const o = { logger: { debug() {}, info() {}, warn() {}, error() {}, trace() {}, child() { return this } }, getUrlInfo: async () => undefined, upload: async () => ({}), options: {} }
	const raw = await L.generateWAMessageContent({ interactiveMessage: { header: { title: 'H' }, body: { text: 'B' }, nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: { display_text: 'Go', url: 'https://x.y' } }] } } }, o)
	if (raw.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name !== 'cta_url') { console.error('raw interactiveMessage failed', JSON.stringify(raw)); process.exit(1) }
	const list = await L.generateWAMessageContent({ text: 'pick', buttonText: 'Open', sections: [{ title: 'S', rows: [{ title: 'r', rowId: 'r1' }] }] }, o)
	if (list.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name !== 'single_select') { console.error('list conversion failed'); process.exit(1) }
	const store = L.makeInMemoryStore({})
	if (typeof store.bind !== 'function' || typeof store.loadMessage !== 'function') { console.error('store broken'); process.exit(1) }
	console.log('smoke ok: %d exports checked', need.length)
})()
