import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, StatusBar, Platform } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Provider as PaperProvider, Appbar, MD3DarkTheme, BottomNavigation, Text, Surface, IconButton, ActivityIndicator, Divider } from 'react-native-paper';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RadioBrowserScreen from './components/RadioBrowserScreen';
import FavoritesScreen from './components/FavoritesScreen';
import FavoritesService from './components/FavoritesService';
import i18n from './i18n';

const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
  },
};

const LAST_STATION_KEY = '@ushki_last_station';
const VOLUME_KEY = '@ushki_volume';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const TAB_BAR_HEIGHT = 80; // Standard React Native Paper BottomNavigation height

  const bottomOffset = insets.bottom + TAB_BAR_HEIGHT + 8; // 8 for additional margin

  const [index, setIndex] = useState(0);
  const [routes] = useState([
    { key: 'search', title: i18n.t('search'), focusedIcon: 'magnify', unfocusedIcon: 'magnify' },
    { key: 'favorites', title: i18n.t('favorites'), focusedIcon: 'heart', unfocusedIcon: 'heart-outline' },
  ]);

  // Global Playback State
  const [currentStation, setCurrentStation] = useState(null);
  const [volume, setVolume] = useState(1.0);

  const player = useAudioPlayer(currentStation ? currentStation.url_resolved : null);
  const status = useAudioPlayerStatus(player);

  const isPlaying = status.playing;
  const isAudioLoading = !status.isLoaded && !!currentStation && !status.error;

  // Global Favorites State
  const [favorites, setFavorites] = useState(new Set());

  const loadFavorites = useCallback(async () => {
    const favs = await FavoritesService.getFavorites();
    setFavorites(new Set(favs.map(f => f.stationuuid)));
  }, []);

  const loadSettingsSource = useCallback(async () => {
    try {
      const savedStation = await AsyncStorage.getItem(LAST_STATION_KEY);
      if (savedStation) {
        setCurrentStation(JSON.parse(savedStation));
      }
      const savedVolume = await AsyncStorage.getItem(VOLUME_KEY);
      if (savedVolume !== null) {
        const vol = parseFloat(savedVolume);
        setVolume(vol);
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  }, []);

  useEffect(() => {
    const setupAudio = async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix',
          shouldRouteThroughEarpiece: false,
          allowsRecording: false,
        });
      } catch (e) {
        console.error('Error setting audio mode:', e);
      }
    };
    setupAudio();
    loadFavorites();
    loadSettingsSource();
  }, [loadFavorites, loadSettingsSource]);

  useEffect(() => {
    if (player && status.isLoaded) {
      try {
        player.volume = volume;
      } catch (e) {
        console.error('Error setting volume in useEffect:', e);
      }
    }
  }, [volume, player, status.isLoaded]);

  useEffect(() => {
    if (player && currentStation) {
      player.setActiveForLockScreen(true, {
        title: currentStation.name,
        artist: 'Ushki Radio',
      }, {
        showSeekForward: false,
        showSeekBackward: false,
      });
      player.play();
    }
  }, [currentStation, player]);

  const toggleFavorite = async (station) => {
    const isFav = favorites.has(station.stationuuid);
    if (isFav) {
      await FavoritesService.removeFavorite(station.stationuuid);
      favorites.delete(station.stationuuid);
    } else {
      await FavoritesService.saveFavorite(station);
      favorites.add(station.stationuuid);
    }
    setFavorites(new Set(favorites));
  };

  const playStation = async (station) => {
    try {
      if (currentStation?.stationuuid === station.stationuuid) {
        togglePlayback();
        return;
      }

      if (player) {
        player.pause();
        player.setActiveForLockScreen(false);
      }

      setCurrentStation(station);

      // Save last played station
      await AsyncStorage.setItem(LAST_STATION_KEY, JSON.stringify(station));

      // Player source will update via hook, we just need to play it
      // However, it might take a moment to load. The hook handles the source change.
      // We can call player.play() but it might need to wait for isLoaded.
      // useAudioPlayer usually starts playing if source changes and it was set to? 
      // Actually let's check if there's a shouldPlay equivalent in the hook.
    } catch (error) {
      console.error('Error playing station:', error);
    }
  };

  const togglePlayback = () => {
    if (!player) return;
    try {
      if (isPlaying) {
        player.pause();
      } else {
        player.play();
      }
    } catch (error) {
      console.error('Error toggling playback:', error);
    }
  };

  const stopPlayback = async () => {
    if (player) {
      player.setActiveForLockScreen(false);
      player.pause();
    }
    setCurrentStation(null);

    // Clear last played station
    await AsyncStorage.removeItem(LAST_STATION_KEY);
  };

  const onVolumeChange = (value) => {
    setVolume(value);
    if (player && status.isLoaded) {
      try {
        player.volume = value;
      } catch (e) {
        console.error('Error setting volume in onVolumeChange:', e);
      }
    }
    try {
      AsyncStorage.setItem(VOLUME_KEY, value.toString());
    } catch (e) {
      console.error('Error saving volume:', e);
    }
  };


  const isCurrentStationFav = currentStation && favorites.has(currentStation.stationuuid);

  return (
    <PaperProvider theme={theme}>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <Appbar.Header elevated>
          <Appbar.Content title={i18n.t('app_name')} />
        </Appbar.Header>

        <View style={styles.content}>
          <BottomNavigation
            navigationState={{ index, routes }}
            onIndexChange={setIndex}
            renderScene={({ route }) => {
              switch (route.key) {
                case 'search':
                  return (
                    <RadioBrowserScreen
                      playStation={playStation}
                      currentStation={currentStation}
                      isPlaying={isPlaying}
                      isAudioLoading={isAudioLoading}
                      favorites={favorites}
                      toggleFavorite={toggleFavorite}
                    />
                  );
                case 'favorites':
                  return (
                    <FavoritesScreen
                      playStation={playStation}
                      currentStation={currentStation}
                      isPlaying={isPlaying}
                      isAudioLoading={isAudioLoading}
                      toggleFavorite={toggleFavorite}
                      favorites={favorites}
                    />
                  );
                default:
                  return null;
              }
            }}
            barStyle={{ backgroundColor: theme.colors.elevation.level2 }}
          />
        </View>

        {currentStation && (
          <Surface style={[styles.bottomPanel, { backgroundColor: theme.colors.surfaceVariant, bottom: bottomOffset }]} elevation={4}>

            <View style={styles.bottomPanelContent}>
              <View style={styles.stationInfo}>
                <Text numberOfLines={1} style={styles.panelTitle}>{currentStation.name}</Text>
                <Text numberOfLines={1} style={styles.panelSubtitle}>{currentStation.country || i18n.t('unknown')}</Text>
              </View>
              <View style={styles.panelActions}>
                <Slider
                  style={styles.volumeSlider}
                  minimumValue={0}
                  maximumValue={1}
                  value={volume}
                  onValueChange={onVolumeChange}
                  minimumTrackTintColor={theme.colors.primary}
                  maximumTrackTintColor="rgba(255,255,255,0.2)"
                  thumbTintColor={theme.colors.primary}
                />
                <IconButton
                  icon={isCurrentStationFav ? "heart" : "heart-outline"}
                  iconColor={isCurrentStationFav ? theme.colors.primary : theme.colors.onSurfaceVariant}
                  size={24}
                  onPress={() => toggleFavorite(currentStation)}
                />
                <Divider style={styles.actionDivider} horizontal />
                {isAudioLoading ? (
                  <ActivityIndicator style={styles.panelLoader} />
                ) : (
                  <IconButton
                    icon={isPlaying ? "stop" : "play"}
                    size={28}
                    onPress={togglePlayback}
                  />
                )}
              </View>
            </View>
          </Surface>
        )}
      </View>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  content: {
    flex: 1,
  },
  bottomPanel: {
    position: 'absolute',
    left: 8,
    right: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 16,
  },
  bottomPanelContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stationInfo: {
    flex: 1,
    marginRight: 8,
  },
  panelTitle: {
    fontWeight: 'bold',
    fontSize: 14,
  },
  panelSubtitle: {
    fontSize: 12,
    opacity: 0.7,
  },
  panelActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  panelLoader: {
    margin: 10,
  },
  actionDivider: {
    width: 1,
    height: '60%',
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: 4,
  },
  volumeSlider: {
    width: '15%',
    minWidth: 60,
    height: 40,
  }
});
