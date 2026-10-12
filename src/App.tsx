/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { HeaderHUD } from './components/HeaderHUD';
import { PowerUpTray } from './components/PowerUpTray';
import { GameCanvas } from './components/GameCanvas';
import { LevelSelectModal } from './components/LevelSelectModal';
import { VictoryModal } from './components/VictoryModal';
import { GameOverModal } from './components/GameOverModal';
import { HowToPlayModal } from './components/HowToPlayModal';
import { AndroidAppModal } from './components/AndroidAppModal';
import { TitleMenuModal } from './components/TitleMenuModal';
import { PauseModal } from './components/PauseModal';
import { SettingsModal } from './components/SettingsModal';
import { AchievementsModal } from './components/AchievementsModal';
import { DailyRewardModal } from './components/DailyRewardModal';
import { ShopModal } from './components/ShopModal';
import { BackgroundSparkles } from './components/BackgroundSparkles';

import { usePWAInstall } from './hooks/usePWAInstall';
import { getLevel, LEVELS, calculateStars } from './game/levels';
import { BubbleColor, LevelConfig, PowerUpType, UserProgress } from './game/types';
import {
  loadProgress,
  recordLevelResult,
  saveProgress,
  resetGameProgress,
  canClaimDailyReward,
  claimDailyReward,
  claimAchievement,
  buyPowerUp,
  updateAchievement,
  ACHIEVEMENTS_LIST,
} from './game/storage';
import { sound } from './game/audio';
import {
  subscribeToAuth,
  signInWithGoogle,
  logOutPlayer,
  fetchCloudProgress,
  saveCloudProgress,
  mergeLocalAndCloudProgress,
} from './game/firebase';
import type { User as FirebaseUser } from 'firebase/auth';

export default function App() {
  const [progress, setProgress] = useState<UserProgress>(loadProgress);
  const [currentLevelId, setCurrentLevelId] = useState<number>(() => {
    const saved = loadProgress();
    return Math.min(10000, Math.max(1, saved.unlockedLevel || 1));
  });

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'synced' | 'syncing' | 'offline'>('offline');
  const cloudSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [score, setScore] = useState<number>(0);
  const [movesRemaining, setMovesRemaining] = useState<number>(28);
  const [currentCombo, setCurrentCombo] = useState<number>(1);
  const [coinsEarnedThisRound, setCoinsEarnedThisRound] = useState<number>(0);

  const [currentBubble, setCurrentBubble] = useState<BubbleColor>('green');
  const [nextBubble, setNextBubble] = useState<BubbleColor>('yellow');
  const [activePowerUp, setActivePowerUp] = useState<PowerUpType | null>(null);

  const { install, isInstallable, isInstalled } = usePWAInstall();

  const [activeModal, setActiveModal] = useState<
    | 'none'
    | 'title'
    | 'pause'
    | 'level_select'
    | 'help'
    | 'victory'
    | 'game_over'
    | 'android'
    | 'settings'
    | 'achievements'
    | 'daily_reward'
    | 'shop'
  >('none');

  const [gameOverReason, setGameOverReason] = useState<'out_of_bubbles' | 'ceiling_breach'>(
    'out_of_bubbles'
  );

  const [levelSession, setLevelSession] = useState<number>(0);
  const [victoryStars, setVictoryStars] = useState<number>(1);
  const [victoryScore, setVictoryScore] = useState<number>(0);
  const [victoryBubblesLeft, setVictoryBubblesLeft] = useState<number>(0);

  // Memoize level config by level ID
  const level: LevelConfig = useMemo(() => getLevel(currentLevelId), [currentLevelId]);

  // Derive stars earned during in-game play
  const starsEarned = useMemo(() => {
    return calculateStars(score, level.starThresholds, false);
  }, [score, level.starThresholds]);

  // Initialize bubbles for a level
  const initLevelBubbles = useCallback((lvl: LevelConfig) => {
    const colors = lvl.allowedColors;
    const c1 = colors[Math.floor(Math.random() * colors.length)];
    const c2 = colors[Math.floor(Math.random() * colors.length)];
    setCurrentBubble(c1);
    setNextBubble(c2);
    setActivePowerUp(null);
    setScore(0);
    setMovesRemaining(lvl.bubbleLimit);
    setCurrentCombo(1);
    setCoinsEarnedThisRound(0);
  }, []);

  // Sync audio engine with user settings
  useEffect(() => {
    sound.setSoundMuted(!progress.soundEnabled);
  }, [progress.soundEnabled]);

  useEffect(() => {
    sound.setMusicEnabled(progress.musicEnabled);
    return () => {
      sound.stopAmbientMusic();
    };
  }, [progress.musicEnabled]);

  // Debounced cloud sync helper
  const triggerCloudSync = useCallback(
    (progressToSync: UserProgress, immediate = false) => {
      if (!user?.uid) return;

      if (cloudSyncTimerRef.current) {
        clearTimeout(cloudSyncTimerRef.current);
      }

      setCloudSyncStatus('syncing');

      const doSync = async () => {
        const ok = await saveCloudProgress(user.uid, progressToSync, {
          displayName: user.displayName,
          email: user.email,
          photoURL: user.photoURL,
        });
        setCloudSyncStatus(ok ? 'synced' : 'offline');
      };

      if (immediate) {
        doSync();
      } else {
        cloudSyncTimerRef.current = setTimeout(doSync, 700);
      }
    },
    [user]
  );

  // Google Firebase Auth State Listener & Initial Cloud Sync
  useEffect(() => {
    const unsubscribe = subscribeToAuth(async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        setCloudSyncStatus('syncing');
        try {
          const cloudDoc = await fetchCloudProgress(firebaseUser.uid);
          const local = loadProgress();
          if (cloudDoc) {
            const merged = mergeLocalAndCloudProgress(local, cloudDoc);
            saveProgress(merged);
            setProgress(merged);
            setCurrentLevelId((curr) => Math.max(curr, merged.unlockedLevel));
            await saveCloudProgress(firebaseUser.uid, merged, {
              displayName: firebaseUser.displayName,
              email: firebaseUser.email,
              photoURL: firebaseUser.photoURL,
            });
          } else {
            await saveCloudProgress(firebaseUser.uid, local, {
              displayName: firebaseUser.displayName,
              email: firebaseUser.email,
              photoURL: firebaseUser.photoURL,
            });
          }
          setCloudSyncStatus('synced');
        } catch (e) {
          console.error('Initial cloud sync error:', e);
          setCloudSyncStatus('offline');
        }
      } else {
        setCloudSyncStatus('offline');
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLoginWithGoogle = useCallback(async () => {
    try {
      setCloudSyncStatus('syncing');
      const loggedIn = await signInWithGoogle();
      if (loggedIn) {
        sound.playVictory();
      }
    } catch (err) {
      console.error('Google Sign-in failed:', err);
      setCloudSyncStatus('offline');
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await logOutPlayer();
      // Keep local progress intact in localStorage so stages do NOT lock back to Stage 1!
      setUser(null);
      setCloudSyncStatus('offline');
    } catch (err) {
      console.error('Logout error:', err);
    }
  }, []);

  // Unlock AudioContext on first user interaction for mobile Chrome/Android
  useEffect(() => {
    const handleGesture = () => {
      sound.unlockAudio();
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    };
    window.addEventListener('pointerdown', handleGesture, { passive: true });
    window.addEventListener('keydown', handleGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    };
  }, []);

  // Load level on start or when currentLevelId changes
  useEffect(() => {
    initLevelBubbles(level);
  }, [currentLevelId, level, initLevelBubbles]);

  // Swap bubble handler
  const handleSwapBubbles = useCallback(() => {
    if (activeModal !== 'none') return;
    sound.playSwap();
    setCurrentBubble(nextBubble);
    setNextBubble(currentBubble);
  }, [nextBubble, currentBubble, activeModal]);

  // Power-up selection
  const handleSelectPowerUp = useCallback(
    (type: PowerUpType) => {
      if (activeModal !== 'none') return;
      const count = progress.powerUpInventory[type] || 0;
      if (count <= 0 && activePowerUp !== type) {
        setActiveModal('shop');
        return;
      }

      if (activePowerUp === type) {
        setActivePowerUp(null);
      } else {
        sound.playPowerUpSelect();
        setActivePowerUp(type);
      }
    },
    [progress.powerUpInventory, activePowerUp, activeModal]
  );

  // Consume power-up after firing
  const handleConsumePowerUp = useCallback(() => {
    if (!activePowerUp) return;
    const updated = {
      ...progress,
      powerUpInventory: {
        ...progress.powerUpInventory,
        [activePowerUp]: Math.max(0, (progress.powerUpInventory[activePowerUp] || 0) - 1),
      },
    };

    if (activePowerUp === 'bomb') {
      updated.totalBombsUsed = (updated.totalBombsUsed || 0) + 1;
      updateAchievement('bomb_blast', updated.totalBombsUsed, false);
    } else if (activePowerUp === 'lightning') {
      updated.totalLightningUsed = (updated.totalLightningUsed || 0) + 1;
      updateAchievement('lightning_strike', updated.totalLightningUsed, false);
    }

    setProgress(updated);
    saveProgress(updated);
    triggerCloudSync(updated);
    setActivePowerUp(null);
  }, [activePowerUp, progress, triggerCloudSync]);

  // Earn coins during play
  const handleEarnCoins = useCallback(
    (amount: number) => {
      setProgress((prev) => {
        const newCoins = prev.coins + amount;
        const updated = { ...prev, coins: newCoins };
        saveProgress(updated);
        triggerCloudSync(updated);
        return updated;
      });
      setCoinsEarnedThisRound((c) => c + amount);
    },
    [triggerCloudSync]
  );

  // Track popped bubbles
  const handleBubblesPoppedCount = useCallback((count: number) => {
    setProgress((prev) => {
      const total = (prev.totalBubblesPopped || 0) + count;
      updateAchievement('first_match', 1, false);
      updateAchievement('pop_100', total, false);
      updateAchievement('pop_500', total, false);
      const updated = { ...prev, totalBubblesPopped: total };
      saveProgress(updated);
      triggerCloudSync(updated);
      return updated;
    });
  }, [triggerCloudSync]);

  // Track combos & trigger celebratory floating multiplier above game canvas
  const [comboMultiplierPopup, setComboMultiplierPopup] = useState<{
    id: number;
    text: string;
    multiplier: string;
    combo: number;
  } | null>(null);

  const handleComboUpdate = useCallback((combo: number) => {
    setCurrentCombo(combo);
    if (combo >= 3) {
      updateAchievement('combo_3', combo, false);
      // Combo 3 awards x2 multiplier, combo 4 awards x3 multiplier, etc.
      const mult = combo === 3 ? 'x2' : combo === 4 ? 'x3' : `x${combo - 1}`;
      setComboMultiplierPopup({
        id: Date.now(),
        text: `COMBO ${combo}!`,
        multiplier: mult,
        combo,
      });
    } else {
      setComboMultiplierPopup(null);
    }
    if (combo >= 5) {
      updateAchievement('combo_5', combo, false);
    }
  }, []);

  useEffect(() => {
    if (!comboMultiplierPopup) return;
    const timer = setTimeout(() => {
      setComboMultiplierPopup(null);
    }, 1800);
    return () => clearTimeout(timer);
  }, [comboMultiplierPopup]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeModal !== 'none') {
        if (e.key === 'Escape') setActiveModal('none');
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        handleSwapBubbles();
      } else if (e.key === '1') {
        handleSelectPowerUp('bomb');
      } else if (e.key === '2') {
        handleSelectPowerUp('fireball');
      } else if (e.key === '3') {
        handleSelectPowerUp('rainbow');
      } else if (e.key === '4') {
        handleSelectPowerUp('lightning');
      } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        setActiveModal('pause');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal, handleSwapBubbles, handleSelectPowerUp, activePowerUp]);

  // Reset game progress to clean first-time player state
  const handleResetProgress = useCallback(() => {
    const fresh = resetGameProgress();
    setProgress(fresh);
    triggerCloudSync(fresh, true);
    setCurrentLevelId(1);
    setLevelSession((s) => s + 1);
    initLevelBubbles(getLevel(1));
    sound.playBomb();
  }, [initLevelBubbles, triggerCloudSync]);

  // Sound mute toggle
  const handleToggleSound = () => {
    const updated = { ...progress, soundEnabled: !progress.soundEnabled };
    setProgress(updated);
    saveProgress(updated);
    triggerCloudSync(updated);
  };

  // Music toggle
  const handleToggleMusic = () => {
    const updated = { ...progress, musicEnabled: !progress.musicEnabled };
    setProgress(updated);
    saveProgress(updated);
    triggerCloudSync(updated);
  };

  // Restart current level
  const handleRestartLevel = useCallback(() => {
    setActiveModal('none');
    setLevelSession((s) => s + 1);
    initLevelBubbles(level);
  }, [initLevelBubbles, level]);

  // Victory callback
  const handleVictory = useCallback(
    (finalScore: number, bubblesLeft: number) => {
      const stars = calculateStars(finalScore, level.starThresholds, true);
      setVictoryStars(stars);
      setVictoryScore(finalScore);
      setVictoryBubblesLeft(bubblesLeft);

      const { progress: updated, coinsEarned } = recordLevelResult(
        level.id,
        finalScore,
        stars
      );
      const totalCoins = coinsEarned + bubblesLeft * 5;
      updated.coins += bubblesLeft * 5;
      saveProgress(updated);
      triggerCloudSync(updated, true);

      setCoinsEarnedThisRound(totalCoins);
      setProgress(updated);
      setActiveModal('victory');
    },
    [level, triggerCloudSync]
  );

  // Game over callback
  const handleGameOver = useCallback(
    (reason: 'out_of_bubbles' | 'ceiling_breach') => {
      setGameOverReason(reason);
      setActiveModal('game_over');
    },
    []
  );

  // Go to next level
  const handleNextLevel = useCallback(() => {
    if (level.id >= 10000) {
      setActiveModal('level_select');
      return;
    }
    const nextId = Math.min(10000, level.id + 1);
    setCurrentLevelId(nextId);
    setLevelSession((s) => s + 1);
    setActiveModal('none');
  }, [level.id]);

  // Select specific level from stage modal
  const handleSelectLevel = useCallback(
    (lvlId: number) => {
      if (lvlId === currentLevelId) {
        setLevelSession((s) => s + 1);
        initLevelBubbles(level);
      } else {
        setCurrentLevelId(lvlId);
        setLevelSession((s) => s + 1);
      }
      setActiveModal('none');
    },
    [currentLevelId, level, initLevelBubbles]
  );

  // Advance bubble queue
  const handleAdvanceBubble = useCallback(
    (newCurrent: BubbleColor, newNext: BubbleColor) => {
      setCurrentBubble(newCurrent);
      setNextBubble(newNext);
    },
    []
  );

  // Claim Daily Gift
  const handleClaimDailyReward = () => {
    const res = claimDailyReward();
    if (res) {
      sound.playCoin();
      setProgress(res.progress);
      triggerCloudSync(res.progress, true);
    }
  };

  // Claim Achievement
  const handleClaimAchievement = (achId: string) => {
    const res = claimAchievement(achId);
    if (res) {
      sound.playAchievement();
      setProgress(res.progress);
      triggerCloudSync(res.progress, true);
    }
  };

  // Buy power-up from shop
  const handleBuyPowerUp = (type: PowerUpType) => {
    const res = buyPowerUp(type);
    if (res.success) {
      sound.playPurchase();
      setProgress(res.progress);
      triggerCloudSync(res.progress, true);
    }
  };

  // Count unclaimed achievements
  const unclaimedAchievementsCount = ACHIEVEMENTS_LIST.filter((a) => {
    const state = progress.achievements[a.id];
    return state && state.unlocked && !state.claimed;
  }).length;

  const canClaimDaily = canClaimDailyReward(progress);
  const highScore = progress.levelHighScores[level.id] || 0;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100 select-none safe-top safe-bottom relative">
      {/* Ambient Adventure World Sparkles */}
      <BackgroundSparkles reducedMotion={progress.reducedMotion} />

      {/* Top HUD */}
      <HeaderHUD
        currentLevel={level}
        score={score}
        highScore={highScore}
        movesRemaining={movesRemaining}
        starsEarned={starsEarned}
        coins={progress.coins}
        soundEnabled={progress.soundEnabled}
        onToggleSound={handleToggleSound}
        onPause={() => setActiveModal('pause')}
        onOpenLevelSelect={() => setActiveModal('level_select')}
        onOpenSettings={() => setActiveModal('settings')}
        onOpenHelp={() => setActiveModal('help')}
        onOpenAndroidApp={() => setActiveModal('android')}
        onOpenMenu={() => setActiveModal('title')}
        isInstallable={isInstallable}
        user={user}
        cloudSyncStatus={cloudSyncStatus}
        onLoginWithGoogle={handleLoginWithGoogle}
        onLogout={handleLogout}
      />

      {/* Main Interactive Stage Area */}
      <main className="w-full h-full flex-1 flex flex-col items-center justify-center relative overflow-hidden p-0">
        {/* Floating Combo Multiplier Animation Above Game Canvas */}
        {comboMultiplierPopup && (
          <div
            key={comboMultiplierPopup.id}
            className="absolute top-2.5 z-30 pointer-events-none flex flex-col items-center animate-combo-float"
          >
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-[0_0_24px_rgba(249,115,22,0.85)] border border-amber-300/80">
              <Sparkles className="w-4 h-4 text-yellow-200 animate-spin" />
              <span className="font-extrabold text-xs uppercase tracking-wider text-amber-100">
                {comboMultiplierPopup.text}
              </span>
              <span className="font-black text-lg text-yellow-200 animate-combo-glow drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                {comboMultiplierPopup.multiplier} MULTIPLIER
              </span>
              <Sparkles className="w-4 h-4 text-yellow-200 animate-spin" />
            </div>
          </div>
        )}

        <GameCanvas
          key={`canvas_lvl_${level.id}_${levelSession}`}
          level={level}
          aimGuideEnabled={progress.aimGuideEnabled}
          screenShakeEnabled={progress.screenShakeEnabled}
          reducedMotion={progress.reducedMotion}
          activePowerUp={activePowerUp}
          currentBubble={currentBubble}
          nextBubble={nextBubble}
          onScoreUpdate={setScore}
          onMovesUpdate={setMovesRemaining}
          onCombosUpdate={handleComboUpdate}
          onEarnCoins={handleEarnCoins}
          onBubblesPoppedCount={handleBubblesPoppedCount}
          onVictory={handleVictory}
          onGameOver={handleGameOver}
          onAdvanceBubble={handleAdvanceBubble}
          onConsumePowerUp={handleConsumePowerUp}
          onSwapBubbles={handleSwapBubbles}
        />
      </main>

      {/* Bottom Power-Ups & Swap Controls */}
      <footer className="w-full">
        <PowerUpTray
          currentBubble={currentBubble}
          nextBubble={nextBubble}
          activePowerUp={activePowerUp}
          inventory={progress.powerUpInventory}
          onSelectPowerUp={handleSelectPowerUp}
          onSwapBubbles={handleSwapBubbles}
          onOpenShop={() => setActiveModal('shop')}
        />
      </footer>

      {/* Modals & Overlays */}
      {activeModal === 'title' && (
        <TitleMenuModal
          progress={progress}
          onPlay={() => setActiveModal('none')}
          onOpenLevelSelect={() => setActiveModal('level_select')}
          onOpenDailyReward={() => setActiveModal('daily_reward')}
          onOpenAchievements={() => setActiveModal('achievements')}
          onOpenShop={() => setActiveModal('shop')}
          onOpenSettings={() => setActiveModal('settings')}
          onOpenHelp={() => setActiveModal('help')}
          onOpenAndroid={() => setActiveModal('android')}
          canClaimDaily={canClaimDaily}
          unclaimedAchievementsCount={unclaimedAchievementsCount}
          user={user}
          cloudSyncStatus={cloudSyncStatus}
          onLoginWithGoogle={handleLoginWithGoogle}
          onLogout={handleLogout}
        />
      )}

      {activeModal === 'pause' && (
        <PauseModal
          level={level}
          soundEnabled={progress.soundEnabled}
          musicEnabled={progress.musicEnabled}
          onResume={() => setActiveModal('none')}
          onRestart={handleRestartLevel}
          onLevelSelect={() => setActiveModal('level_select')}
          onHome={() => setActiveModal('title')}
          onOpenSettings={() => setActiveModal('settings')}
          onToggleSound={handleToggleSound}
          onToggleMusic={handleToggleMusic}
        />
      )}

      {activeModal === 'settings' && (
        <SettingsModal
          progress={progress}
          onUpdateProgress={(updated) => {
            setProgress(updated);
            saveProgress(updated);
            triggerCloudSync(updated);
          }}
          onResetProgress={handleResetProgress}
          onOpenAndroid={() => setActiveModal('android')}
          onClose={() => setActiveModal('none')}
          user={user}
          cloudSyncStatus={cloudSyncStatus}
          onLoginWithGoogle={handleLoginWithGoogle}
          onLogout={handleLogout}
        />
      )}

      {activeModal === 'achievements' && (
        <AchievementsModal
          progress={progress}
          onClaimAchievement={handleClaimAchievement}
          onClose={() => setActiveModal('none')}
        />
      )}

      {activeModal === 'daily_reward' && (
        <DailyRewardModal
          progress={progress}
          onClaimDaily={handleClaimDailyReward}
          onClose={() => setActiveModal('none')}
        />
      )}

      {activeModal === 'shop' && (
        <ShopModal
          progress={progress}
          onBuyPowerUp={handleBuyPowerUp}
          onClose={() => setActiveModal('none')}
        />
      )}

      {activeModal === 'level_select' && (
        <LevelSelectModal
          levels={LEVELS}
          currentLevelId={level.id}
          progress={progress}
          onSelectLevel={handleSelectLevel}
          onClose={() => setActiveModal('none')}
        />
      )}

      {activeModal === 'help' && (
        <HowToPlayModal onClose={() => setActiveModal('none')} />
      )}

      {activeModal === 'android' && (
        <AndroidAppModal
          isInstallable={isInstallable}
          isInstalled={isInstalled}
          onInstall={install}
          onClose={() => setActiveModal('none')}
        />
      )}

      {activeModal === 'victory' && (
        <VictoryModal
          level={level}
          score={victoryScore}
          bubblesLeft={victoryBubblesLeft}
          stars={victoryStars}
          highScore={highScore}
          coinsEarned={coinsEarnedThisRound}
          onNextLevel={handleNextLevel}
          onReplay={handleRestartLevel}
          onLevelSelect={() => setActiveModal('level_select')}
          onOpenShop={() => setActiveModal('shop')}
        />
      )}

      {activeModal === 'game_over' && (
        <GameOverModal
          level={level}
          score={score}
          reason={gameOverReason}
          onRetry={handleRestartLevel}
          onLevelSelect={() => setActiveModal('level_select')}
        />
      )}
    </div>
  );
}
