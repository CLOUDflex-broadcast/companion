import { faLink, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useSubscription } from '@trpc/tanstack-react-query'
import { useCallback, useId, useMemo } from 'react'
import type { CustomPresetReferenceButtonModel } from '@companion-app/shared/Model/ButtonModel.js'
import type { ControlLocation } from '@companion-app/shared/Model/Common.js'
import { getCustomPresetEditableVariables } from '@companion-app/shared/Model/CustomPresets.js'
import type { VariableValue } from '@companion-app/shared/Model/Variables.js'
import { Button } from '~/Components/Button'
import { Callout } from '~/Components/Callout.js'
import { Form, FormLabel } from '~/Components/Form.js'
import { Grid } from '~/Components/Grid'
import VariableInputGroup from '~/Components/VariableInputGroup.js'
import { trpc, useMutationExt } from '~/Resources/TRPC.js'
import { PreventDefaultHandler } from '~/Resources/util.js'

interface CustomPresetReferenceEditorProps {
	config: CustomPresetReferenceButtonModel
	location: ControlLocation
}

/**
 * Editor shown for a button linked to a custom preset. Everything is managed by the preset, except the values of the
 * preset's local variables, which can be changed for this button.
 */
export function CustomPresetReferenceEditor({ config, location }: CustomPresetReferenceEditorProps): React.JSX.Element {
	const { presetId, variableValues } = config.customPresetRef

	const presetsSub = useSubscription(trpc.controls.customPresets.list.subscriptionOptions())
	const preset = presetsSub.data?.find((p) => p.id === presetId)

	const editableVariables = useMemo(
		() => getCustomPresetEditableVariables(config.localVariables),
		[config.localVariables]
	)

	return (
		<>
			<Callout color="info" className="my-2">
				<div className="flex gap-2">
					<FontAwesomeIcon icon={faLink} className="mt-1" />
					<div>
						This button is <strong>linked</strong> to the custom preset <strong>{preset?.name ?? 'Unknown'}</strong>. It
						updates automatically when the preset is edited in the Presets tab.
						<br />
						Use <strong>Edit</strong> above to unlink it into a normal, fully editable button.
					</div>
				</div>
			</Callout>

			{presetsSub.data && !preset && (
				<Callout color="warning" className="my-2">
					The custom preset no longer exists. This button is showing its last known state.
				</Callout>
			)}

			<h5 className="mt-4">Local variables</h5>
			{editableVariables.length > 0 ? (
				<>
					<p className="text-muted small">
						These values can be changed for this button. Everything else is managed by the preset.
					</p>
					<Form row className="gap-2" onSubmit={PreventDefaultHandler}>
						{editableVariables.map(({ variableName, defaultValue }) => (
							<CustomPresetReferenceVariableRow
								key={variableName}
								location={location}
								variableName={variableName}
								value={defaultValue}
								isOverridden={Object.hasOwn(variableValues, variableName)}
							/>
						))}
					</Form>
				</>
			) : (
				<p className="text-muted small">
					The preset has no local variables that can be changed. Add a 'User Value' local variable to the preset to make
					something configurable per button.
				</p>
			)}
		</>
	)
}

interface CustomPresetReferenceVariableRowProps {
	location: ControlLocation
	variableName: string
	/** The current value, either the override or the one defined by the preset */
	value: VariableValue
	isOverridden: boolean
}

function CustomPresetReferenceVariableRow({
	location,
	variableName,
	value,
	isOverridden,
}: CustomPresetReferenceVariableRowProps) {
	const setVariableMutation = useMutationExt(trpc.controls.customPresets.setReferenceVariable.mutationOptions())

	const setValue = useCallback(
		(newValue: VariableValue | undefined) => {
			setVariableMutation
				.mutateAsync({ location, variableName, value: newValue })
				.catch((e) => console.error(`Failed to set custom preset variable: ${e}`))
		},
		[setVariableMutation, location, variableName]
	)
	const resetValue = useCallback(() => setValue(undefined), [setValue])

	const fieldId = useId()

	return (
		<>
			<FormLabel htmlFor={fieldId} sm={4} column="sm">
				{variableName}
			</FormLabel>
			<Grid.Col sm={8}>
				<div className="flex gap-1">
					<div className="grow min-w-0">
						<VariableInputGroup id={fieldId} value={value} setValue={setValue} />
					</div>
					<Button
						color="secondary"
						size="sm"
						onClick={resetValue}
						disabled={!isOverridden}
						title={isOverridden ? 'Reset to the value from the preset' : 'Using the value from the preset'}
					>
						<FontAwesomeIcon icon={faRotateLeft} />
					</Button>
				</div>
			</Grid.Col>
		</>
	)
}
