import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { List, Divider, Text, Surface, useTheme, IconButton } from 'react-native-paper';
import FavoritesService from './FavoritesService';
import AvailabilityService from '../services/AvailabilityService';
import i18n from '../i18n';

const FavoritesScreen = ({ playStation, currentStation, isPlaying, isAudioLoading, toggleFavorite, favorites: favSet }) => {
    const theme = useTheme();
    const [favorites, setFavorites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [availabilityTrigger, setAvailabilityTrigger] = useState(0);

    useEffect(() => {
        const unsubscribe = AvailabilityService.subscribe(() => {
            setAvailabilityTrigger(prev => prev + 1);
        });
        return () => unsubscribe();
    }, []);

    const onViewableItemsChanged = useCallback(({ viewableItems }) => {
        const stations = viewableItems.map(item => item.item).filter(item => item && item.stationuuid);
        AvailabilityService.updateViewableStations(stations);
    }, []);

    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 50,
        minimumViewTime: 300,
    }).current;

    const loadFavorites = useCallback(async () => {
        setLoading(true);
        const data = await FavoritesService.getFavorites();
        setFavorites(data);
        setLoading(false);
    }, []);

    useEffect(() => {
        loadFavorites();
    }, [loadFavorites, favSet]);

    const handleToggleFavorite = async (station) => {
        await toggleFavorite(station);
    };


    const renderItem = ({ item }) => {
        const isThisStationPlaying = currentStation?.stationuuid === item.stationuuid;

        const status = AvailabilityService.getStatus(item.url_resolved || item.url);
        let statusColor;
        switch (status) {
            case 'online':
                statusColor = '#4CAF50'; // Green
                break;
            case 'offline':
                statusColor = '#F44336'; // Red
                break;
            default:
                statusColor = '#FFC107'; // Yellow
        }

        return (
            <List.Item
                title={item.name}
                description={item.country || i18n.t('unknown_country')}
                onPress={() => playStation(item)}
                left={(props) => (
                    isThisStationPlaying && isAudioLoading ? (
                        <ActivityIndicator {...props} size="small" />
                    ) : (
                        <List.Icon
                            {...props}
                            icon={isThisStationPlaying && isPlaying ? "stop-circle" : "play-circle"}
                            color={isThisStationPlaying ? theme.colors.primary : props.color}
                        />
                    )
                )}
                right={(props) => (
                    <View style={styles.rightContainer}>
                        {item.tags && item.tags.trim().length > 0 ? (
                            <View style={styles.tagContainer}>
                                {item.tags.split(',').slice(0, 1).map((tag, index) => {
                                    const trimmedTag = tag.trim();
                                    return trimmedTag.length > 0 ? (
                                        <Surface key={index} style={[styles.tag, { backgroundColor: theme.colors.surfaceVariant }]}>
                                            <Text style={[styles.tagText, { color: theme.colors.onSurfaceVariant }]}>{trimmedTag}</Text>
                                        </Surface>
                                    ) : null;
                                })}
                            </View>
                        ) : null}
                        <View style={[styles.statusIndicator, { backgroundColor: statusColor }]} />
                        <IconButton
                            icon="heart"
                            iconColor={theme.colors.primary}
                            size={20}
                            onPress={() => handleToggleFavorite(item)}
                        />
                    </View>
                )}
            />
        );
    };

    if (loading && favorites.length === 0) {
        return (
            <View style={[styles.container, styles.centered]}>
                <ActivityIndicator animating={true} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            {favorites.length === 0 ? (
                <View style={styles.emptyContainer}>
                    <IconButton icon="heart-outline" size={48} disabled />
                    <Text variant="titleMedium">{i18n.t('no_favorites')}</Text>
                    <Text variant="bodySmall">{i18n.t('add_favorites_hint')}</Text>
                </View>
            ) : (
                <FlatList
                    data={favorites}
                    keyExtractor={(item) => item.stationuuid}
                    renderItem={renderItem}
                    ItemSeparatorComponent={() => <Divider />}
                    contentContainerStyle={[styles.list, currentStation && styles.listWithPanel]}
                    onRefresh={loadFavorites}
                    refreshing={loading}
                    onViewableItemsChanged={onViewableItemsChanged}
                    viewabilityConfig={viewabilityConfig}
                    extraData={availabilityTrigger}
                />
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    centered: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        opacity: 0.6,
    },
    list: {
        paddingBottom: 16,
    },
    listWithPanel: {
        paddingBottom: 160,
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    tagContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 4,
    },
    tag: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        marginLeft: 4,
    },
    tagText: {
        fontSize: 10,
    },
    statusIndicator: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 4,
    },
});

export default FavoritesScreen;
