import { faArrowRight, faLifeRing, faStar } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { observer } from 'mobx-react-lite'
import { createContext, memo, useCallback, useContext } from 'react'
import type { ClientConnectionConfig } from '@companion-app/shared/Model/Connections.js'
import { assertNever } from '@companion-app/shared/Util.js'
import { Callout } from '~/Components/Callout'
import { CollapsibleTree, type CollapsibleTreeHeaderProps } from '~/Components/CollapsibleTree/CollapsibleTree.js'
import {
	useConnectionLeafTree,
	type CollectionGroupMeta,
	type ConnectionLeafItem,
} from '~/Components/CollapsibleTree/useConnectionLeafTree.js'
import { NonIdealState } from '~/Components/NonIdealState.js'
import { usePanelCollapseHelper } from '~/Helpers/CollapseHelper.js'
import { useComputed } from '~/Resources/util'
import type { PresetDefinitionsStore } from './PresetDefinitionsStore'

const PresetsStoreContext = createContext<PresetDefinitionsStore | null>(null)

const PresetLeaf = observer(function PresetLeaf({ leaf }: { leaf: ConnectionLeafItem }) {
	const presetsDefinitionsStore = useContext(PresetsStoreContext)

	const connectionPresets = presetsDefinitionsStore?.presets.get(leaf.connectionId)
	const presetCount = useComputed(() => {
		if (!connectionPresets) return 0

		let count = 0

		for (const section of Object.values(connectionPresets.sections)) {
			for (const group of Object.values(section?.definitions ?? {})) {
				switch (group.type) {
					case 'simple':
						count += Object.keys(group.presets).length
						break
					case 'template':
						count += group.templateValues.length
						break
					default:
						assertNever(group)
						break
				}
			}
		}

		return count
	}, [connectionPresets])

	return (
		<>
			<div className="collapsible-tree-leaf-text">
				<div className="flex justify-between items-center w-full">
					<div>
						<span className="collapsible-tree-connection-label">{leaf.connectionLabel}</span>
						{leaf.moduleDisplayName && (
							<>
								<br />
								<small className="opacity-70">{leaf.moduleDisplayName}</small>
							</>
						)}
					</div>
					<small style={{ opacity: 0.7, marginLeft: '1em' }}>
						{presetCount} {presetCount === 1 ? 'preset' : 'presets'}
					</small>
				</div>
			</div>
			<FontAwesomeIcon icon={faArrowRight} className="collapsible-tree-leaf-arrow-icon" />
		</>
	)
})

const PresetGroupHeader = memo(function PresetGroupHeader({
	node,
}: CollapsibleTreeHeaderProps<ConnectionLeafItem, CollectionGroupMeta>) {
	return <span>{node.metadata.label}</span>
})

interface PresetsConnectionListProps {
	presetsDefinitionsStore: PresetDefinitionsStore
	setConnectionId: (connectionId: string) => void
	/** The number of custom presets, or null while still loading */
	customPresetCount: number | null
	openCustomPresets: () => void
}
export const PresetsConnectionList = observer(function PresetsConnectionList({
	presetsDefinitionsStore,
	setConnectionId,
	customPresetCount,
	openCustomPresets,
}: PresetsConnectionListProps) {
	const filterConnection = useCallback(
		(connectionId: string, _connectionInfo: ClientConnectionConfig) => {
			const presets = presetsDefinitionsStore.presets.get(connectionId)
			return !!presets && Object.keys(presets.sections).length > 0
		},
		[presetsDefinitionsStore.presets]
	)

	const { nodes, ungroupedLeaves, allNodeIds } = useConnectionLeafTree(filterConnection)
	const collapseHelper = usePanelCollapseHelper('presets-connections', allNodeIds)

	const hasAnyConnections = nodes.length > 0 || ungroupedLeaves.length > 0

	return (
		<PresetsStoreContext.Provider value={presetsDefinitionsStore}>
			<div>
				<h5>Presets</h5>
				<p>
					Ready made buttons with text, actions and feedback which you can drop onto a button to help you get started
					quickly.
				</p>

				<div className="collapsible-tree mb-2">
					<div
						className="collapsible-tree-leaf-row"
						role="button"
						tabIndex={0}
						onClick={openCustomPresets}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault()
								openCustomPresets()
							}
						}}
					>
						<div className="collapsible-tree-leaf-content">
							<div className="collapsible-tree-leaf-text">
								<div className="flex justify-between items-center w-full">
									<div>
										<span className="collapsible-tree-connection-label">
											<FontAwesomeIcon icon={faStar} className="me-1" />
											Custom
										</span>
										<br />
										<small className="opacity-70">Your own presets, built like any other button</small>
									</div>
									{customPresetCount !== null && (
										<small className="ms-4 opacity-70">
											{customPresetCount} {customPresetCount === 1 ? 'preset' : 'presets'}
										</small>
									)}
								</div>
							</div>
							<FontAwesomeIcon icon={faArrowRight} className="collapsible-tree-leaf-arrow-icon" />
						</div>
					</div>
				</div>

				{!hasAnyConnections ? (
					<div style={{ border: '1px solid #e9e9e9', borderRadius: 5 }}>
						<NonIdealState icon={faLifeRing} text="You have no connections that support presets at the moment." />
					</div>
				) : (
					<CollapsibleTree
						nodes={nodes}
						ungroupedLeaves={ungroupedLeaves}
						ungroupedLabel="Ungrouped Connections"
						collapseHelper={collapseHelper}
						HeaderComponent={PresetGroupHeader}
						LeafComponent={PresetLeaf}
						onLeafClick={(leaf) => setConnectionId(leaf.connectionId)}
					/>
				)}

				<Callout color="warning">
					Not every module provides presets, and you can do a lot more by editing the actions and feedbacks on a button
					manually.
				</Callout>
			</div>
		</PresetsStoreContext.Provider>
	)
})
