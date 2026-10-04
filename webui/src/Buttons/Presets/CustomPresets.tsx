import { Feedback } from '@dnd-kit/dom'
import { useDraggable } from '@dnd-kit/react'
import { faArrowLeft, faPencil, faPlus, faStar, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useSubscription } from '@trpc/tanstack-react-query'
import './CustomPresets.css'
import { observer } from 'mobx-react-lite'
import { useCallback, useId, useRef, useState } from 'react'
import { CreateCustomPresetControlId } from '@companion-app/shared/ControlId.js'
import type { CustomPresetInfo } from '@companion-app/shared/Model/CustomPresets.js'
import { Button, ButtonGroup } from '~/Components/Button'
import { ButtonPreviewBase, RedImage } from '~/Components/ButtonPreview.js'
import { Callout } from '~/Components/Callout.js'
import { Form, FormLabel } from '~/Components/Form.js'
import { GenericConfirmModal, type GenericConfirmModalRef } from '~/Components/GenericConfirmModal.js'
import { Grid } from '~/Components/Grid'
import { NonIdealState } from '~/Components/NonIdealState.js'
import { TextInputFieldSimple } from '~/Components/TextInputField.js'
import { ControlNotesEditor } from '~/Controls/ControlNotesEditor.js'
import { useControlConfig } from '~/Hooks/useControlConfig.js'
import { MyErrorBoundary } from '~/Resources/Error.js'
import { LoadingRetryOrError } from '~/Resources/Loading.js'
import { trpc, useMutationExt } from '~/Resources/TRPC.js'
import { PreventDefaultHandler } from '~/Resources/util.js'
import { LayeredButtonEditor } from '../EditButton/LayeredButtonEditor/LayeredButtonEditor.js'
import { CUSTOM_PRESET_DRAG_TYPE, type CustomPresetDragItem, type PresetPlacementMode } from './PresetDragItem.js'
import { PresetPlacementModeToggle } from './PresetsSectionsList.js'
import type { CustomPresetsListState } from './useCustomPresetsList.js'
import { usePresetPlacementMode } from './usePresetPlacementMode.js'

// Same as the module presets: drag a clone (the original stays put) with no drop animation
const PRESET_FEEDBACK_PLUGINS = [Feedback.configure({ feedback: 'clone', dropAnimation: null })]

interface CustomPresetsPanelProps {
	customPresets: CustomPresetsListState
	goBack: () => void
}

/**
 * The 'Custom' entry of the presets tab: lists the user's own presets, ready to be dragged onto the grid, and opens
 * the normal button editor to build or change one.
 */
export const CustomPresetsPanel = observer(function CustomPresetsPanel({
	customPresets,
	goBack,
}: CustomPresetsPanelProps): React.JSX.Element {
	const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
	const closeEditor = useCallback(() => setEditingPresetId(null), [])

	const editingPreset = editingPresetId ? customPresets.list?.find((p) => p.id === editingPresetId) : undefined
	if (editingPreset) {
		return <CustomPresetEditor key={editingPreset.id} preset={editingPreset} goBack={closeEditor} />
	}

	return <CustomPresetsList customPresets={customPresets} goBack={goBack} editPreset={setEditingPresetId} />
})

interface CustomPresetsListProps {
	customPresets: CustomPresetsListState
	goBack: () => void
	editPreset: (presetId: string) => void
}

function CustomPresetsList({ customPresets, goBack, editPreset }: CustomPresetsListProps): React.JSX.Element {
	const [placementMode] = usePresetPlacementMode()

	const createMutation = useMutationExt(trpc.controls.customPresets.create.mutationOptions())
	const presetCount = customPresets.list?.length ?? 0
	const createPreset = useCallback(() => {
		createMutation
			.mutateAsync({ name: `Custom preset ${presetCount + 1}`, fromLocation: null })
			.then((presetId) => {
				if (presetId) editPreset(presetId)
			})
			.catch((e) => console.error(`Failed to create custom preset: ${e}`))
	}, [createMutation, presetCount, editPreset])

	return (
		<div>
			<h5>Presets</h5>
			<div className="mb-2 flex justify-between items-center gap-2">
				<ButtonGroup>
					<Button color="primary" size="sm" onClick={goBack}>
						<FontAwesomeIcon icon={faArrowLeft} />
						&nbsp; Go back
					</Button>
					<Button color="secondary" size="sm" disabled>
						Custom
					</Button>
				</ButtonGroup>
				<Button color="success" size="sm" onClick={createPreset} disabled={!customPresets.list}>
					<FontAwesomeIcon icon={faPlus} className="me-1" />
					Add custom preset
				</Button>
			</div>

			{!customPresets.list ? (
				<LoadingRetryOrError
					dataReady={false}
					error={customPresets.error}
					doRetry={customPresets.retry}
					design="pulse"
				/>
			) : customPresets.list.length === 0 ? (
				<NonIdealState icon={faStar}>
					<p className="my-1">You don't have any custom presets yet.</p>
					<p className="my-1">
						Add one here and build it like any other button, or right click a button on the grid and choose{' '}
						<strong>Save as custom preset</strong>.
					</p>
				</NonIdealState>
			) : (
				<>
					<Callout color="info" className="my-2">
						<div className="flex items-center justify-between gap-4">
							<div>
								<strong>Drag and drop</strong> the preset buttons below into your buttons-configuration. Linked buttons
								only let you change the local variables of the preset.
							</div>
							<PresetPlacementModeToggle supportsReferences />
						</div>
					</Callout>
					<div className="custom-presets-grid">
						{customPresets.list.map((preset) => (
							<CustomPresetTile key={preset.id} preset={preset} placementMode={placementMode} editPreset={editPreset} />
						))}
					</div>
				</>
			)}
		</div>
	)
}

interface CustomPresetTileProps {
	preset: CustomPresetInfo
	placementMode: PresetPlacementMode
	editPreset: (presetId: string) => void
}

function CustomPresetTile({ preset, placementMode, editPreset }: CustomPresetTileProps): React.JSX.Element {
	const { ref: drag, isDragSource } = useDraggable<CustomPresetDragItem>({
		id: `custom-preset:${preset.id}`,
		type: CUSTOM_PRESET_DRAG_TYPE,
		data: { presetId: preset.id, mode: placementMode },
		plugins: PRESET_FEEDBACK_PLUGINS,
	})

	const preview = useCustomPresetPreview(preset.id)

	return (
		<div className="custom-preset-tile">
			<ButtonPreviewBase
				fixedSize
				dragRef={drag}
				className={isDragSource ? 'preset-drag-source' : undefined}
				title={preset.name}
				preview={preview}
			/>
			<div className="custom-preset-tile-name" title={preset.name}>
				{preset.name}
			</div>
			<Button color="secondary" size="sm" onClick={() => editPreset(preset.id)} title="Edit custom preset">
				<FontAwesomeIcon icon={faPencil} className="me-1" />
				Edit
			</Button>
		</div>
	)
}

function useCustomPresetPreview(presetId: string): string | null {
	const sub = useSubscription(trpc.controls.customPresets.preview.subscriptionOptions({ presetId }))

	return sub.error ? RedImage : (sub.data ?? null)
}

interface CustomPresetEditorProps {
	preset: CustomPresetInfo
	goBack: () => void
}

/**
 * Edit a custom preset, using the same editor as a normal button
 */
const CustomPresetEditor = observer(function CustomPresetEditor({ preset, goBack }: CustomPresetEditorProps) {
	const controlId = CreateCustomPresetControlId(preset.id)

	const confirmModalRef = useRef<GenericConfirmModalRef>(null)
	const nameFieldId = useId()

	const { controlConfig, error, reloadConfig } = useControlConfig(controlId)
	const preview = useCustomPresetPreview(preset.id)

	const renameMutation = useMutationExt(trpc.controls.customPresets.rename.mutationOptions())
	const setName = useCallback(
		(name: string) => {
			renameMutation
				.mutateAsync({ presetId: preset.id, name })
				.catch((e) => console.error(`Failed to rename custom preset: ${e}`))
		},
		[renameMutation, preset.id]
	)

	const deleteMutation = useMutationExt(trpc.controls.customPresets.delete.mutationOptions())
	const deletePreset = useCallback(() => {
		confirmModalRef.current?.show(
			'Delete custom preset',
			[
				`Are you sure you want to delete "${preset.name}"?`,
				'Buttons linked to it will keep working with how it looks now, but will no longer be updated.',
			],
			'Delete',
			() => {
				deleteMutation
					.mutateAsync({ presetId: preset.id })
					.then(() => goBack())
					.catch((e) => console.error(`Failed to delete custom preset: ${e}`))
			}
		)
	}, [deleteMutation, preset.id, preset.name, goBack])

	const config = controlConfig?.config
	const isLayeredButton = config?.type === 'button-layered'

	return (
		<div className="edit-button-panel flex-form">
			<GenericConfirmModal ref={confirmModalRef} />

			<div className="flex mb-0 gap-2">
				<div className="grow min-w-0 flex flex-col gap-1">
					<div className="flex flex-wrap items-center gap-1">
						<Button color="primary" onClick={goBack}>
							<FontAwesomeIcon icon={faArrowLeft} className="me-1" />
							Custom presets
						</Button>
						<Button color="danger" onClick={deletePreset} title="Delete custom preset">
							<FontAwesomeIcon icon={faTrash} className="me-1" />
							Delete
						</Button>
					</div>
					<Form row className="gap-2 mt-1" onSubmit={PreventDefaultHandler}>
						<FormLabel htmlFor={nameFieldId} sm={3} column="sm">
							Name
						</FormLabel>
						<Grid.Col sm={9}>
							<TextInputFieldSimple id={nameFieldId} value={preset.name} setValue={setName} />
						</Grid.Col>
					</Form>
					{isLayeredButton && (
						<MyErrorBoundary>
							<ControlNotesEditor controlId={controlId} notes={config.options.notes} className="w-full" />
						</MyErrorBoundary>
					)}
				</div>
				<ButtonPreviewBase fixedSize={100} preview={preview} />
			</div>

			<LoadingRetryOrError dataReady={!!config} error={error} doRetry={reloadConfig} design="pulse" />

			{config && !isLayeredButton && (
				<Callout color="warning" className="my-2">
					This custom preset is not a normal button. This is likely a bug, please report it.
				</Callout>
			)}

			{config?.type === 'button-layered' && (
				<LayeredButtonEditor
					config={config}
					controlId={controlId}
					runtimeProps={controlConfig?.runtime ?? false}
					location={undefined}
				/>
			)}
		</div>
	)
})
