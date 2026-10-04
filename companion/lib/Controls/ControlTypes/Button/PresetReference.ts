import type { PresetReferenceButtonModel } from '@companion-app/shared/Model/ButtonModel.js'
import type { VariableValue, VariableValues } from '@companion-app/shared/Model/Variables.js'
import type { ControlDependencies } from '../../ControlDependencies.js'
import { LinkedButtonControlBase } from './LinkedButtonBase.js'

/**
 * Class for a button control that references a preset from a connection.
 *
 * It behaves like a normal layered button at runtime, but its configuration is a cached copy of the source preset
 * and is read-only (see {@link LinkedButtonControlBase}). When the source preset definition updates, the cached
 * data is refreshed, re-applying any user-edited templated variable values.
 *
 * @author Julian Waller <me@julusian.co.uk>
 * @since 5.0.0
 * @copyright 2026 Bitfocus AS
 * @license
 * This program is free software.
 * You should have received a copy of the MIT licence as well as the Bitfocus
 * Individual Contributor License Agreement for Companion along with
 * this program.
 */
export class ControlButtonPresetReference extends LinkedButtonControlBase<PresetReferenceButtonModel> {
	readonly type = 'preset-reference'

	/**
	 * The reference to the source preset, and the user-editable templated variable overrides.
	 * `#connectionId`/`#moduleId` are mutable because the reference can be switched to another connection
	 * of the same module.
	 */
	#connectionId: string
	#moduleId: string
	readonly #presetId: string
	#variableValues: VariableValues | null

	get connectionId(): string {
		return this.#connectionId
	}
	get moduleId(): string {
		return this.#moduleId
	}
	get presetId(): string {
		return this.#presetId
	}

	constructor(deps: ControlDependencies, controlId: string, storage: PresetReferenceButtonModel, isImport: boolean) {
		if (storage.type !== 'preset-reference')
			throw new Error(`Invalid type given to ControlButtonPresetReference: "${storage.type}"`)

		super(deps, controlId, `Controls/Button/PresetReference/${controlId}`, storage, isImport)

		this.#connectionId = storage.presetRef.connectionId
		this.#moduleId = storage.presetRef.moduleId
		this.#presetId = storage.presetRef.presetId
		this.#variableValues = storage.presetRef.variableValues

		// Refresh the cached data whenever the source preset definitions change
		this.deps.instance.definitions.on('updatePresets', this.#onPresetUpdate)
	}

	/**
	 * Prepare this control for deletion
	 */
	destroy(): void {
		this.deps.instance.definitions.off('updatePresets', this.#onPresetUpdate)
		super.destroy()
	}

	/**
	 * The source preset definitions changed - refresh the cached data, preserving the user's templated values.
	 * If the preset no longer exists, keep the last-known data.
	 */
	#onPresetUpdate = (connectionId: string): void => {
		if (connectionId !== this.#connectionId) return

		const updatedModel = this.deps.instance.definitions.convertPresetToReferenceControlModel(
			this.#connectionId,
			this.#presetId,
			this.#variableValues
		)
		if (!updatedModel) return // Preset is gone - keep the last-known cached data

		// Ignore updates that don't actually change our preset (e.g. a module re-reporting identical presets),
		// so we don't needlessly discard cached feedback values and re-subscribe.
		if (updatedModel.checksum !== undefined && updatedModel.checksum === this.lastChecksum) return

		this.applyUpdatedModel(updatedModel)
	}

	protected updateReferenceFromModel(updatedModel: PresetReferenceButtonModel): void {
		// Keep the reference metadata in sync (module-id, and connection-id when switched).
		this.#connectionId = updatedModel.presetRef.connectionId
		this.#moduleId = updatedModel.presetRef.moduleId
		this.#variableValues = updatedModel.presetRef.variableValues
	}

	/**
	 * Get the names of the templated variables the user is allowed to edit on this reference
	 */
	getTemplateVariableNames(): string[] {
		return this.#variableValues ? Object.keys(this.#variableValues) : []
	}

	/**
	 * Update a single templated variable value. Only variables that were templated (present in the override
	 * map) may be edited. The override is re-applied on top of the source preset, so it survives future
	 * preset updates.
	 */
	setTemplateVariableValue(variableName: string, value: VariableValue | undefined): boolean {
		if (!this.#variableValues || !(variableName in this.#variableValues)) return false

		this.#variableValues = { ...this.#variableValues, [variableName]: value }

		const updatedModel = this.deps.instance.definitions.convertPresetToReferenceControlModel(
			this.#connectionId,
			this.#presetId,
			this.#variableValues
		)
		if (updatedModel) {
			this.applyUpdatedModel(updatedModel)
		} else {
			// Source preset is gone - persist the new override anyway so it isn't lost
			this.commitChange(true)
		}

		return true
	}

	/**
	 * Switch the reference to point at another connection of the same module. The preset is re-resolved from the
	 * new connection, re-applying the templated variable overrides. Returns false if the new connection cannot
	 * host this reference.
	 */
	setReferencedConnection(connectionId: string): boolean {
		if (connectionId === this.#connectionId) return true

		if (!this.deps.instance.definitions.doesConnectionSupportPresetReferences(connectionId)) return false

		const updatedModel = this.deps.instance.definitions.convertPresetToReferenceControlModel(
			connectionId,
			this.#presetId,
			this.#variableValues
		)
		if (!updatedModel) return false
		if (updatedModel.presetRef.moduleId !== this.#moduleId) return false

		this.applyUpdatedModel(updatedModel)

		return true
	}

	/**
	 * Convert this control to JSON
	 * To be sent to the client and written to the db
	 */
	override toJSON(clone = true): PresetReferenceButtonModel {
		const obj: PresetReferenceButtonModel = {
			type: this.type,
			...this.cachedModelJSON(),
			presetRef: {
				connectionId: this.#connectionId,
				moduleId: this.#moduleId,
				presetId: this.#presetId,
				variableValues: this.#variableValues,
			},
		}

		return clone ? structuredClone(obj) : obj
	}
}
