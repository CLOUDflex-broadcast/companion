import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateCustomPresetControlId } from '@companion-app/shared/ControlId.js'
import type { LayeredButtonModel } from '@companion-app/shared/Model/ButtonModel.js'
import { EntityModelType } from '@companion-app/shared/Model/EntityModel.js'
import type { ControlCommonEvents } from '../../lib/Controls/ControlDependencies.js'
import { CustomPresetLibrary, type CustomPresetLibraryControls } from '../../lib/Controls/CustomPresetLibrary.js'

function makeLayeredModel(overrides: Partial<LayeredButtonModel> = {}): LayeredButtonModel {
	return {
		type: 'button-layered',
		options: { rotaryActions: false, stepProgression: 'auto', canModifyStyleInApis: false },
		style: { layers: [] },
		feedbacks: [],
		steps: {},
		localVariables: [
			{
				id: 'lv1',
				type: EntityModelType.Feedback,
				definitionId: 'user_value',
				connectionId: 'internal',
				upgradeIndex: undefined,
				variableName: 'channel',
				options: {
					persist_value: { isExpression: false, value: false },
					startup_value: { isExpression: false, value: 1 },
				},
			},
			{
				id: 'lv2',
				type: EntityModelType.Feedback,
				definitionId: 'tally',
				connectionId: 'conn1',
				upgradeIndex: undefined,
				variableName: 'tally',
				options: {},
			},
		],
		...overrides,
	}
}

/** A stand-in for a template control: just enough of a control for the library */
function makeFakeControl(controlId: string, model: LayeredButtonModel) {
	return {
		controlId,
		type: model.type,
		updateEvents: new EventEmitter(),
		toJSON: vi.fn(() => structuredClone(model)),
	}
}

describe('CustomPresetLibrary', () => {
	let dbRows: Record<string, any>
	let dbTable: { all: () => Record<string, any>; set: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
	let controlEvents: EventEmitter<ControlCommonEvents>
	let controlsMap: Map<string, ReturnType<typeof makeFakeControl>>
	let controls: CustomPresetLibraryControls & {
		createTemplateControl: ReturnType<typeof vi.fn>
		deleteControl: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.useFakeTimers()

		dbRows = {}
		dbTable = {
			all: () => dbRows,
			set: vi.fn((id, value) => (dbRows[id] = value)),
			delete: vi.fn((id) => delete dbRows[id]),
		}
		controlEvents = new EventEmitter()
		controlsMap = new Map()
		controls = {
			getControl: (controlId) => controlsMap.get(controlId) as any,
			createTemplateControl: vi.fn((controlId, model) => {
				const control = makeFakeControl(controlId, model ?? makeLayeredModel())
				controlsMap.set(controlId, control)
				return control as any
			}),
			deleteControl: vi.fn((controlId) => controlsMap.delete(controlId)),
		}
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	function createLibrary() {
		const db = { getTableView: () => dbTable } as any
		return new CustomPresetLibrary(db, controlEvents, controls)
	}

	describe('createPreset', () => {
		it('stores the preset and creates its template control', () => {
			const library = createLibrary()
			const listener = vi.fn()
			library.on('listChanged', listener)

			const model = makeLayeredModel()
			const presetId = library.createPreset('  My preset ', model)

			expect(library.getList()).toEqual([{ id: presetId, name: 'My preset', sortOrder: 0 }])
			expect(dbTable.set).toHaveBeenCalledWith(presetId, { name: 'My preset', sortOrder: 0 })
			expect(controls.createTemplateControl).toHaveBeenCalledWith(CreateCustomPresetControlId(presetId), model)
			expect(listener).toHaveBeenCalledTimes(1)
		})

		it('appends new presets to the end of the list', () => {
			const library = createLibrary()
			const a = library.createPreset('b-first', null)
			const b = library.createPreset('a-second', null)

			expect(library.getList().map((p) => p.id)).toEqual([a, b])
		})

		it('falls back to a default name', () => {
			const library = createLibrary()
			library.createPreset('   ', null)

			expect(library.getList()[0].name).toBe('Custom preset')
		})
	})

	describe('init', () => {
		it('discards templates of unknown presets and creates missing templates', () => {
			dbRows = { known: { name: 'Known', sortOrder: 0 } }
			controlsMap.set('custom-preset:orphan', makeFakeControl('custom-preset:orphan', makeLayeredModel()))
			controlsMap.set('bank:other', makeFakeControl('bank:other', makeLayeredModel()))

			const library = createLibrary()
			library.init(controlsMap.keys())

			expect(controls.deleteControl).toHaveBeenCalledWith('custom-preset:orphan')
			expect(controls.deleteControl).not.toHaveBeenCalledWith('bank:other')
			expect(controls.createTemplateControl).toHaveBeenCalledWith('custom-preset:known', null)
		})

		it('reuses an existing template', () => {
			dbRows = { known: { name: 'Known', sortOrder: 0 } }
			controlsMap.set('custom-preset:known', makeFakeControl('custom-preset:known', makeLayeredModel()))

			const library = createLibrary()
			library.init(controlsMap.keys())

			expect(controls.createTemplateControl).not.toHaveBeenCalled()
			expect(controls.deleteControl).not.toHaveBeenCalled()
		})
	})

	describe('presetChanged', () => {
		it('is reported (debounced) when the template is edited', () => {
			const library = createLibrary()
			const presetId = library.createPreset('Preset', makeLayeredModel())
			const listener = vi.fn()
			library.on('presetChanged', listener)

			const template = controlsMap.get(CreateCustomPresetControlId(presetId))!
			template.updateEvents.emit('update', { type: 'config', patch: [] })
			template.updateEvents.emit('update', { type: 'config', patch: [] })
			expect(listener).not.toHaveBeenCalled()

			vi.runAllTimers()
			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(presetId)
		})

		it('is not reported for runtime changes', () => {
			const library = createLibrary()
			const presetId = library.createPreset('Preset', makeLayeredModel())
			const listener = vi.fn()
			library.on('presetChanged', listener)

			controlsMap
				.get(CreateCustomPresetControlId(presetId))!
				.updateEvents.emit('update', { type: 'runtime', patch: [] })
			vi.runAllTimers()

			expect(listener).not.toHaveBeenCalled()
		})

		it('is not reported once the preset is deleted', () => {
			const library = createLibrary()
			const presetId = library.createPreset('Preset', makeLayeredModel())
			const listener = vi.fn()
			library.on('presetChanged', listener)

			const template = controlsMap.get(CreateCustomPresetControlId(presetId))!
			template.updateEvents.emit('update', { type: 'config', patch: [] })
			library.deletePreset(presetId)
			vi.runAllTimers()

			expect(listener).not.toHaveBeenCalled()
			expect(template.updateEvents.listenerCount('update')).toBe(0)
		})
	})

	describe('resolveReferenceModel', () => {
		it('builds a linked model from the template', () => {
			const library = createLibrary()
			const presetId = library.createPreset('Preset', makeLayeredModel())

			const model = library.resolveReferenceModel(presetId, {})
			expect(model?.type).toBe('custom-preset-reference')
			expect(model?.customPresetRef).toEqual({ presetId, variableValues: {} })
			expect(model?.checksum).toEqual(expect.any(String))
		})

		it('applies only overrides of the user value local variables', () => {
			const library = createLibrary()
			const presetId = library.createPreset('Preset', makeLayeredModel())

			const model = library.resolveReferenceModel(presetId, { channel: 7, tally: true, unknown: 1 })
			expect(model?.customPresetRef.variableValues).toEqual({ channel: 7 })
			expect(model?.localVariables[0].options.startup_value).toEqual({ isExpression: false, value: 7 })
			expect(model?.localVariables[1].options).toEqual({})
		})

		it('keeps the checksum independent of the overrides', () => {
			const library = createLibrary()
			const presetId = library.createPreset('Preset', makeLayeredModel())

			expect(library.resolveReferenceModel(presetId, { channel: 2 })?.checksum).toBe(
				library.resolveReferenceModel(presetId, {})?.checksum
			)
		})

		it('returns null for an unknown preset', () => {
			const library = createLibrary()
			expect(library.resolveReferenceModel('nope', {})).toBeNull()
		})
	})

	describe('deletePreset', () => {
		it('removes the preset and its template', () => {
			const library = createLibrary()
			const presetId = library.createPreset('Preset', null)

			expect(library.deletePreset(presetId)).toBe(true)
			expect(library.getList()).toEqual([])
			expect(dbTable.delete).toHaveBeenCalledWith(presetId)
			expect(controls.deleteControl).toHaveBeenCalledWith(CreateCustomPresetControlId(presetId))
		})

		it('returns false for an unknown preset', () => {
			const library = createLibrary()
			expect(library.deletePreset('nope')).toBe(false)
		})
	})

	describe('renamePreset / movePreset', () => {
		it('renames a preset', () => {
			const library = createLibrary()
			const presetId = library.createPreset('Preset', null)

			expect(library.renamePreset(presetId, 'Renamed')).toBe(true)
			expect(library.getInfo(presetId)?.name).toBe('Renamed')
		})

		it('moves a preset to a new index', () => {
			const library = createLibrary()
			const a = library.createPreset('a', null)
			const b = library.createPreset('b', null)
			const c = library.createPreset('c', null)

			expect(library.movePreset(c, 0)).toBe(true)
			expect(library.getList().map((p) => p.id)).toEqual([c, a, b])
		})
	})

	describe('previews', () => {
		it('caches the render of a template and reports it', () => {
			const library = createLibrary()
			const presetId = library.createPreset('Preset', null)
			const listener = vi.fn()
			library.on('previewChanged', listener)

			const render = { cacheKey: 'x' } as any
			controlEvents.emit('presetDrawn', CreateCustomPresetControlId(presetId), render)
			controlEvents.emit('presetDrawn', 'preset:conn1:p1:default', { cacheKey: 'y' } as any)

			expect(library.getLastRender(presetId)).toBe(render)
			expect(listener).toHaveBeenCalledTimes(1)
			expect(listener).toHaveBeenCalledWith(presetId, render)
		})
	})
})
