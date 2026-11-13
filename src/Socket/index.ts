import { DEFAULT_CONNECTION_CONFIG } from '../Defaults'
import type { UserFacingSocketConfig } from '../Types'
import { applyAlbum } from '../Compat/album'
import { applyPnCompat } from '../Compat/pn-compat'
import { makeCommunitiesSocket } from './communities'

// export the last socket layer
const makeWASocket = (config: UserFacingSocketConfig) => {
	const newConfig = {
		...DEFAULT_CONNECTION_CONFIG,
		...config
	}

	const sock = applyAlbum(makeCommunitiesSocket(newConfig))
	// Liam: hand scripts phone-number jids instead of LIDs (opt out with pnCompat: false)
	return config.pnCompat === false ? sock : applyPnCompat(sock)
}

export default makeWASocket
