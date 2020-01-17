import { Homebridge } from '../../types/homebridge'

/**
 * Wraps a callback and ensures it’s only called once.
 * Subsequent invocations are discarded.
 */
export default function exactlyOnce<ParamType, ReturnType>(
	callback: (param: ParamType, ...args: any) => ReturnType | undefined,
	log?: Homebridge.Logger,
): (param: ParamType) => ReturnType | undefined {
	let hasFired = false
	return function(param: ParamType, ...args: any): ReturnType | undefined {
		if (hasFired) {
			if (log) {
				log.warn('Attempted to call more than once', new Error().stack)
			}
			return undefined
		} else {
			hasFired = true
		}

		return callback(param, ...args)
	}
}
