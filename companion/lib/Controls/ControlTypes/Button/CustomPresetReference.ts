import type { CustomPresetReferenceButtonModel } from '@companion-app/shared/Model/ButtonModel.js'
import { getCustomPresetEditableVariables } from '@companion-app/shared/Model/CustomPresets.js'
import type { VariableValue, VariableValues } from '@companion-app/shared/Model/Variables.js'
import type { ControlDependencies } from '../../ControlDependencies.js'
import { LinkedButtonControlBase } from './LinkedButtonBase.js'

/**
 * Class for a button control that is linked to a user-defined custom preset.
 *
 * It behaves like a normal layered button at runtime, but its configuration is a cached copy of the custom preset
 * and is read-only (see {@link LinkedButtonControlBase}). The only thing that can be changed per button is the
 * value of the preset's simple (user value) local variables. Whenever the custom preset is edited, the cached data
 * is refreshed, re-applying those overrides.
 */
export class ControlButtonCustomPresetReference extends LinkedButtonControlBase<CustomPresetReferenceButtonModel> {
	readonly type = 'custom-preset-reference'

	readonly #presetId: string
	#variableValues: VariableValues

	get presetId(): string {
		return this.#presetId
	}

	constructor(
		deps: ControlDependencies,
		controlId: string,
		storage: CustomPresetReferenceButtonModel,
		isImport: boolean
	) {
		if (storage.type !== 'custom-preset-reference')
			throw new Error(`Invalid type given to ControlButtonCustomPresetReference: "${storage.type}"`)

		super(deps, controlId, `Controls/Button/CustomPresetReference/${controlId}`, storage, isImport)

		this.#presetId = storage.customPresetRef.presetId
		this.#variableValues = { ...storage.customPresetRef.variableValues }

		// Refresh the cached data whenever the custom preset is edited
		this.deps.customPresets.on('presetChanged', this.#onPresetChanged)
	}

	/**
	 * Prepare this control for deletion
	 */
	destroy(): void {
		this.deps.customPresets.off('presetChanged', this.#onPresetChanged)
		super.destroy()
	}

	/**
	 * The custom preset changed - refresh the cached data, preserving the overridden variable values.
	 * If the preset no longer exists, keep the last-known data.
	 */
	#onPresetChanged = (presetId: string): void => {
		if (presetId !== this.#presetId) return

		const updatedModel = this.deps.customPresets.resolveReferenceModel(this.#presetId, this.#variableValues)
		if (!updatedModel) return // Preset is gone - keep the last-known cached data

		// Ignore changes that don't affect the resolved data, so we don't needlessly discard cached feedback values
		if (updatedModel.checksum !== undefined && updatedModel.checksum === this.lastChecksum) return

		this.applyUpdatedModel(updatedModel)
	}

	protected updateReferenceFromModel(updatedModel: CustomPresetReferenceButtonModel): void {
		this.#variableValues = { ...updatedModel.customPresetRef.variableValues }
	}

	/**
	 * Override the value of one of the local variables of the preset, or pass `undefined` to go back to the value
	 * defined by the preset. Only the simple (user value) local variables of the preset may be overridden.
	 */
	setVariableValue(variableName: string, value: VariableValue | undefined): boolean {
		const cachedModel = this.toJSON(false)
		const isEditable = getCustomPresetEditableVariables(cachedModel.localVariables).some(
			(v) => v.variableName === variableName
		)
		if (!isEditable) return false

		const newValues = { ...this.#variableValues }
		if (value === undefined) {
			delete newValues[variableName]
		} else {
			newValues[variableName] = value
		}
		this.#variableValues = newValues

		const updatedModel = this.deps.customPresets.resolveReferenceModel(this.#presetId, this.#variableValues)
		if (updatedModel) {
			this.applyUpdatedModel(updatedModel)
		} else {
			// Source preset is gone - persist the new override anyway so it isn't lost
			this.commitChange(true)
		}

		return true
	}

	/**
	 * Convert this control to JSON
	 * To be sent to the client and written to the db
	 */
	override toJSON(clone = true): CustomPresetReferenceButtonModel {
		const obj: CustomPresetReferenceButtonModel = {
			type: this.type,
			...this.cachedModelJSON(),
			customPresetRef: {
				presetId: this.#presetId,
				variableValues: this.#variableValues,
			},
		}

		return clone ? structuredClone(obj) : obj
	}
}
