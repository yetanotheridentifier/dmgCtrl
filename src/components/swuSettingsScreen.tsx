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
    forceTokenDisplay,
    enableEpicActions,
    enableWakeLock,
    enableActionLog,
    enableFavourites,
    enableCompetitiveMode,
    bo1TimerMinutes,
    bo3TimerMinutes,
    setUseHyperspace,
    setForceTokenDisplay,
    setEnableEpicActions,
    setEnableWakeLock,
    setEnableActionLog,
    setEnableFavourites,
    setEnableCompetitiveMode,
    setBo1TimerMinutes,
    setBo3TimerMinutes,
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
        forceTokenDisplay={forceTokenDisplay}
        enableEpicActions={enableEpicActions}
        enableWakeLock={enableWakeLock}
        enableFavourites={enableFavourites}
        favourites={favourites}
        onUseHyperspaceChange={handleSettingChange('useHyperspace', setUseHyperspace)}
        onForceTokenDisplayChange={handleSettingChange('forceTokenDisplay', setForceTokenDisplay)}
        onEnableEpicActionsChange={handleSettingChange('enableEpicActions', setEnableEpicActions)}
        onEnableWakeLockChange={handleSettingChange('enableWakeLock', setEnableWakeLock)}
        enableActionLog={enableActionLog}
        onEnableActionLogChange={handleSettingChange('enableActionLog', setEnableActionLog)}
        onEnableFavouritesChange={handleSettingChange('enableFavourites', setEnableFavourites)}
        enableCompetitiveMode={enableCompetitiveMode}
        onEnableCompetitiveModeChange={handleSettingChange('enableCompetitiveMode', setEnableCompetitiveMode)}
        bo1TimerMinutes={bo1TimerMinutes}
        bo3TimerMinutes={bo3TimerMinutes}
        onBo1TimerChange={setBo1TimerMinutes}
        onBo3TimerChange={setBo3TimerMinutes}
        onRemoveFavourite={handleRemoveFavourite}
        onClearFavourites={handleClearFavourites}
        onBack={onBack}
        onHelp={onHelp}
      />
    </AppScreenLayout>
  )
}

export default SwuSettingsScreen