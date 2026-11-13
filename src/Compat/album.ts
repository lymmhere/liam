import { Boom } from '@hapi/boom'
import { delay } from '../Utils/generics'

type AnyObj = Record<string, any>

/**
 * Adds `sock.sendAlbumMessage(jid, items, options?)` and lets `sendMessage(jid, { album: [...] })`
 * accept an array of `{ image | video, caption? }` items.
 *
 * WhatsApp albums are one parent albumMessage followed by the media, each linked to the parent.
 */
export const applyAlbum = <S extends object>(socket: S): S => {
	const sock = socket as AnyObj
	const origSend = sock.sendMessage.bind(sock)

	const sendAlbumMessage = async (jid: string, items: AnyObj[], options: AnyObj = {}) => {
		if (!Array.isArray(items) || items.length < 2) {
			throw new Boom('an album needs at least 2 items ({ image } or { video })', { statusCode: 400 })
		}

		if (items.length > 10) throw new Boom('an album can hold at most 10 items', { statusCode: 400 })

		const images = items.filter(i => i.image).length
		const videos = items.filter(i => i.video).length
		if (images + videos !== items.length) {
			throw new Boom('every album item must have an `image` or a `video`', { statusCode: 400 })
		}

		const parent = await origSend(
			jid,
			{ album: { expectedImageCount: images, expectedVideoCount: videos } },
			options
		)
		const sent = [parent]
		// children are linked to the parent; the reply context only belongs on the parent
		const { quoted: _quoted, ...childOptions } = options
		for (const item of items) {
			sent.push(await origSend(jid, { ...item, albumParentKey: parent.key }, childOptions))
			await delay(options.albumDelayMs ?? 300)
		}

		return sent
	}

	sock.sendAlbumMessage = sendAlbumMessage
	sock.sendMessage = (jid: string, content: AnyObj, options?: AnyObj) =>
		content && Array.isArray(content.album)
			? sendAlbumMessage(jid, content.album, options).then(sent => sent[0])
			: origSend(jid, content, options)

	return socket
}
