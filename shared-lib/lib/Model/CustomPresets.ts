import { EntityModelType, isInternalUserValueFeedback, type SomeEntityModel } from './EntityModel.js'
import type { VariableValue, VariableValues } from './Variables.js'

/**
 * A user-defined preset. Its button data lives in an off-grid `button-layered` control (see
 * `CreateCustomPresetControlId`), so it is edited with the normal button editor.
 */
export interface CustomPresetInfo {
	id: string
	name: string
	sortOrder: number
}

/** A local variable of a custom preset that a linked button is allowed to override */
export interface CustomPresetEditableVariable {
	variableName: string
	/** The value defined by the preset */
	defaultValue: VariableValue
}

/**
 * Find the local variables of a custom preset that a linked button is allowed to override. These are the simple
 * 'user value' local variables - everything else on a linked button is managed by the preset.
 */
export function getCustomPresetEditableVariables(localVariables: SomeEntityModel[]): CustomPresetEditableVariable[] {
	const result: CustomPresetEditableVariable[] = []
	const seenNames = new Set<string>()

	for (const localVariable of localVariables) {
		if (localVariable.type !== EntityModelType.Feedback || !isInternalUserValueFeedback(localVariable)) continue

		const variableName = localVariable.variableName
		if (!variableName || seenNames.has(variableName)) continue
		seenNames.add(variableName)

		result.push({
			variableName,
			defaultValue: localVariable.options.startup_value?.value,
		})
	}

	return result
}

/**
 * Filter some variable overrides down to those which apply to the editable variables of a custom preset
 */
export function filterCustomPresetVariableValues(
	localVariables: SomeEntityModel[],
	variableValues: VariableValues
): VariableValues {
	const result: VariableValues = {}

	for (const { variableName } of getCustomPresetEditableVariables(localVariables)) {
		if (Object.hasOwn(variableValues, variableName) && variableValues[variableName] !== undefined) {
			result[variableName] = variableValues[variableName]
		}
	}

	return result
}
