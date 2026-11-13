import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { proto } from '../../WAProto/index.js'
import type { BaileysEventEmitter, Chat, Contact, GroupMetadata, WAMessage } from '../Types'
import { BufferJSON } from '../Utils/generics'
import { jidNormalizedUser } from '../WABinary'

type Opts = { logger?: any; maxMessagesPerChat?: number }

/**
 * Lightweight replacement for the `makeInMemoryStore` that upstream removed.
 * Covers what bot scripts use: bind(), contacts, chats, messages, loadMessage(),
 * fetchGroupMetadata(), presences and JSON persistence.
 */
export const makeInMemoryStore = ({ logger, maxMessagesPerChat = 300 }: Opts = {}) => {
	const contacts: Record<string, Contact> = {}
	const chats: Record<string, Chat> = {}
	const messages: Record<string, WAMessage[]> = {}
	const groupMetadata: Record<string, GroupMetadata> = {}
	const presences: Record<string, Record<string, any>> = {}
	const state: { connection: string; lastDisconnect?: any } = { connection: 'close' }

	const pushMessage = (msg: WAMessage) => {
		const jid = msg.key?.remoteJid
		if (!jid || !msg.key.id) return
		const list = (messages[jid] ||= [])
		const idx = list.findIndex(x => x.key.id === msg.key.id)
		if (idx >= 0) list[idx] = msg
		else list.push(msg)
		if (list.length > maxMessagesPerChat) list.splice(0, list.length - maxMessagesPerChat)
	}

	const bind = (ev: BaileysEventEmitter) => {
		ev.on('connection.update', update => Object.assign(state, update))

		ev.on('messaging-history.set', ({ chats: c, contacts: ct, messages: ms }) => {
			for (const x of c || []) chats[x.id!] = { ...chats[x.id!], ...x } as Chat
			for (const x of ct || []) contacts[x.id] = { ...contacts[x.id], ...x }
			for (const m of ms || []) pushMessage(m)
		})

		ev.on('contacts.upsert', list => {
			for (const c of list) contacts[c.id] = { ...contacts[c.id], ...c }
		})
		ev.on('contacts.update', list => {
			for (const c of list) {
				if (!c.id) continue
				contacts[c.id] = { ...contacts[c.id], ...c } as Contact
			}
		})

		ev.on('chats.upsert', list => {
			for (const c of list) chats[c.id!] = { ...chats[c.id!], ...c } as Chat
		})
		ev.on('chats.update', list => {
			for (const c of list) {
				if (!c.id) continue
				chats[c.id] = { ...chats[c.id], ...c } as Chat
			}
		})
		ev.on('chats.delete', ids => {
			for (const id of ids) {
				delete chats[id]
				delete messages[id]
			}
		})

		ev.on('messages.upsert', ({ messages: ms }) => {
			for (const m of ms) {
				pushMessage(m)
				const jid = m.key.remoteJid
				if (jid && jid !== 'status@broadcast' && !chats[jid]) {
					chats[jid] = { id: jid, conversationTimestamp: Number(m.messageTimestamp) || 0, unreadCount: 0 } as Chat
				}
			}
		})
		ev.on('messages.update', updates => {
			for (const { key, update } of updates) {
				const msg = messages[key.remoteJid!]?.find(x => x.key.id === key.id)
				if (msg) Object.assign(msg, update)
			}
		})
		ev.on('messages.delete', item => {
			if ('all' in item) {
				messages[item.jid] = []
			} else {
				for (const k of item.keys) {
					const list = messages[k.remoteJid!]
					if (list) messages[k.remoteJid!] = list.filter(x => x.key.id !== k.id)
				}
			}
		})

		ev.on('groups.upsert', list => {
			for (const g of list) groupMetadata[g.id] = g
		})
		ev.on('groups.update', list => {
			for (const g of list) {
				if (g.id) groupMetadata[g.id] = { ...groupMetadata[g.id], ...g } as GroupMetadata
			}
		})
		ev.on('group-participants.update', ({ id, participants, action }) => {
			const meta = groupMetadata[id]
			if (!meta) return
			const ids = participants.map((p: any) => (typeof p === 'string' ? p : p.id))
			if (action === 'add') {
				for (const p of ids) if (!meta.participants.some(x => x.id === p)) meta.participants.push({ id: p } as any)
			} else if (action === 'remove') {
				meta.participants = meta.participants.filter(x => !ids.includes(x.id))
			} else if (action === 'promote' || action === 'demote') {
				for (const p of meta.participants) if (ids.includes(p.id)) p.admin = action === 'promote' ? 'admin' : null
			}
		})

		ev.on('presence.update', ({ id, presences: update }) => {
			presences[id] = { ...presences[id], ...update }
		})
	}

	return {
		bind,
		contacts,
		chats,
		messages,
		groupMetadata,
		presences,
		state,
		logger,
		loadMessage: async (jid: string, id: string, _sock?: any): Promise<WAMessage | undefined> =>
			messages[jid]?.find(m => m.key.id === id),
		loadMessages: async (jid: string, count: number) => (messages[jid] || []).slice(-count),
		fetchGroupMetadata: async (jid: string, sock?: { groupMetadata: (j: string) => Promise<GroupMetadata> }) => {
			if (!groupMetadata[jid] && sock) groupMetadata[jid] = await sock.groupMetadata(jid)
			return groupMetadata[jid]
		},
		fetchMessageReceipts: async ({ remoteJid, id }: proto.IMessageKey) =>
			messages[remoteJid!]?.find(m => m.key.id === id)?.userReceipt,
		getContact: (jid: string) => contacts[jidNormalizedUser(jid)],
		toJSON: () => ({ chats, contacts, messages }),
		fromJSON: (json: any) => {
			Object.assign(chats, json?.chats || {})
			Object.assign(contacts, json?.contacts || {})
			Object.assign(messages, json?.messages || {})
		},
		writeToFile: (path: string) => {
			writeFileSync(path, JSON.stringify({ chats, contacts, messages }, BufferJSON.replacer))
		},
		readFromFile: (path: string) => {
			if (!existsSync(path)) return
			try {
				const json = JSON.parse(readFileSync(path, { encoding: 'utf-8' }), BufferJSON.reviver)
				Object.assign(chats, json?.chats || {})
				Object.assign(contacts, json?.contacts || {})
				Object.assign(messages, json?.messages || {})
			} catch (err) {
				logger?.warn?.({ err }, 'failed to read store file')
			}
		}
	}
}
