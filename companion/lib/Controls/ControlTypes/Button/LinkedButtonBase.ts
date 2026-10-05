import type { JsonValue } from 'type-fest'
import type {
	ButtonModelBase,
	LayeredButtonModel,
	LayeredButtonOptions,
	NormalButtonRuntimeProps,
} from '@companion-app/shared/Model/ButtonModel.js'
import type { SomeButtonGraphicsElement } from '@companion-app/shared/Model/StyleLayersModel.js'
import { VisitorReferencesCollector } from '../../../Resources/Visitors/ReferencesCollector.js'
import { VisitorReferencesUpdater } from '../../../Resources/Visitors/ReferencesUpdater.js'
import type { ControlDependencies } from '../../ControlDependencies.js'
import type { ControlStepsRuntimeManager } from '../../Entities/ControlActionSetAndStepsManager.js'
import type { ControlEntityListChangeProps } from '../../Entities/EntityListPoolBase.js'
import { ControlEntityListPoolButton } from '../../Entities/EntityListPoolButton.js'
import type {
	ControlWithActions,
	ControlWithActionSets,
	ControlWithConvert,
	ControlWithOptions,
	ControlWithoutEvents,
	ControlWithoutLayeredStyle,
} from '../../IControlFragments.js'
import { ButtonControlRuntimeBase } from './Base.js'
import { LayeredButtonDrawer } from './LayeredButtonDrawer.js'

/**
 * The cached button data that a linked button holds
 */
export interface LinkedButtonModelBase extends ButtonModelBase {
	options: LayeredButtonOptions
	style: {
		layers: SomeButtonGraphicsElement[]
	}
	checksum?: string
}

/**
 * Base class for a button control that is linked to a source of button data (a module preset, or a custom preset).
 *
 * It behaves like a normal layered button at runtime (it can be pressed, run actions, render feedbacks and
 * progress steps), but its configuration is a cached copy of the source and is read-only. It composes the plain
 * {@link LayeredButtonDrawer} (not the editor subclass), so it has no way to mutate its style; the entity pool is
 * likewise constructed read-only. When the source updates, the subclass rebuilds the model and applies it with
 * {@link applyUpdatedModel}. An 'Edit' action in the UI converts it into a normal `button-layered` control via
 * {@link convertControl}.
 */
export abstract class LinkedButtonControlBase<TJson extends LinkedButtonModelBase>
	extends ButtonControlRuntimeBase<TJson, LayeredButtonOptions, ControlEntityListPoolButton>
	implements
		ControlWithoutLayeredStyle,
		ControlWithActions,
		ControlWithoutEvents,
		ControlWithActionSets,
		ControlWithOptions,
		ControlWithConvert
{
	readonly supportsActions = true
	readonly supportsEvents = false
	readonly supportsActionSets = true
	readonly supportsLayeredStyle = false
	readonly supportsOptions = true
	readonly supportsConvert = true

	/** The composed (read-only) layered rendering. There is no editing surface on this drawer. */
	readonly #drawing: LayeredButtonDrawer
	override get drawing(): LayeredButtonDrawer {
		return this.#drawing
	}

	/**
	 * The checksum of the source the cached data was last resolved from (carried on the model itself, so it always
	 * matches the cached data). Used to ignore updates that don't actually change the source, so we don't
	 * needlessly discard cached feedback values and re-subscribe. `null`/absent until resolved against a known source.
	 */
	#lastChecksum: string | null = null
	protected get lastChecksum(): string | null {
		return this.#lastChecksum
	}

	get actionSets(): ControlStepsRuntimeManager {
		return this.entities
	}

	constructor(deps: ControlDependencies, controlId: string, debugNamespace: string, storage: TJson, isImport: boolean) {
		super(deps, controlId, debugNamespace, true, ControlEntityListPoolButton)

		this.options = {
			...structuredClone(ButtonControlRuntimeBase.DefaultOptions),
			rotaryActions: false,
			canModifyStyleInApis: false,
			notes: '',
		}

		this.#drawing = new LayeredButtonDrawer(deps, controlId, {
			getButtonStateProps: () => this.getDrawStyleButtonStateProps(),
			entities: this.entities,
		})

		this.#loadModel(storage, isImport)
	}

	/**
	 * Prepare this control for deletion
	 */
	destroy(): void {
		this.drawing.dispose()
		super.destroy()
	}

	/**
	 * Apply a (cached) model to this control on construction
	 */
	#loadModel(storage: TJson, isImport: boolean): void {
		this.drawing.loadElements(storage.style.layers)
		this.options = Object.assign(this.options, storage.options || {})
		this.entities.setupRotaryActionSets(!!this.options.rotaryActions, true)
		this.entities.loadStorage(storage, true, isImport)
		this.entities.stepExpressionUpdate(this.options)

		// Baseline the checksum from the model we loaded, so a subsequent identical update is a no-op.
		this.#lastChecksum = storage.checksum ?? null

		// Ensure control is stored before setup
		if (isImport) setImmediate(() => this.postProcessImport())
	}

	/**
	 * Update the reference to the source from a freshly built model, before it is applied
	 */
	protected abstract updateReferenceFromModel(updatedModel: TJson): void

	/**
	 * Replace the cached data with a freshly built model and persist+redraw
	 */
	protected applyUpdatedModel(updatedModel: TJson): void {
		this.updateReferenceFromModel(updatedModel)

		this.drawing.loadElements(updatedModel.style.layers)
		// `notes` is user-owned metadata, not part of the source - preserve it across refreshes
		const userNotes = this.options.notes
		this.options = {
			...structuredClone(ButtonControlRuntimeBase.DefaultOptions),
			...updatedModel.options,
			notes: userNotes,
		}
		this.entities.setupRotaryActionSets(!!this.options.rotaryActions, true)
		// Load as a clone, to generate new entity ids.
		this.entities.loadStorage(updatedModel, false, true)
		this.entities.stepExpressionUpdate(this.options)
		this.entities.resubscribeEntities()

		// Record the checksum we just rebuilt from, so the next identical update is ignored.
		this.#lastChecksum = updatedModel.checksum ?? null

		this.commitChange(true)
		this.sendRuntimePropsChange()
	}

	/**
	 * Update an option field. A linked button is read-only except for its user notes (which are user-owned
	 * metadata, not part of the source, and are preserved across updates). Any other option is rejected - so it
	 * stays read-only even as new option fields are added in the future.
	 */
	optionsSetField(key: string, value: JsonValue): boolean {
		if (key !== 'notes' || typeof value !== 'string') return false

		this.options.notes = value
		this.commitChange(false)
		return true
	}

	/**
	 * Convert this control to a normal editable layered button, baking the current cached state into a plain model.
	 * After this, the link to the source is gone.
	 */
	convertControl(): LayeredButtonModel {
		return {
			type: 'button-layered',
			style: { layers: structuredClone([...this.drawing.drawElements]) },
			options: structuredClone(this.options),
			feedbacks: this.entities.getFeedbackEntities(),
			steps: this.entities.asNormalButtonSteps(),
			localVariables: this.entities.getLocalVariableEntities().map((ent) => ent.asEntityModel(true)),
		}
	}

	protected entityListReportChange(options: ControlEntityListChangeProps): void {
		if (!options.noSave) {
			this.commitChange(false)
		}
		if (options.invalidateAllElements) {
			this.drawing.clearCache()
		} else if (options.changedElementIds) {
			for (const elementId of options.changedElementIds) {
				this.drawing.invalidateElement(elementId)
			}
		}

		if (options.redraw || options.changedElementIds || options.invalidateAllElements) {
			this.triggerInvalidation()
		}
	}

	collectReferencedConnectionsAndVariables(
		foundConnectionIds: Set<string>,
		foundConnectionLabels: Set<string>,
		foundVariables: Set<string>
	): void {
		const collector = new VisitorReferencesCollector(
			this.deps.internalModule,
			foundConnectionIds,
			foundConnectionLabels,
			foundVariables,
			undefined
		)
		collector.visitEntities(this.entities.getAllEntities(), [])
		this.drawing.visit(collector)
	}

	triggerLocationHasChanged(): void {
		super.triggerLocationHasChanged()

		this.drawing.locationChanged()
	}

	renameVariables(labelFrom: string, labelTo: string): void {
		const updater = new VisitorReferencesUpdater(
			this.deps.internalModule,
			{ [labelFrom]: labelTo },
			undefined,
			undefined
		)
		updater.visitEntities(this.entities.getAllEntities(), [])
		this.drawing.visit(updater)
		const changed = updater.recheckChangedFeedbacks().hasChanges()

		if (changed) {
			this.drawing.clearCache()
		}

		this.commitChange(changed)
	}

	/**
	 * The cached button data, for building the JSON of this control
	 */
	protected cachedModelJSON(): LinkedButtonModelBase {
		return {
			style: { layers: [...this.drawing.drawElements] },
			options: this.options,
			feedbacks: this.entities.getFeedbackEntities(),
			steps: this.entities.asNormalButtonSteps(),
			localVariables: this.entities.getLocalVariableEntities().map((ent) => ent.asEntityModel(true)),
			// Persist the checksum so a reload keeps its baseline (and doesn't rebuild once on the first report).
			checksum: this.#lastChecksum ?? undefined,
		}
	}

	override toRuntimeJSON(): NormalButtonRuntimeProps {
		return {
			current_step_id: this.entities.currentStepId,
		}
	}
}
