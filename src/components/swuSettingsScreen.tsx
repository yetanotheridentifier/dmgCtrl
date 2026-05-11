import { useUserSettings } from '../hooks/useUserSettings'
import { useFavourites } from '../hooks/useFavourites'
import AppScreenLayout from './layout/AppScreenLayout'
import SwuSettingsScreenView from './swuSettingsScreenView'
import { onSettingChanged, onFavouriteRemoved, onFavouritesCleared } from '../services/analytics'

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

  const handleSettingChange = <T,>(name: string, setter: (v: T) => void) => (v: T) => {
    setter(v)
    void onSettingChanged(name, v)
  }

  const handleRemoveFavourite = (key: string) => {
    const fav = favourites.find(f => f.key === key)
    removeFavourite(key)
    if (fav) void onFavouriteRemoved(key, fav.set)
  }

  const handleClearFavourites = () => {
    clearFavourites()
    void onFavouritesCleared()
  }

  return (
    <AppScreenLayout>
      <SwuSettingsScreenView
        useHyperspace={useHyperspace}
        enableForceToken={enableForceToken}
        enableEpicActions={enableEpicActions}
        enableWakeLock={enableWakeLock}
        enableFavourites={enableFavourites}
        favourites={favourites}
        onUseHyperspaceChange={handleSettingChange('useHyperspace', setUseHyperspace)}
        onEnableForceTokenChange={handleSettingChange('enableForceToken', setEnableForceToken)}
        onEnableEpicActionsChange={handleSettingChange('enableEpicActions', setEnableEpicActions)}
        onEnableWakeLockChange={handleSettingChange('enableWakeLock', setEnableWakeLock)}
        enableActionLog={enableActionLog}
        onEnableActionLogChange={handleSettingChange('enableActionLog', setEnableActionLog)}
        onEnableFavouritesChange={handleSettingChange('enableFavourites', setEnableFavourites)}
        onRemoveFavourite={handleRemoveFavourite}
        onClearFavourites={handleClearFavourites}
        onBack={onBack}
        onHelp={onHelp}
      />
    </AppScreenLayout>
  )
}

export default SwuSettingsScreen