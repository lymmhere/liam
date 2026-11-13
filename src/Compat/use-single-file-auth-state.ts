import { readFileSync, writeFileSync, existsSync } from 'fs'
import { proto } from '../../WAProto/index.js'
import type { AuthenticationCreds, SignalDataTypeMap } from '../Types'
import { initAuthCreds } from '../Utils/auth-utils'
import { BufferJSON } from '../Utils/generics'

/**
 * Legacy single-file auth state (removed upstream). Kept so older scripts keep working.
 * Prefer useMultiFileAuthState for anything serious: this rewrites the whole file on every change.
 */
export const useSingleFileAuthState = (filename: string) => {
	let creds: AuthenticationCreds = initAuthCreds()
	let keys: Record<string, Record<string, any>> = {}

	if (existsSync(filename)) {
		try {
			const result = JSON.parse(readFileSync(filename, { encoding: 'utf-8' }), BufferJSON.reviver)
			creds = result.creds
			keys = result.keys || {}
		} catch {
			// corrupted file: start fresh
		}
	}

	const saveState = () => {
		writeFileSync(filename, JSON.stringify({ creds, keys }, BufferJSON.replacer, 2))
	}

	return {
		state: {
			creds,
			keys: {
				get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
					const key = keys[type] || {}
					return ids.reduce(
						(dict, id) => {
							let value = key[id]
							if (value) {
								if (type === 'app-state-sync-key') value = proto.Message.AppStateSyncKeyData.fromObject(value)
								dict[id] = value
							}

							return dict
						},
						{} as { [_: string]: SignalDataTypeMap[T] }
					)
				},
				set: async (data: any) => {
					for (const type in data) {
						keys[type] = keys[type] || {}
						Object.assign(keys[type]!, data[type])
					}

					saveState()
				}
			}
		},
		saveState
	}
}
