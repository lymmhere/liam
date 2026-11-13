/**
 * Liam compat: legacy `buttons` / `sections` / `templateButtons` / `interactiveButtons`
 * content (the format used by older Baileys and by most bot scripts) is converted to a
 * modern native-flow interactiveMessage, which is what WhatsApp still renders.
 */
import { proto } from '../../WAProto/index.js'
import { Boom } from '@hapi/boom'
import type { BinaryNode } from '../WABinary'

type AnyObj = Record<string, any>

/** media uploader injected from Utils/messages (avoids a circular import) */
export type PrepareMedia = (content: AnyObj, options: any) => Promise<proto.IMessage>
export type BuildContext = { prepare?: PrepareMedia; options?: any }

const asJson = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? {}))

const carouselOf = (message: AnyObj) => message.carousel ?? message.carouselMessage ?? (Array.isArray(message.cards) ? { cards: message.cards } : undefined)

/** raw keys that are not text/media content on their own: interactiveMessage, listMessage, buttonsMessage */
export const hasRawInteractive = (message: AnyObj): boolean =>
	(!!message.interactiveMessage && typeof message.interactiveMessage === 'object') ||
	(!!message.listMessage && typeof message.listMessage === 'object') ||
	(!!message.buttonsMessage && typeof message.buttonsMessage === 'object')

export const hasLegacyInteractive = (message: AnyObj): boolean =>
	!!carouselOf(message) ||
	(Array.isArray(message.buttons) && message.buttons.length > 0) ||
	(Array.isArray(message.sections) && message.sections.length > 0) ||
	(Array.isArray(message.templateButtons) && message.templateButtons.length > 0) ||
	(Array.isArray(message.interactiveButtons) && message.interactiveButtons.length > 0)

type NativeButton = { name: string; buttonParamsJson: string }

const fromLegacyButton = (b: AnyObj): NativeButton => {
	// already native: { name, buttonParamsJson }
	if (b.name && (b.buttonParamsJson !== undefined || b.paramsJson !== undefined)) {
		return { name: b.name, buttonParamsJson: asJson(b.buttonParamsJson ?? b.paramsJson) }
	}

	// legacy native flow: { type: 4, nativeFlowInfo: { name, paramsJson } }
	if (b.nativeFlowInfo) {
		return { name: b.nativeFlowInfo.name, buttonParamsJson: asJson(b.nativeFlowInfo.paramsJson) }
	}

	// legacy quick reply: { buttonId, buttonText: { displayText }, type: 1 }
	// shortcuts: { id, text } | { id, displayText } | { buttonId, buttonText: 'string' }
	return {
		name: 'quick_reply',
		buttonParamsJson: JSON.stringify({
			display_text:
				(typeof b.buttonText === 'string' ? b.buttonText : b.buttonText?.displayText) ?? b.displayText ?? b.text ?? '',
			id: b.buttonId ?? b.id ?? ''
		})
	}
}

const fromTemplateButton = (b: AnyObj): NativeButton => {
	if (b.quickReplyButton) {
		return {
			name: 'quick_reply',
			buttonParamsJson: JSON.stringify({
				display_text: b.quickReplyButton.displayText,
				id: b.quickReplyButton.id
			})
		}
	}

	if (b.urlButton) {
		return {
			name: 'cta_url',
			buttonParamsJson: JSON.stringify({
				display_text: b.urlButton.displayText,
				url: b.urlButton.url,
				merchant_url: b.urlButton.url
			})
		}
	}

	if (b.callButton) {
		return {
			name: 'cta_call',
			buttonParamsJson: JSON.stringify({
				display_text: b.callButton.displayText,
				phone_number: b.callButton.phoneNumber
			})
		}
	}

	return fromLegacyButton(b)
}

const fromSections = (message: AnyObj): NativeButton => ({
	name: 'single_select',
	buttonParamsJson: JSON.stringify({
		title: message.buttonText || message.title || 'Select',
		sections: message.sections.map((s: AnyObj) => ({
			title: s.title ?? '',
			...(s.highlight_label ? { highlight_label: s.highlight_label } : {}),
			rows: (s.rows || []).map((r: AnyObj) => ({
				header: r.header ?? '',
				title: r.title ?? '',
				description: r.description ?? '',
				id: r.rowId ?? r.id ?? ''
			}))
		}))
	})
})

const CONTEXT_INFO = { deviceListMetadata: {}, deviceListMetadataVersion: 2 }

const paramsJson = (v: unknown) => (v === undefined || v === null || v === '' ? '' : asJson(v))

const toNativeButtons = (message: AnyObj): NativeButton[] => {
	const buttons: NativeButton[] = []
	if (Array.isArray(message.interactiveButtons)) buttons.push(...message.interactiveButtons.map(fromLegacyButton))
	if (Array.isArray(message.buttons)) buttons.push(...message.buttons.map(fromLegacyButton))
	if (Array.isArray(message.templateButtons)) buttons.push(...message.templateButtons.map(fromTemplateButton))
	if (Array.isArray(message.sections) && message.sections.length) buttons.push(fromSections(message))
	return buttons
}

const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'documentMessage'] as const

/** upload `{ image | video | document }` found on `src` and return `{ imageMessage | ... }` or undefined */
const uploadHeaderMedia = async (src: AnyObj, ctx: BuildContext): Promise<AnyObj | undefined> => {
	const kind = (['image', 'video', 'document'] as const).find(k => !!src[k])
	if (!kind) return undefined
	if (!ctx.prepare) throw new Boom('media upload is not available in this context', { statusCode: 500 })
	const content: AnyObj = { [kind]: src[kind] }
	for (const k of ['mimetype', 'fileName', 'jpegThumbnail', 'gifPlayback']) if (src[k] !== undefined) content[k] = src[k]
	return (await ctx.prepare(content, ctx.options || {})) as AnyObj
}

const mediaHeader = (title: string, subtitle: string, media?: AnyObj) => {
	const header: AnyObj = { title: title ?? '', subtitle: subtitle ?? '', hasMediaAttachment: false }
	const key = media && MEDIA_KEYS.find(k => !!media[k])
	if (key) {
		const copy = { ...media![key] }
		// captions / reply context live outside of an interactive header
		delete copy.caption
		delete copy.contextInfo
		header[key] = copy
		header.hasMediaAttachment = true
	}

	return proto.Message.InteractiveMessage.Header.create(header)
}

const nativeFlow = (buttons: NativeButton[], messageParams?: unknown) =>
	proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons, messageParamsJson: paramsJson(messageParams) })

/**
 * Carousel: 2-10 cards, each `{ image | video, title?, body?, footer?, buttons: [...] }`.
 * Mirrors WhatsApp Business rules: every card needs the same number of buttons.
 */
const buildCarousel = async (message: AnyObj, ctx: BuildContext): Promise<proto.IMessage> => {
	const carousel = carouselOf(message)!
	const cards: AnyObj[] = carousel.cards || []
	if (cards.length < 2 || cards.length > 10) {
		throw new Boom(`carousel needs between 2 and 10 cards, got ${cards.length}`, { statusCode: 400 })
	}

	const nativeCards: proto.Message.IInteractiveMessage[] = []
	let buttonCount = -1
	for (const [i, card] of cards.entries()) {
		const buttons = toNativeButtons(card)
		if (buttonCount === -1) buttonCount = buttons.length
		else if (buttons.length !== buttonCount && message.carouselValidate !== false) {
			throw new Boom(`carousel card #${i} has ${buttons.length} buttons, card #0 has ${buttonCount}: all cards must match`, {
				statusCode: 400
			})
		}

		const media = await uploadHeaderMedia(card, ctx)
		nativeCards.push(
			proto.Message.InteractiveMessage.create({
				header: mediaHeader(card.title, card.subtitle, media),
				body: proto.Message.InteractiveMessage.Body.create({ text: card.body ?? card.text ?? card.caption ?? '' }),
				footer: card.footer ? proto.Message.InteractiveMessage.Footer.create({ text: card.footer }) : undefined,
				nativeFlowMessage: nativeFlow(buttons, card.messageParamsJson)
			})
		)
	}

	return {
		messageContextInfo: CONTEXT_INFO,
		interactiveMessage: proto.Message.InteractiveMessage.create({
			header: proto.Message.InteractiveMessage.Header.create({
				title: message.title ?? carousel.title ?? '',
				hasMediaAttachment: false
			}),
			body: proto.Message.InteractiveMessage.Body.create({ text: message.text ?? message.caption ?? carousel.text ?? '' }),
			footer: message.footer ? proto.Message.InteractiveMessage.Footer.create({ text: message.footer }) : undefined,
			carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
				cards: nativeCards,
				messageVersion: carousel.messageVersion ?? 1
			})
		})
	}
}

/**
 * Wraps the already generated base content `m` (text or media) into an interactiveMessage.
 * Media (image / video / document) becomes the header of the interactive message.
 * A `carousel` / `carouselMessage` / `cards` key produces a carousel instead.
 */
export const buildLegacyInteractive = async (
	message: AnyObj,
	m: proto.IMessage,
	ctx: BuildContext = {}
): Promise<proto.IMessage> => {
	if (carouselOf(message)) return buildCarousel(message, ctx)

	const mediaKey = ([...MEDIA_KEYS, 'locationMessage'] as const).find(k => !!(m as AnyObj)[k])
	const body = message.text ?? message.caption ?? message.description ?? ''

	return {
		messageContextInfo: CONTEXT_INFO,
		interactiveMessage: proto.Message.InteractiveMessage.create({
			header: mediaHeader(message.title, message.subtitle, mediaKey && mediaKey !== 'locationMessage' ? (m as AnyObj) : undefined),
			body: proto.Message.InteractiveMessage.Body.create({ text: body }),
			footer: message.footer ? proto.Message.InteractiveMessage.Footer.create({ text: message.footer }) : undefined,
			nativeFlowMessage: nativeFlow(toNativeButtons(message), message.messageParamsJson)
		})
	}
}

/**
 * Raw keys, in the shapes bot libraries document:
 *  - interactiveMessage: { header, body, footer, nativeFlowMessage | carouselMessage }  (proto-like)
 *  - interactiveMessage: { header: 'str', title, footer: 'str', image | video | document, buttons | nativeFlowMessage } (flat)
 *  - listMessage: { title, description, footerText, buttonText, sections }
 *  - buttonsMessage: { contentText, footerText, buttons, headerType }
 */
export const buildRawInteractive = async (message: AnyObj, ctx: BuildContext = {}): Promise<proto.IMessage> => {
	if (message.listMessage) {
		const l = message.listMessage
		return buildLegacyInteractive(
			{ text: l.description ?? l.text ?? '', title: l.title, footer: l.footerText ?? l.footer, buttonText: l.buttonText, sections: l.sections },
			{},
			ctx
		)
	}

	if (message.buttonsMessage) {
		const b = message.buttonsMessage
		return buildLegacyInteractive({ text: b.contentText ?? b.text ?? '', footer: b.footerText ?? b.footer, buttons: b.buttons }, {}, ctx)
	}

	const im: AnyObj = message.interactiveMessage
	const protoLike = im.nativeFlowMessage || im.carouselMessage || (im.body && typeof im.body === 'object')
	const text = (v: any) => (typeof v === 'string' ? v : v?.text ?? '')

	// header: 'string' | { title, subtitle, hasMediaAttachment, imageMessage: { url } } | flat media keys
	let media: AnyObj | undefined = await uploadHeaderMedia(im.header && typeof im.header === 'object' ? im.header : im, ctx)
	let headerTitle = typeof im.header === 'string' ? im.header : im.header?.title ?? (protoLike ? '' : im.title ?? '')
	let headerSubtitle = im.header?.subtitle ?? im.subtitle ?? ''
	if (!media && im.header && typeof im.header === 'object') {
		const k = MEDIA_KEYS.find(x => !!im.header[x])
		if (k) {
			const hm = im.header[k]
			// { url } only (no mediaKey yet): upload it; an already uploaded media object is kept as-is
			if (hm.url && !hm.mediaKey && ctx.prepare) {
				const kind = k.replace('Message', '')
				media = (await ctx.prepare({ [kind]: { url: hm.url }, mimetype: hm.mimetype, fileName: hm.fileName }, ctx.options || {})) as AnyObj
			} else {
				media = { [k]: hm }
			}
		}
	}

	const buttons = protoLike
		? (im.nativeFlowMessage?.buttons || []).map(fromLegacyButton)
		: toNativeButtons(im)

	const result = proto.Message.InteractiveMessage.create({
		header: mediaHeader(headerTitle, headerSubtitle, media),
		body: proto.Message.InteractiveMessage.Body.create({ text: protoLike ? text(im.body) : im.body ? text(im.body) : im.title ?? im.text ?? '' }),
		footer: im.footer ? proto.Message.InteractiveMessage.Footer.create({ text: text(im.footer) }) : undefined,
		contextInfo: (() => {
			if (!im.contextInfo && !im.externalAdReply) return undefined
			return { ...(im.contextInfo || {}), ...(im.externalAdReply ? { externalAdReply: im.externalAdReply } : {}) }
		})()
	})

	if (im.carouselMessage) {
		const built = await buildCarousel({ ...im, carouselMessage: im.carouselMessage, text: text(im.body) }, ctx)
		result.carouselMessage = built.interactiveMessage!.carouselMessage
	} else {
		result.nativeFlowMessage = nativeFlow(buttons, im.nativeFlowMessage?.messageParamsJson ?? im.messageParamsJson)
	}

	return { messageContextInfo: CONTEXT_INFO, interactiveMessage: result }
}

/** find a (possibly wrapped) message field, e.g. inside viewOnceMessage / ephemeralMessage */
const findInner = (msg: AnyObj | null | undefined, key: string, depth = 0): any => {
	if (!msg || depth > 4) return undefined
	if (msg[key]) return msg[key]
	for (const wrap of [
		'viewOnceMessage',
		'viewOnceMessageV2',
		'viewOnceMessageV2Extension',
		'ephemeralMessage',
		'documentWithCaptionMessage',
		'botInvokeMessage',
		'editedMessage'
	]) {
		const found = findInner(msg[wrap]?.message, key, depth + 1)
		if (found) return found
	}

	return undefined
}

/** nativeFlow first-button names that WhatsApp expects as `<biz native_flow_name="...">` (payment / order flows) */
const ORDER_FLOW_NAMES: Record<string, string> = {
	review_and_pay: 'order_details',
	review_order: 'order_status',
	payment_info: 'payment_info',
	payment_status: 'payment_status',
	payment_method: 'payment_method'
}

/** nativeFlow first-button names that get their own native_flow name instead of `mixed` */
const SPECIAL_FLOW_NAMES = new Set([
	'cta_catalog',
	'mpm',
	'send_location',
	'call_permission_request',
	'wa_payment_transaction_details',
	'automated_greeting_message_view_catalog'
])

/**
 * Extra stanza nodes WhatsApp needs so interactive / list messages are rendered.
 * Returns [] when the message needs nothing, or when the caller already supplied a `biz` node.
 * `is1on1` adds the `<bot biz_bot="1"/>` node that private chats need.
 */
export const getInteractiveBizNodes = (
	message: proto.IMessage,
	is1on1: boolean,
	existing: BinaryNode[] = []
): BinaryNode[] => {
	if (existing.some(n => n.tag === 'biz')) return []

	const nodes: BinaryNode[] = []
	const interactive = findInner(message, 'interactiveMessage')
	const list = findInner(message, 'listMessage')
	const buttons = findInner(message, 'buttonsMessage')
	const bizAttrs = () => ({
		actual_actors: '2',
		host_storage: '2',
		privacy_mode_ts: Math.floor(Date.now() / 1000).toString()
	})

	if (interactive?.nativeFlowMessage || interactive?.carouselMessage) {
		const first: string | undefined = interactive.nativeFlowMessage?.buttons?.[0]?.name
		if (first && ORDER_FLOW_NAMES[first]) {
			nodes.push({ tag: 'biz', attrs: { native_flow_name: ORDER_FLOW_NAMES[first]! }, content: [] })
		} else {
			nodes.push({
				tag: 'biz',
				attrs: bizAttrs(),
				content: [
					{
						tag: 'interactive',
						attrs: { type: 'native_flow', v: '1' },
						content: [
							{ tag: 'native_flow', attrs: { v: '9', name: first && SPECIAL_FLOW_NAMES.has(first) ? first : 'mixed' } }
						]
					}
				]
			})
		}
	} else if (list) {
		nodes.push({ tag: 'biz', attrs: bizAttrs(), content: [{ tag: 'list', attrs: { v: '2', type: 'product_list' } }] })
	} else if (buttons) {
		nodes.push({ tag: 'biz', attrs: bizAttrs(), content: [] })
	}

	if (nodes.length && is1on1 && !existing.some(n => n.tag === 'bot')) {
		nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } })
	}

	return nodes
}
