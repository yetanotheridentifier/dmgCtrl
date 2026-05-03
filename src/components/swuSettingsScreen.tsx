import { useUserSettings } from '../hooks/useUserSettings'
import { useFavourites } from '../hooks/useFavourites'
import AppScreenLayout from './layout/AppScreenLayout'
import SwuSettingsScreenView from './swuSettingsScreenView'

interface Props {
  onBack: () => void
  onHelp: () => void
}

function SwuSettingsScreen({ onBack, onHelp }: Props) {
  const {
    useHyperspace,
    enableForceToken,
    enableEpicActions,
    enableWakeLock,
    enableActionLog,
    enableFavourites,
    setUseHyperspace,
    setEnableForceToken,
    setEnableEpicActions,
    setEnableWakeLock,
    setEnableActionLog,
    setEnableFavourites,
  } = useUserSettings()

  const { favourites, removeFavourite, clearFavourites } = useFavourites()

  return (
    <AppScreenLayout>
      <SwuSettingsScreenView
        useHyperspace={useHyperspace}
        enableForceToken={enableForceToken}
        enableEpicActions={enableEpicActions}
        enableWakeLock={enableWakeLock}
        enableFavourites={enableFavourites}
        favourites={favourites}
        onUseHyperspaceChange={setUseHyperspace}
        onEnableForceTokenChange={setEnableForceToken}
        onEnableEpicActionsChange={setEnableEpicActions}
        onEnableWakeLockChange={setEnableWakeLock}
        enableActionLog={enableActionLog}
        onEnableActionLogChange={setEnableActionLog}
        onEnableFavouritesChange={setEnableFavourites}
        onRemoveFavourite={removeFavourite}
        onClearFavourites={clearFavourites}
        onBack={onBack}
        onHelp={onHelp}
      />
    </AppScreenLayout>
  )
}

export default SwuSettingsScreen