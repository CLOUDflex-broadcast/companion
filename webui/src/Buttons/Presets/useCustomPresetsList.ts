import { useSubscription } from '@trpc/tanstack-react-query'
import type { CustomPresetInfo } from '@companion-app/shared/Model/CustomPresets.js'
import { trpc } from '~/Resources/TRPC.js'

export interface CustomPresetsListState {
	/** The custom presets, or null while still loading */
	list: CustomPresetInfo[] | null
	error: string | null
	retry: () => void
}

/**
 * Subscribe to the list of custom presets
 */
export function useCustomPresetsList(): CustomPresetsListState {
	const sub = useSubscription(trpc.controls.customPresets.list.subscriptionOptions())

	return {
		list: sub.data ?? null,
		error: sub.error ? 'Failed to load custom presets' : null,
		retry: sub.reset,
	}
}
