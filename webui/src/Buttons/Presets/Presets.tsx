import { observer } from 'mobx-react-lite'
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Grid } from '~/Components/Grid'
import { LoadingRetryOrError } from '~/Resources/Loading.js'
import { RootAppStoreContext } from '~/Stores/RootAppStore.js'
import { CustomPresetsPanel } from './CustomPresets.js'
import { PresetDefinitionsStore, usePresetsDefinitions } from './PresetDefinitionsStore.js'
import { PresetsConnectionList } from './PresetsConnectionList.js'
import { PresetsSectionsList } from './PresetsSectionsList.js'
import { useCustomPresetsList } from './useCustomPresetsList.js'

interface ConnectionPresetsProps {
	resetToken: string
}

export const ConnectionPresets = observer(function ConnectionPresets({ resetToken }: ConnectionPresetsProps) {
	const { connections } = useContext(RootAppStoreContext)

	const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
	const [showCustomPresets, setShowCustomPresets] = useState(false)
	const clearSelectedConnectionId = useCallback(() => {
		setSelectedConnectionId(null)
		setShowCustomPresets(false)
	}, [])
	const openCustomPresets = useCallback(() => {
		setShowCustomPresets(true)
	}, [])

	const customPresets = useCustomPresetsList()

	const presetsDefinitionsStore = useMemo(() => new PresetDefinitionsStore(), [])

	const { isReady, loadError, restartSub } = usePresetsDefinitions(presetsDefinitionsStore)

	// Reset selection on resetToken change
	useEffect(() => {
		setSelectedConnectionId(null)
		setShowCustomPresets(false)
	}, [resetToken])

	if (!isReady) {
		// Show loading or an error
		return (
			<Grid.Row>
				<LoadingRetryOrError error={loadError} dataReady={false} doRetry={restartSub} design="pulse" />
			</Grid.Row>
		)
	}

	if (showCustomPresets) {
		return <CustomPresetsPanel customPresets={customPresets} goBack={clearSelectedConnectionId} />
	} else if (selectedConnectionId) {
		const connectionInfo = connections.getInfo(selectedConnectionId)

		const presets = presetsDefinitionsStore.presets.get(selectedConnectionId)

		return (
			<PresetsSectionsList
				key={selectedConnectionId}
				presets={presets}
				connectionInfo={connectionInfo}
				selectedConnectionId={selectedConnectionId}
				clearSelectedConnectionId={clearSelectedConnectionId}
			/>
		)
	} else {
		return (
			<PresetsConnectionList
				presetsDefinitionsStore={presetsDefinitionsStore}
				setConnectionId={setSelectedConnectionId}
				customPresetCount={customPresets.list?.length ?? null}
				openCustomPresets={openCustomPresets}
			/>
		)
	}
})
