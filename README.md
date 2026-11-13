# Liam

Custom WhatsApp Web API, a fork of [Baileys](https://github.com/WhiskeySockets/Baileys) (MIT) made to be a **drop-in replacement for bot scripts** (Cantarella, Bulter-style, etc.).

What Liam adds on top of upstream Baileys 7:

| Feature | Why |
|---|---|
| **CJS + ESM** (`require` and `import` both work) | Most scripts are CommonJS; upstream is ESM-only |
| `makeInMemoryStore` | removed upstream, scripts still call it |
| `useSingleFileAuthState` | removed upstream |
| `InteractiveMessage` export | many forks export it, scripts destructure it |
| Legacy `buttons` / `sections` / `templateButtons` / `interactiveButtons` in `sendMessage` | auto-converted to native-flow interactive messages that WhatsApp still renders |
| Auto `biz` / `bot` stanza nodes for interactive + list messages (incl. raw `relayMessage`) | without them buttons do not show up in private chats |
| **Carousel** (`carousel: { cards }`, 2-10 cards, validated) and **album** (`sendAlbumMessage` / `album: [...]`) | not in upstream as one call |
| Raw `interactiveMessage` / `listMessage` / `buttonsMessage` keys, `{ id, text }` button shortcuts, object `buttonParamsJson` | the shapes bot libraries document |
| **LID → phone-number compat** (`pnCompat`, default on) | scripts compare `628xx@s.whatsapp.net`; Liam gives them that. LID stays in `key.participantLid`, `key.remoteJidLid`, `participant.lid` |

## Install

```bash
npm i @lymmhere/liam
```

Use it with an existing script **without editing its code**, by aliasing the package name the script imports:

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "npm:@lymmhere/liam"
  }
}
```

or `npm i @whiskeysockets/baileys@npm:@lymmhere/liam`.

## Usage

```js
const { default: makeWASocket, useMultiFileAuthState, makeInMemoryStore } = require('@lymmhere/liam')

const { state, saveCreds } = await useMultiFileAuthState('./session')
const sock = makeWASocket({ auth: state })           // pnCompat: true by default
sock.ev.on('creds.update', saveCreds)

await sock.sendMessage(jid, {
  text: 'Pilih salah satu',
  footer: 'Liam',
  buttons: [{ buttonId: '.menu', buttonText: { displayText: 'Menu' }, type: 1 }],
  headerType: 1
})
```

### Interactive messages

```js
// buttons: quick_reply, cta_url, cta_copy, cta_call, single_select... (any native flow name)
await sock.sendMessage(jid, {
  text: 'Pilih', footer: 'Liam',
  interactiveButtons: [
    { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Ya', id: 'yes' }) },
    { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Buka', url: 'https://example.com', merchant_url: 'https://example.com' }) },
    { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Salin', id: 'c', copy_code: 'LIAM20' }) }
  ]
})

// carousel: 2-10 cards, every card must have the same number of buttons
await sock.sendMessage(jid, {
  text: 'Katalog', footer: 'Liam',
  carousel: { cards: [
    { image: { url: 'https://example.com/1.jpg' }, title: 'Satu', body: 'Deskripsi', buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Buka', url: 'https://example.com/1' }) }] },
    { image: { url: 'https://example.com/2.jpg' }, title: 'Dua',  body: 'Deskripsi', buttons: [{ name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Buka', url: 'https://example.com/2' }) }] }
  ] }
})

// album
await sock.sendAlbumMessage(jid, [{ image: { url: 'a.jpg' }, caption: '1' }, { image: { url: 'b.jpg' } }])
```

Opt out of the phone-number conversion: `makeWASocket({ auth: state, pnCompat: false })`.

## Build / release

```bash
yarn install
yarn build        # ESM -> lib/, CJS -> cjs/
yarn smoke        # checks exports + legacy button conversion
```

Releasing: bump `version` in `package.json`, push a tag `v1.0.1`; the GitHub Action builds, runs the smoke test and publishes (needs the `NPM_TOKEN` repo secret).

Staying current with upstream:

```bash
git remote add upstream https://github.com/WhiskeySockets/Baileys
git fetch upstream && git merge upstream/master   # then re-run yarn build && yarn smoke
```

## Disclaimer

Not affiliated with WhatsApp or Meta. Baileys-based libraries are unofficial: numbers can be banned, especially for spam or mass broadcast.

## License

MIT. Original work © WhiskeySockets / Baileys contributors; see `LICENSE`.
