import { useUserSettings } from '../hooks/useUserSettings'
import type { StartScreen } from '../hooks/useUserSettings'
import { useFavourites } from '../hooks/useFavourites'
import { useXwingFavourites } from '../hooks/useXwingFavourites'
import AppScreenLayout from './layout/appScreenLayout'
import SettingsScreenView from './settingsScreenView'
import { onSettingChanged, onFavouriteRemoved, onFavouritesCleared } from '../services/analytics'

type Tab = 'general' | 'swu' | 'xwing'

interface Props {
  onBack: () => void
  onHelp: () => void
  defaultTab?: Tab
}

function SettingsScreen({ onBack, onHelp, defaultTab = 'general' }: Props) {
  const {
    useHyperspace,
    forceTokenDisplay,
    enableEpicActions,
    enableWakeLock,
    enableActionLog,
    enableInitiativeBar,
    enableFavourites,
    enableCompetitiveMode,
    bo1TimerMinutes,
    bo3TimerMinutes,
    xwingTimerMinutes,
    enableXwingPhases,
    enableXwingAlwaysIncDec,
    meleePlayerGuid,
    startScreen,
    setUseHyperspace,
    setForceTokenDisplay,
    setEnableEpicActions,
    setEnableWakeLock,
    setEnableActionLog,
    setEnableInitiativeBar,
    setEnableFavourites,
    setEnableCompetitiveMode,
    setBo1TimerMinutes,
    setBo3TimerMinutes,
    setXwingTimerMinutes,
    setEnableXwingPhases,
    setEnableXwingAlwaysIncDec,
    setMeleePlayerGuid,
    setStartScreen,
  } = useUserSettings()

  const { favourites, removeFavourite, clearFavourites } = useFavourites()
  const { favourites: xwingFavourites, removeFavourite: removeXwingFavourite, clearFavourites: clearXwingFavourites } = useXwingFavourites()

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
      <SettingsScreenView
        defaultTab={defaultTab}
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
        enableInitiativeBar={enableInitiativeBar}
        onEnableInitiativeBarChange={handleSettingChange('enableInitiativeBar', setEnableInitiativeBar)}
        onEnableFavouritesChange={handleSettingChange('enableFavourites', setEnableFavourites)}
        enableCompetitiveMode={enableCompetitiveMode}
        onEnableCompetitiveModeChange={handleSettingChange('enableCompetitiveMode', setEnableCompetitiveMode)}
        bo1TimerMinutes={bo1TimerMinutes}
        bo3TimerMinutes={bo3TimerMinutes}
        xwingTimerMinutes={xwingTimerMinutes}
        enableXwingPhases={enableXwingPhases}
        enableXwingAlwaysIncDec={enableXwingAlwaysIncDec}
        meleePlayerGuid={meleePlayerGuid}
        onBo1TimerChange={setBo1TimerMinutes}
        onBo3TimerChange={setBo3TimerMinutes}
        onXwingTimerChange={setXwingTimerMinutes}
        onEnableXwingPhasesChange={handleSettingChange('enableXwingPhases', setEnableXwingPhases)}
        onEnableXwingAlwaysIncDecChange={handleSettingChange('enableXwingAlwaysIncDec', setEnableXwingAlwaysIncDec)}
        onMeleePlayerGuidChange={setMeleePlayerGuid}
        startScreen={startScreen}
        onStartScreenChange={handleSettingChange<StartScreen>('startScreen', setStartScreen)}
        onRemoveFavourite={handleRemoveFavourite}
        onClearFavourites={handleClearFavourites}
        xwingFavourites={xwingFavourites}
        onRemoveXwingFavourite={removeXwingFavourite}
        onClearXwingFavourites={clearXwingFavourites}
        onBack={onBack}
        onHelp={onHelp}
      />
    </AppScreenLayout>
  )
}

export default SettingsScreen