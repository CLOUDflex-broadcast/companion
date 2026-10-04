import type EventEmitter from 'node:events'
import z from 'zod'
import { CreateCustomPresetControlId } from '@companion-app/shared/ControlId.js'
import type { LayeredButtonModel } from '@companion-app/shared/Model/ButtonModel.js'
import type { CustomPresetInfo } from '@companion-app/shared/Model/CustomPresets.js'
import { JsonValueSchema } from '@companion-app/shared/Model/Options.js'
import { PREVIEW_RENDER_SIZE } from '../Graphics/ImageResult.js'
import type { IPageStore } from '../Page/Store.js'
import { zodLocation } from '../Preview/Graphics.js'
import { publicProcedure, router, toIterable } from '../UI/TRPC.js'
import type { ControlCommonEvents } from './ControlDependencies.js'
import type { ControlsController } from './Controller.js'
import { ControlButtonCustomPresetReference } from './ControlTypes/Button/CustomPresetReference.js'
import { ControlButtonLayered } from './ControlTypes/Button/Layered.js'
import type { CustomPresetLibrary, CustomPresetLibraryEvents } from './CustomPresetLibrary.js'
import type { SomeControl } from './IControlFragments.js'

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createCustomPresetsTrpcRouter(
	library: CustomPresetLibrary,
	controlsMap: Map<string, SomeControl<any>>,
	pageStore: IPageStore,
	controlEvents: EventEmitter<ControlCommonEvents>,
	controlsController: ControlsController
) {
	// Typed as the plain emitter, for `toIterable` to be able to infer the event map
	const libraryEvents: EventEmitter<CustomPresetLibraryEvents> = library

	return router({
		list: publicProcedure.subscription(async function* ({ signal }) {
			const changes = toIterable(libraryEvents, 'listChanged', signal)

			yield library.getList()

			for await (const [list] of changes) {
				yield list satisfies CustomPresetInfo[]
			}
		}),

		create: publicProcedure
			.input(
				z.object({
					name: z.string(),
					/** A button to take the initial data from, or null to start from a default button */
					fromLocation: zodLocation.nullable(),
				})
			)
			.mutation(async ({ input }) => {
				let model: LayeredButtonModel | null = null
				if (input.fromLocation) {
					const controlId = pageStore.getControlIdAt(input.fromLocation)
					const control = controlId ? controlsMap.get(controlId) : undefined

					if (control instanceof ControlButtonLayered) {
						model = control.toJSON(true)
					} else if (control?.supportsConvert) {
						const converted = control.convertControl()
						if (converted.type === 'button-layered') model = converted
					}

					if (!model) return null
				}

				return library.createPreset(input.name, model)
			}),

		rename: publicProcedure
			.input(
				z.object({
					presetId: z.string(),
					name: z.string(),
				})
			)
			.mutation(async ({ input }) => {
				return library.renamePreset(input.presetId, input.name)
			}),

		move: publicProcedure
			.input(
				z.object({
					presetId: z.string(),
					newIndex: z.number().int(),
				})
			)
			.mutation(async ({ input }) => {
				return library.movePreset(input.presetId, input.newIndex)
			}),

		delete: publicProcedure
			.input(
				z.object({
					presetId: z.string(),
				})
			)
			.mutation(async ({ input }) => {
				return library.deletePreset(input.presetId)
			}),

		place: publicProcedure
			.input(
				z.object({
					presetId: z.string(),
					location: zodLocation,
					/** Whether to place a button linked to the preset, or a one-off copy of its data */
					mode: z.enum(['copy', 'reference']),
				})
			)
			.mutation(async ({ input }) => {
				if (!pageStore.isPageValid(input.location.pageNumber)) return null

				const model =
					input.mode === 'reference'
						? library.resolveReferenceModel(input.presetId, {})
						: library.getPresetModel(input.presetId)
				if (!model) return null

				return controlsController.importControl(input.location, model)
			}),

		setReferenceVariable: publicProcedure
			.input(
				z.object({
					location: zodLocation,
					variableName: z.string(),
					/** The new value, or undefined to use the value defined by the preset */
					value: JsonValueSchema.optional(),
				})
			)
			.mutation(async ({ input }) => {
				const controlId = pageStore.getControlIdAt(input.location)
				if (!controlId) return false

				const control = controlsMap.get(controlId)
				if (!(control instanceof ControlButtonCustomPresetReference)) return false

				return control.setVariableValue(input.variableName, input.value)
			}),

		preview: publicProcedure
			.input(
				z.object({
					presetId: z.string(),
				})
			)
			.subscription(async function* ({ signal, input }) {
				const changes = toIterable(libraryEvents, 'previewChanged', signal)

				const initialRender = library.getLastRender(input.presetId)
				if (initialRender) {
					yield await initialRender.drawNativeEncoded(PREVIEW_RENDER_SIZE, PREVIEW_RENDER_SIZE, null, 'png')
				} else {
					yield null
					// Not drawn yet, request a render
					controlEvents.emit('invalidateControlRender', CreateCustomPresetControlId(input.presetId))
				}

				for await (const [presetId, render] of changes) {
					if (presetId !== input.presetId) continue
					yield await render.drawNativeEncoded(PREVIEW_RENDER_SIZE, PREVIEW_RENDER_SIZE, null, 'png')
				}
			}),
	})
}
