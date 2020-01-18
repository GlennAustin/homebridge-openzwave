import { BoundValueStream } from '../Streams/BoundValueStream'
import { first, filter } from 'rxjs/operators'
import { Homebridge } from '../../types/homebridge'
import { IValueTransformer } from './Transformers/IValueTransformer'
import { Subscription } from 'rxjs'
import { ValueType } from './ValueType'
import exactlyOnce from '../Support/exactlyOnce'
import noopValueTransformer from './Transformers/noopValueTransformer'

export type CoordinateValuesParams = {
	log: Homebridge.Logger
	characteristic: HAPNodeJS.Characteristic
	valueStream: BoundValueStream
	readonly?: boolean
	transformer?: IValueTransformer
}

type HomeKitCallback = (error?: Error, ...args: any) => void

// Coordinates value streams from both Zwave and HomeKit for a single Characteristic
export default class ValueCoordinator {
	readonly log: Homebridge.Logger
	readonly characteristic: HAPNodeJS.Characteristic
	readonly valueStream: BoundValueStream
	readonly transformer: IValueTransformer
	readonly readonly: boolean
	private valueUpdateObserver?: Subscription

	constructor({
		log,
		characteristic,
		valueStream,
		readonly,
		transformer,
	}: CoordinateValuesParams) {
		this.log = log
		this.characteristic = characteristic
		this.valueStream = valueStream
		this.readonly = readonly ?? false
		this.transformer = transformer ?? noopValueTransformer()

		if (!this.transformer.homekitToZwave && !this.readonly) {
			throw new Error('homekitToZwave is required for readwrite values')
		}
	}

	start() {
		let valueUpdate = this.valueStream.valueObservable

		if (this.transformer.isZwaveValid) {
			valueUpdate = valueUpdate.pipe(filter(value => this.transformer.isZwaveValid!(value)))
		}

		// Subscribe to all value updates and forward them to HomeKit
		let hadInitialValue = false
		this.valueUpdateObserver = valueUpdate.subscribe(value => {
			this.sendZwaveValueToHomeKit(value)
			hadInitialValue = true
		})

		// If we didn’t immediately load a value, refresh
		if (!hadInitialValue) {
			this.valueStream.refresh()
		}

		// Handle explicit HomeKit value setting
		if (this.readonly !== true) {
			this.characteristic.on('set', (newValue: ValueType, callback: HomeKitCallback) => {
				this.sendHomeKitValueToZwave(newValue, exactlyOnce(callback, this.log))
			})
		}

		// Handle explicit HomeKit value requests
		this.characteristic.on('get', (callback: HomeKitCallback) => {
			// valueUpdate is a ReplaySubject, so we can respond
			// with the last cached value instantly
			valueUpdate
				.pipe(first())
				.subscribe(value => {
					this.sendZwaveValueToHomeKit(value, exactlyOnce(callback, this.log))
				})
				.unsubscribe()

			// However, we still want to grab the fresh value from
			// the device, so we’ll request a refresh and that will
			// be sent to HomeKit once it’s resolved
			this.refreshZwaveValue()
		})
	}

	stop() {
		this.valueUpdateObserver?.unsubscribe()
		this.valueUpdateObserver = undefined
	}

	private sendZwaveValueToHomeKit(value: ValueType, callback?: HomeKitCallback) {
		const homekitValue = this.transformer.zwaveToHomeKit(value)
		this.log.debug('sendZwaveValueToHomeKit', homekitValue)

		if (callback) {
			callback(undefined, homekitValue)
		} else {
			this.characteristic.updateValue(homekitValue)
		}
	}

	private sendHomeKitValueToZwave(homekitValue: ValueType, callback: (error?: Error) => void) {
		if (this.readonly === true) {
			return
		}

		if (this.transformer.isHomekitValid && !this.transformer.isHomekitValid!(homekitValue)) {
			return
		}

		// NOTE: Constructor ensures homekitToZwave is available
		const zwaveValue = this.transformer.homekitToZwave!(homekitValue)
		this.log.debug('sendHomeKitValueToZwave', zwaveValue)

		this.valueStream
			.set(zwaveValue)
			.then(() => callback())
			.catch(callback)
			.finally(() => {
				setTimeout(this.refreshZwaveValue.bind(this), 5000)
			})
	}

	private refreshZwaveValue() {
		this.valueStream.refresh()
	}
}
