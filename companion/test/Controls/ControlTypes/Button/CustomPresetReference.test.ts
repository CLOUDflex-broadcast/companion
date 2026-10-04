import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomPresetReferenceButtonModel } from '@companion-app/shared/Model/ButtonModel.js'
import { EntityModelType } from '@companion-app/shared/Model/EntityModel.js'
import type { ControlDependencies } from '../../../../lib/Controls/ControlDependencies.js'
import { ControlButtonCustomPresetReference } from '../../../../lib/Controls/ControlTypes/Button/CustomPresetReference.js'

function makeUserValue(variableName: string, value: any) {
	return {
		id: `lv-${variableName}`,
		type: EntityModelType.Feedback,
		definitionId: 'user_value',
		connectionId: 'internal',
		variableName,
		options: {
			persist_value: { isExpression: false, value: false },
			startup_value: { isExpression: false, value },
		},
	} as any
}

function makeModel(overrides: Partial<CustomPresetReferenceButtonModel> = {}): CustomPresetReferenceButtonModel {
	return {
		type: 'custom-preset-reference',
		options: { rotaryActions: false, stepProgression: 'auto', canModifyStyleInApis: false },
		style: { layers: [] },
		feedbacks: [],
		steps: {
			'0': {
				options: { runWhileHeld: [] },
				action_sets: { down: [], up: [], rotate_left: undefined, rotate_right: undefined },
			},
		},
		localVariables: [makeUserValue('channel', 1)],
		customPresetRef: { presetId: 'cp1', variableValues: {} },
		...overrides,
	}
}

describe('ControlButtonCustomPresetReference', () => {
	let definitions: EventEmitter
	let customPresets: EventEmitter & { resolveReferenceModel: ReturnType<typeof vi.fn> }
	let deps: ControlDependencies

	beforeEach(() => {
		definitions = Object.assign(new EventEmitter(), {
			getEntityDefinition: vi.fn(() => undefined),
		})
		customPresets = Object.assign(new EventEmitter(), {
			resolveReferenceModel: vi.fn(),
		})

		const graphics = Object.assign(new EventEmitter(), {
			renderPixelBuffers: vi.fn(),
			getCachedRender: vi.fn(() => undefined),
		})

		deps = {
			surfaces: {} as any,
			pageStore: { getLocationOfControlId: vi.fn(() => null) } as any,
			getPageVariableEntities: () => null,
			triggerEvents: null as any,
			expressionVariableNamesMap: null as any,
			internalModule: {
				entityUpgrade: vi.fn(() => undefined),
				entityUpdate: vi.fn(),
				entityDelete: vi.fn(),
				evaluateFeedbackValue: vi.fn(() => undefined),
				visitReferences: vi.fn(),
			} as any,
			instance: {
				definitions,
				processManager: {
					connectionEntityUpdate: vi.fn(async () => undefined),
					connectionEntityDelete: vi.fn(async () => undefined),
					connectionEntityLearnOptions: vi.fn(async () => undefined),
				} as any,
				getInstanceStatus: vi.fn(() => undefined),
			} as any,
			variableValues: {
				createVariablesAndExpressionParser: vi.fn(() => ({ executeExpression: vi.fn() })),
			} as any,
			userconfig: {} as any,
			graphics: graphics as any,
			actionRunner: {} as any,
			dbTable: { set: vi.fn(), delete: vi.fn() } as any,
			events: new EventEmitter() as any,
			changeEvents: new EventEmitter() as any,
			renderClock: { subscribe: vi.fn(() => () => {}) } as any,
			customPresets: customPresets as any,
			controlsAccessor: {
				getControl: vi.fn(() => undefined),
				pressControl: vi.fn(() => false),
				rotateControl: vi.fn(() => false),
			},
		}
	})

	function createControl(model = makeModel()) {
		return new ControlButtonCustomPresetReference(deps, 'bank:test01', model, false)
	}

	it('exposes the reference metadata from storage', () => {
		const control = createControl()
		expect(control.type).toBe('custom-preset-reference')
		expect(control.presetId).toBe('cp1')
		expect(control.supportsConvert).toBe(true)
		expect(control.supportsLayeredStyle).toBe(false)
	})

	it('subscribes to custom preset changes, and unsubscribes on destroy', () => {
		const control = createControl()
		expect(customPresets.listenerCount('presetChanged')).toBe(1)

		control.destroy()
		expect(customPresets.listenerCount('presetChanged')).toBe(0)
	})

	it('is read-only, except for its notes', () => {
		const control = createControl()
		expect(control.optionsSetField('notes', 'my note')).toBe(true)
		expect(control.optionsSetField('rotaryActions', true)).toBe(false)
		expect(control.toJSON().options.notes).toBe('my note')
	})

	describe('preset changes', () => {
		it('refreshes from the preset, re-applying the overrides', () => {
			customPresets.resolveReferenceModel.mockReturnValue(
				makeModel({ style: { layers: [{ id: 'canvas', type: 'canvas' } as any] }, checksum: 'v2' })
			)
			const control = createControl(makeModel({ customPresetRef: { presetId: 'cp1', variableValues: { channel: 4 } } }))

			customPresets.emit('presetChanged', 'cp1')

			expect(customPresets.resolveReferenceModel).toHaveBeenCalledWith('cp1', { channel: 4 })
			expect(control.toJSON().style.layers).toHaveLength(1)
			expect(control.toJSON().checksum).toBe('v2')
		})

		it('ignores changes to other presets', () => {
			createControl()
			customPresets.emit('presetChanged', 'cp2')
			expect(customPresets.resolveReferenceModel).not.toHaveBeenCalled()
		})

		it('ignores a change that does not alter the resolved data', () => {
			customPresets.resolveReferenceModel.mockReturnValue(makeModel({ checksum: 'same' }))
			const control = createControl(makeModel({ checksum: 'same', feedbacks: [] }))
			const commitSpy = vi.spyOn(control, 'commitChange')

			customPresets.emit('presetChanged', 'cp1')

			expect(commitSpy).not.toHaveBeenCalled()
		})

		it('keeps the last-known data when the preset is gone', () => {
			customPresets.resolveReferenceModel.mockReturnValue(null)
			const control = createControl()

			customPresets.emit('presetChanged', 'cp1')

			expect(control.toJSON().localVariables).toHaveLength(1)
		})

		it('preserves the user notes', () => {
			customPresets.resolveReferenceModel.mockReturnValue(makeModel({ checksum: 'v2' }))
			const control = createControl()
			control.optionsSetField('notes', 'keep me')

			customPresets.emit('presetChanged', 'cp1')

			expect(control.toJSON().options.notes).toBe('keep me')
		})
	})

	describe('setVariableValue', () => {
		it('overrides a user value local variable', () => {
			customPresets.resolveReferenceModel.mockReturnValue(
				makeModel({
					localVariables: [makeUserValue('channel', 9)],
					customPresetRef: { presetId: 'cp1', variableValues: { channel: 9 } },
				})
			)
			const control = createControl()

			expect(control.setVariableValue('channel', 9)).toBe(true)
			expect(customPresets.resolveReferenceModel).toHaveBeenCalledWith('cp1', { channel: 9 })
			expect(control.toJSON().customPresetRef.variableValues).toEqual({ channel: 9 })
		})

		it('resets an override when given undefined', () => {
			customPresets.resolveReferenceModel.mockReturnValue(makeModel())
			const control = createControl(makeModel({ customPresetRef: { presetId: 'cp1', variableValues: { channel: 4 } } }))

			expect(control.setVariableValue('channel', undefined)).toBe(true)
			expect(customPresets.resolveReferenceModel).toHaveBeenCalledWith('cp1', {})
			expect(control.toJSON().customPresetRef.variableValues).toEqual({})
		})

		it('rejects variables which are not user value local variables of the preset', () => {
			const control = createControl()

			expect(control.setVariableValue('unknown', 1)).toBe(false)
			expect(customPresets.resolveReferenceModel).not.toHaveBeenCalled()
		})

		it('keeps the override when the preset is gone', () => {
			customPresets.resolveReferenceModel.mockReturnValue(null)
			const control = createControl()

			expect(control.setVariableValue('channel', 3)).toBe(true)
			expect(control.toJSON().customPresetRef.variableValues).toEqual({ channel: 3 })
		})
	})

	it('converts to a plain layered button', () => {
		const control = createControl()
		const converted = control.convertControl()

		expect(converted.type).toBe('button-layered')
		expect('customPresetRef' in converted).toBe(false)
		expect(converted.localVariables).toHaveLength(1)
	})
})
