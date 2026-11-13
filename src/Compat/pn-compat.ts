/**
 * Liam compat: WhatsApp moved to LID addressing (`123@lid`) and Baileys 7 surfaces those ids.
 * Almost every existing bot script still compares plain phone-number jids (`628xx@s.whatsapp.net`)
 * for owner / admin / premium checks, so Liam hands scripts phone-number jids by default.
 * The LID is never lost: it stays on `key.participantLid`, `key.remoteJidLid` and `participant.lid`.
 *
 * Turn it off with `makeWASocket({ pnCompat: false })` if you want raw Baileys 7 behaviour.
 */
type AnyObj = Record<string, any>

const isLid = (jid?: string | null): jid is string => !!jid && jid.endsWith('@lid')
const isPn = (jid?: string | null): jid is string => !!jid && jid.endsWith('@s.whatsapp.net')

export const pnizeKey = (key?: AnyObj | null) => {
	if (!key) return key
	if (isLid(key.participant) && isPn(key.participantAlt)) {
		key.participantLid = key.participant
		key.participant = key.participantAlt
	}

	if (isLid(key.remoteJid) && isPn(key.remoteJidAlt)) {
		key.remoteJidLid = key.remoteJid
		key.remoteJid = key.remoteJidAlt
	}

	return key
}

export const pnizeMessages = (messages?: AnyObj[]) => {
	for (const m of messages || []) pnizeKey(m?.key)
}

const pnizeParticipant = (p: any) => {
	if (p && typeof p === 'object' && isLid(p.id) && isPn(p.phoneNumber)) {
		return { ...p, lid: p.id, id: p.phoneNumber }
	}

	return p
}

export const pnizeGroup = <T extends AnyObj | undefined | null>(meta: T): T => {
	if (!meta || typeof meta !== 'object') return meta
	const g: AnyObj = meta
	if (Array.isArray(g.participants)) g.participants = g.participants.map(pnizeParticipant)
	if (isLid(g.owner) && isPn(g.ownerPn)) {
		g.ownerLid = g.owner
		g.owner = g.ownerPn
	}

	if (isLid(g.subjectOwner) && isPn(g.subjectOwnerPn)) g.subjectOwner = g.subjectOwnerPn
	if (isLid(g.descOwner) && isPn(g.descOwnerPn)) g.descOwner = g.descOwnerPn
	return meta
}

/** Applies the conversion to the payload of one event, in place. */
export const pnizeEvent = (event: string, data: any) => {
	switch (event) {
		case 'messages.upsert':
			pnizeMessages(data?.messages)
			break
		case 'messages.update':
			for (const u of data || []) pnizeKey(u?.key)
			break
		case 'messages.reaction':
			for (const r of data || []) {
				pnizeKey(r?.key)
				pnizeKey(r?.reaction?.key)
			}

			break
		case 'groups.upsert':
			for (const g of data || []) pnizeGroup(g)
			break
		case 'groups.update':
			for (const g of data || []) pnizeGroup(g)
			break
		case 'group-participants.update':
			if (data && Array.isArray(data.participants)) data.participants = data.participants.map(pnizeParticipant)
			if (data && isLid(data.author) && isPn(data.authorPn)) data.author = data.authorPn
			break
		default:
			break
	}

	return data
}

const EVENTS = [
	'messages.upsert',
	'messages.update',
	'messages.reaction',
	'groups.upsert',
	'groups.update',
	'group-participants.update'
]

export const applyPnCompat = <S extends object>(socket: S): S => {
	const sock = socket as AnyObj
	const ev = sock.ev as AnyObj
	const origOn = ev.on.bind(ev)
	const origOff = ev.off.bind(ev)
	const origProcess = ev.process.bind(ev)
	const wrapped = new WeakMap<Function, Function>()

	ev.on = (event: string, listener: (...a: any[]) => any) => {
		if (!EVENTS.includes(event)) return origOn(event, listener)
		const w = (data: any, ...rest: any[]) => listener(pnizeEvent(event, data), ...rest)
		wrapped.set(listener, w)
		return origOn(event, w)
	}

	ev.off = (event: string, listener: (...a: any[]) => any) => origOff(event, wrapped.get(listener) || listener)
	ev.removeListener = ev.off

	ev.process = (handler: (events: AnyObj) => any) =>
		origProcess((events: AnyObj) => {
			for (const name of EVENTS) if (events[name]) pnizeEvent(name, events[name])
			return handler(events)
		})

	const origGroupMetadata = sock.groupMetadata?.bind(sock)
	if (origGroupMetadata) sock.groupMetadata = async (jid: string) => pnizeGroup(await origGroupMetadata(jid))

	const origFetchAll = sock.groupFetchAllParticipating?.bind(sock)
	if (origFetchAll) {
		sock.groupFetchAllParticipating = async () => {
			const all = await origFetchAll()
			for (const id of Object.keys(all)) pnizeGroup(all[id])
			return all
		}
	}

	return socket
}
