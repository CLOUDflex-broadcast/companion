import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { nanoid } from 'nanoid'
import { CreateCustomPresetControlId, ParseControlId } from '@companion-app/shared/ControlId.js'
import type { CustomPresetReferenceButtonModel, LayeredButtonModel } from '@companion-app/shared/Model/ButtonModel.js'
import type { UIControlUpdate } from '@companion-app/shared/Model/Controls.js'
import { filterCustomPresetVariableValues, type CustomPresetInfo } from '@companion-app/shared/Model/CustomPresets.js'
import type { VariableValues } from '@companion-app/shared/Model/Variables.js'
import { createStableObjectHash } from '@companion-app/shared/Util/Hash.js'
import type { DataDatabase } from '../Data/Database.js'
import type { DataStoreTableView } from '../Data/StoreBase.js'
import type { ImageResult } from '../Graphics/ImageResult.js'
import LogController from '../Log/Controller.js'
import { injectOverriddenLocalVariableValues } from '../Variables/Util.js'
import type { ControlCommonEvents } from './ControlDependencies.js'
import type { SomeControl } from './IControlFragments.js'

/** How long to wait after an edit of a custom preset before refreshing the buttons linked to it */
const PRESET_CHANGED_DEBOUNCE_MS = 200

type CustomPresetDbEntry = Omit<CustomPresetInfo, 'id'>

export type CustomPresetLibraryEvents = {
	/** The list of custom presets (or their names/order) changed */
	listChanged: [list: CustomPresetInfo[]]
	/** The button data of a custom preset changed, so anything linked to it should refresh */
	presetChanged: [presetId: string]
	/** The preview render of a custom preset changed */
	previewChanged: [presetId: string, render: ImageResult]
}

/**
 * The narrow view of the custom preset library that linked buttons need: resolve a preset into button data, and be
 * told when that data changes.
 */
export interface CustomPresetsSource {
	on(event: 'presetChanged', listener: (presetId: string) => void): unknown
	off(event: 'presetChanged', listener: (presetId: string) => void): unknown

	resolveReferenceModel(presetId: string, variableValues: VariableValues): CustomPresetReferenceButtonModel | null
}

/** How the library reaches the controls store, which owns the template button of each preset */
export interface CustomPresetLibraryControls {
	getControl(controlId: string): SomeControl<any> | undefined
	createTemplateControl(controlId: string, model: LayeredButtonModel | null): SomeControl<any> | null
	deleteControl(controlId: string): void
}

/**
 * The library of user-defined custom presets.
 *
 * Each custom preset is a name plus an off-grid `button-layered` 'template' control (with a `custom-preset:<id>`
 * control id), so it can be edited with the same editor as any other button. Buttons placed from a custom preset
 * either take a one-off copy of the template, or link to it (see `ControlButtonCustomPresetReference`), in which
 * case they are refreshed whenever the template is edited.
 */
export class CustomPresetLibrary extends EventEmitter<CustomPresetLibraryEvents> implements CustomPresetsSource {
	readonly #logger = LogController.createLogger('Controls/CustomPresetLibrary')

	readonly #dbTable: DataStoreTableView<Record<string, CustomPresetDbEntry>>
	readonly #controls: CustomPresetLibraryControls

	readonly #presets = new Map<string, CustomPresetDbEntry>()

	/** The update listener attached to each template control, so they can be detached again */
	readonly #templateListeners = new Map<string, { control: SomeControl<any>; listener: (c: UIControlUpdate) => void }>()
	readonly #pendingChanges = new Map<string, NodeJS.Timeout>()

	/** The last render of each preset's template, for previews */
	readonly #lastRenders = new Map<string, ImageResult>()

	constructor(
		db: DataDatabase,
		controlEvents: EventEmitter<ControlCommonEvents>,
		controls: CustomPresetLibraryControls
	) {
		super()
		this.setMaxListeners(0)

		this.#dbTable = db.getTableView('custom_presets')
		this.#controls = controls

		for (const [id, entry] of Object.entries(this.#dbTable.all())) {
			if (!entry) continue
			this.#presets.set(id, {
				name: typeof entry.name === 'string' ? entry.name : 'Custom preset',
				sortOrder: typeof entry.sortOrder === 'number' ? entry.sortOrder : 0,
			})
		}

		controlEvents.on('presetDrawn', (controlId, render) => {
			const parsed = ParseControlId(controlId)
			if (parsed?.type !== 'custom-preset' || !this.#presets.has(parsed.presetId)) return

			this.#lastRenders.set(parsed.presetId, render)
			this.emit('previewChanged', parsed.presetId, render)
		})
	}

	/**
	 * Reconcile the presets with their template controls. To be called once the controls have been loaded.
	 * @param allControlIds The ids of every loaded control
	 */
	init(allControlIds: Iterable<string>): void {
		// Discard any template whose preset no longer exists
		for (const controlId of Array.from(allControlIds)) {
			const parsed = ParseControlId(controlId)
			if (parsed?.type === 'custom-preset' && !this.#presets.has(parsed.presetId)) {
				this.#logger.info(`Discarding template of unknown custom preset "${parsed.presetId}"`)
				this.#controls.deleteControl(controlId)
			}
		}

		for (const presetId of this.#presets.keys()) {
			this.#ensureTemplateControl(presetId, null)
		}
	}

	/**
	 * Get all the custom presets, in display order
	 */
	getList(): CustomPresetInfo[] {
		return Array.from(this.#presets.entries())
			.map(([id, entry]) => ({ id, ...entry }))
			.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
	}

	getInfo(presetId: string): CustomPresetInfo | undefined {
		const entry = this.#presets.get(presetId)
		return entry ? { id: presetId, ...entry } : undefined
	}

	/**
	 * Get the cached preview render of a preset, if it has been drawn yet
	 */
	getLastRender(presetId: string): ImageResult | undefined {
		return this.#lastRenders.get(presetId)
	}

	/**
	 * Create a new custom preset
	 * @param name The name of the preset
	 * @param model The button data to start from, or null for a default button
	 * @returns The id of the new preset
	 */
	createPreset(name: string, model: LayeredButtonModel | null): string {
		const presetId = nanoid()

		const maxSortOrder = Math.max(-1, ...Array.from(this.#presets.values()).map((p) => p.sortOrder))
		const entry: CustomPresetDbEntry = { name: name.trim() || 'Custom preset', sortOrder: maxSortOrder + 1 }
		this.#presets.set(presetId, entry)
		this.#dbTable.set(presetId, entry)

		this.#ensureTemplateControl(presetId, model)

		this.#emitListChanged()

		return presetId
	}

	renamePreset(presetId: string, name: string): boolean {
		const entry = this.#presets.get(presetId)
		if (!entry) return false

		entry.name = name.trim() || entry.name
		this.#dbTable.set(presetId, entry)

		this.#emitListChanged()

		return true
	}

	/**
	 * Move a preset to be displayed at a new index in the list
	 */
	movePreset(presetId: string, newIndex: number): boolean {
		if (!this.#presets.has(presetId)) return false

		const ids = this.getList()
			.map((p) => p.id)
			.filter((id) => id !== presetId)
		ids.splice(Math.max(0, Math.min(newIndex, ids.length)), 0, presetId)

		ids.forEach((id, index) => {
			const entry = this.#presets.get(id)
			if (!entry || entry.sortOrder === index) return
			entry.sortOrder = index
			this.#dbTable.set(id, entry)
		})

		this.#emitListChanged()

		return true
	}

	/**
	 * Delete a custom preset. Buttons linked to it keep running with their last-known data.
	 */
	deletePreset(presetId: string): boolean {
		if (!this.#presets.has(presetId)) return false

		this.#presets.delete(presetId)
		this.#dbTable.delete(presetId)
		this.#lastRenders.delete(presetId)

		const pendingChange = this.#pendingChanges.get(presetId)
		if (pendingChange) clearTimeout(pendingChange)
		this.#pendingChanges.delete(presetId)

		const controlId = CreateCustomPresetControlId(presetId)
		this.#detachTemplateControl(controlId)
		this.#controls.deleteControl(controlId)

		this.#emitListChanged()

		return true
	}

	/**
	 * Get the button data of a preset, as a plain copy
	 */
	getPresetModel(presetId: string): LayeredButtonModel | null {
		if (!this.#presets.has(presetId)) return null

		const control = this.#controls.getControl(CreateCustomPresetControlId(presetId))
		if (control?.type !== 'button-layered') return null

		return (control as SomeControl<LayeredButtonModel>).toJSON(true)
	}

	/**
	 * Build the model for a button linked to a preset, with the given local variable overrides applied.
	 * Overrides of anything other than the preset's simple (user value) local variables are dropped.
	 */
	resolveReferenceModel(presetId: string, variableValues: VariableValues): CustomPresetReferenceButtonModel | null {
		const model = this.getPresetModel(presetId)
		if (!model) return null

		const checksum = createHash('sha1').update(createStableObjectHash(model)).digest('hex')

		const appliedValues = filterCustomPresetVariableValues(model.localVariables, variableValues)
		injectOverriddenLocalVariableValues(model.localVariables, appliedValues)

		return {
			type: 'custom-preset-reference',
			style: model.style,
			options: model.options,
			feedbacks: model.feedbacks,
			steps: model.steps,
			localVariables: model.localVariables,
			customPresetRef: {
				presetId,
				variableValues: appliedValues,
			},
			checksum,
		}
	}

	#emitListChanged(): void {
		this.emit('listChanged', this.getList())
	}

	#ensureTemplateControl(presetId: string, model: LayeredButtonModel | null): void {
		const controlId = CreateCustomPresetControlId(presetId)

		let control = this.#controls.getControl(controlId)
		if (!control) {
			control = this.#controls.createTemplateControl(controlId, model) ?? undefined
			if (!control) {
				this.#logger.warn(`Failed to create the template of custom preset "${presetId}"`)
				return
			}
		}

		this.#attachTemplateControl(presetId, control)
	}

	/**
	 * Watch a template control for edits, so linked buttons can be refreshed
	 */
	#attachTemplateControl(presetId: string, control: SomeControl<any>): void {
		this.#detachTemplateControl(control.controlId)

		const listener = (change: UIControlUpdate) => {
			if (change.type === 'config') {
				this.#queuePresetChanged(presetId)
			} else if (change.type === 'destroy') {
				this.#detachTemplateControl(control.controlId)
			}
		}

		control.updateEvents.on('update', listener)
		this.#templateListeners.set(control.controlId, { control, listener })
	}

	#detachTemplateControl(controlId: string): void {
		const existing = this.#templateListeners.get(controlId)
		if (!existing) return

		existing.control.updateEvents.off('update', existing.listener)
		this.#templateListeners.delete(controlId)
	}

	/**
	 * Report a change to a preset, debounced as editing a button tends to produce a burst of changes
	 */
	#queuePresetChanged(presetId: string): void {
		const existing = this.#pendingChanges.get(presetId)
		if (existing) clearTimeout(existing)

		this.#pendingChanges.set(
			presetId,
			setTimeout(() => {
				this.#pendingChanges.delete(presetId)
				if (this.#presets.has(presetId)) this.emit('presetChanged', presetId)
			}, PRESET_CHANGED_DEBOUNCE_MS)
		)
	}
}
