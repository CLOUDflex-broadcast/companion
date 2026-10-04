import { describe, expect, test } from 'vitest'
import { filterCustomPresetVariableValues, getCustomPresetEditableVariables } from '../Model/CustomPresets.js'
import { EntityModelType, type SomeEntityModel } from '../Model/EntityModel.js'

function userValue(variableName: string | undefined, startupValue: any): SomeEntityModel {
	return {
		id: `id-${variableName}`,
		type: EntityModelType.Feedback,
		definitionId: 'user_value',
		connectionId: 'internal',
		upgradeIndex: undefined,
		variableName,
		options: {
			persist_value: { isExpression: false, value: false },
			startup_value: { isExpression: false, value: startupValue },
		},
	}
}

function feedbackVariable(variableName: string): SomeEntityModel {
	return {
		id: `id-${variableName}`,
		type: EntityModelType.Feedback,
		definitionId: 'some_feedback',
		connectionId: 'conn1',
		upgradeIndex: undefined,
		variableName,
		options: {},
	}
}

describe('getCustomPresetEditableVariables', () => {
	test('returns the user value local variables with their startup values', () => {
		expect(getCustomPresetEditableVariables([userValue('channel', 3), userValue('label', 'Cam')])).toEqual([
			{ variableName: 'channel', defaultValue: 3 },
			{ variableName: 'label', defaultValue: 'Cam' },
		])
	})

	test('ignores local variables backed by other feedbacks', () => {
		expect(getCustomPresetEditableVariables([feedbackVariable('tally'), userValue('channel', 1)])).toEqual([
			{ variableName: 'channel', defaultValue: 1 },
		])
	})

	test('ignores unnamed and duplicate variables', () => {
		expect(getCustomPresetEditableVariables([userValue(undefined, 1), userValue('a', 1), userValue('a', 2)])).toEqual([
			{ variableName: 'a', defaultValue: 1 },
		])
	})
})

describe('filterCustomPresetVariableValues', () => {
	const localVariables = [userValue('channel', 1), feedbackVariable('tally')]

	test('keeps overrides of the editable variables', () => {
		expect(filterCustomPresetVariableValues(localVariables, { channel: 5 })).toEqual({ channel: 5 })
	})

	test('drops overrides of unknown or non-editable variables', () => {
		expect(filterCustomPresetVariableValues(localVariables, { tally: true, missing: 1, channel: 2 })).toEqual({
			channel: 2,
		})
	})

	test('drops undefined overrides', () => {
		expect(filterCustomPresetVariableValues(localVariables, { channel: undefined })).toEqual({})
	})
})
