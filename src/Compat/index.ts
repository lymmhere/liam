import { proto } from '../../WAProto/index.js'

export { makeInMemoryStore } from './make-in-memory-store'
export { useSingleFileAuthState } from './use-single-file-auth-state'
export {
	hasLegacyInteractive,
	hasRawInteractive,
	buildLegacyInteractive,
	buildRawInteractive,
	getInteractiveBizNodes
} from './legacy-content'

/** `InteractiveMessage` was exported by several old forks; scripts destructure it from the package. */
export const InteractiveMessage = proto.Message.InteractiveMessage
export { applyPnCompat } from './pn-compat'
export { applyAlbum } from './album'
