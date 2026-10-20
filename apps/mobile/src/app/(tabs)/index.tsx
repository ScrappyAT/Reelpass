import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Movie } from '@matinee/shared';
import { colors, radii, spacing } from '../../theme';
import {
  Text,
  MovieCard,
  Chip,
  Badge,
  SkeletonPoster,
  EmptyState,
  BottomSheet,
} from '../../components/ui';
import { api } from '../../services/api';
import { useLocation, cinemaLocationLabel, SUPPORTED_CITIES } from '../../context/LocationContext';

const GENRES = [
  { id: 'all', label: 'All Movies' },
  { id: 'imax', label: 'IMAX Laser' },
  { id: 'scifi', label: 'Sci-Fi' },
  { id: 'action', label: 'Action' },
  { id: 'drama', label: 'Drama' },
];

export default function DiscoverScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { city, cityCinemas, selectedCinema, selectCity, selectCinema } = useLocation();

  const [movies, setMovies] = useState<Movie[]>([]);
  const [upcoming, setUpcoming] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState('all');
  const [showLocationSheet, setShowLocationSheet] = useState(false);

  const fetchCatalog = async () => {
    try {
      const [nowRes, upRes] = await Promise.all([
        api.getNowPlaying(),
        api.getUpcoming(),
      ]);

      if (nowRes.success && nowRes.data) {
        setMovies(nowRes.data);
      }
      if (upRes.success && upRes.data) {
        setUpcoming(upRes.data);
      }
    } catch (e) {
      console.warn('Failed to load movies:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchCatalog();
  };

  // Filter movies by genre
  const filteredMovies = movies.filter((m) => {
    if (selectedGenre === 'all') return true;
    if (selectedGenre === 'imax') return true;
    if (selectedGenre === 'scifi') return m.genres.some((g) => g.name.toLowerCase().includes('sci'));
    if (selectedGenre === 'action') return m.genres.some((g) => g.name.toLowerCase().includes('action'));
    if (selectedGenre === 'drama') return m.genres.some((g) => g.name.toLowerCase().includes('drama'));
    return true;
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Navigation Bar */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.brandBadge}>
            <Ionicons name="film" size={18} color={colors.gold} />
          </View>
          <View>
            <Text variant="caption" color="gold" style={styles.brandSubtitle}>
              YOUR SEAT. YOUR STORY.
            </Text>
            <Text variant="h2" color="primary" style={styles.brandTitle}>
              REELPASS
            </Text>
          </View>
        </View>

        <View style={styles.topActions}>
          <TouchableOpacity
            onPress={() => router.push('/gallery')}
            style={styles.galleryButton}
            accessibilityRole="button"
            accessibilityLabel="Open design system component gallery"
          >
            <Ionicons name="color-palette-outline" size={20} color={colors.gold} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push('/(tabs)/search')}
            style={styles.searchButton}
            accessibilityRole="button"
            accessibilityLabel="Search movies"
          >
            <Ionicons name="search" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.gold}
          />
        }
      >
        {/* Nigerian City / Cinema Selector Pill */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setShowLocationSheet(true)}
          style={styles.cinemaPill}
          accessibilityRole="button"
          accessibilityLabel={`Selected location: ${
            selectedCinema ? `${selectedCinema.name}, ${cinemaLocationLabel(selectedCinema)}` : `${city}, Nigeria`
          }. Tap to change.`}
        >
          <Ionicons name="location-sharp" size={15} color={colors.gold} />
          <Text variant="caption" color="primary" numberOfLines={1} style={styles.cinemaPillText}>
            {selectedCinema
              ? `${selectedCinema.name} • ${cinemaLocationLabel(selectedCinema)}`
              : `${city}, Nigeria`}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
        </TouchableOpacity>

        {/* Featured Hero Carousel */}
        {loading ? (
          <View style={styles.heroLoading}>
            <SkeletonPoster style={{ width: 320, height: 190 }} />
          </View>
        ) : (
          <View style={styles.heroSection}>
            <FlatList
              data={movies.slice(0, 3)}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => `hero-${item.id}`}
              contentContainerStyle={styles.heroCarousel}
              renderItem={({ item }) => (
                <MovieCard
                  movie={item}
                  variant="backdrop"
                  onPress={() => router.push(`/movie/${item.id}`)}
                  style={styles.heroCard}
                />
              )}
            />
          </View>
        )}

        {/* Genre Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          {GENRES.map((genre) => (
            <Chip
              key={genre.id}
              label={genre.label}
              selected={selectedGenre === genre.id}
              onPress={() => setSelectedGenre(genre.id)}
            />
          ))}
        </ScrollView>

        {/* Now Playing Section */}
        <View style={styles.sectionHeader}>
          <View>
            <Text variant="h2">Now Playing</Text>
            <Text variant="caption" color="secondary">
              High definition sound & laser projection
            </Text>
          </View>
          <Badge label="IN THEATRES" variant="gold" />
        </View>

        {loading ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sliderLoading}>
            {[1, 2, 3].map((k) => (
              <SkeletonPoster key={k} style={{ marginRight: spacing.md }} />
            ))}
          </ScrollView>
        ) : filteredMovies.length === 0 ? (
          <EmptyState
            title="No Screenings Found"
            description="Try selecting a different genre filter to see available titles."
            actionTitle="Reset Filters"
            onAction={() => setSelectedGenre('all')}
          />
        ) : (
          <FlatList
            data={filteredMovies}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => `now-${item.id}`}
            contentContainerStyle={styles.movieSlider}
            renderItem={({ item }) => (
              <MovieCard
                movie={item}
                variant="poster"
                onPress={() => router.push(`/movie/${item.id}`)}
                style={styles.sliderCard}
              />
            )}
          />
        )}

        {/* IMAX Specials Banner */}
        <View style={styles.imaxBanner}>
          <View style={styles.imaxLeft}>
            <Badge label="IMAX LASER 12-CHANNEL" variant="imax" />
            <Text variant="h3" style={styles.imaxTitle}>
              Experience Movies in Full Aspect Ratio
            </Text>
            <Text variant="caption" color="secondary">
              Up to 40% more picture, precision laser alignment, and floor-shaking bass.
            </Text>
          </View>
        </View>

        {/* Upcoming Section */}
        <View style={styles.sectionHeader}>
          <View>
            <Text variant="h2">Coming Soon</Text>
            <Text variant="caption" color="secondary">
              Advance reservations opening shortly
            </Text>
          </View>
        </View>

        <FlatList
          data={upcoming.length > 0 ? upcoming : movies.slice(2, 5)}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => `up-${item.id}`}
          contentContainerStyle={styles.movieSlider}
          renderItem={({ item }) => (
            <MovieCard
              movie={item}
              variant="poster"
              onPress={() => router.push(`/movie/${item.id}`)}
              style={styles.sliderCard}
            />
          )}
        />
      </ScrollView>

      {/* City & Cinema Picker */}
      <BottomSheet
        visible={showLocationSheet}
        onClose={() => setShowLocationSheet(false)}
        title="Choose Your Cinema"
      >
        <View style={styles.locationSheetContent}>
          <Text variant="micro" color="tertiary">
            CITY
          </Text>
          <View style={styles.cityChipsRow}>
            {SUPPORTED_CITIES.map((c) => (
              <Chip
                key={c}
                label={c}
                selected={city === c}
                onPress={() => selectCity(c)}
              />
            ))}
          </View>

          <Text variant="micro" color="tertiary" style={{ marginTop: spacing.md }}>
            CINEMAS IN {city.toUpperCase()} (DEMO)
          </Text>
          <View style={styles.cinemaList}>
            {cityCinemas.map((cinema) => (
              <TouchableOpacity
                key={cinema.id}
                activeOpacity={0.8}
                onPress={() => {
                  selectCinema(cinema.id);
                  setShowLocationSheet(false);
                }}
                style={[
                  styles.cinemaRow,
                  selectedCinema?.id === cinema.id && styles.cinemaRowActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${cinema.name}, ${cinemaLocationLabel(cinema)}`}
              >
                <Ionicons
                  name={selectedCinema?.id === cinema.id ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={selectedCinema?.id === cinema.id ? colors.gold : colors.textTertiary}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyBold" numberOfLines={2}>
                    {cinema.name}
                  </Text>
                  <Text variant="caption" color="secondary" numberOfLines={2}>
                    {cinemaLocationLabel(cinema)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            {cityCinemas.length === 0 && (
              <Text variant="caption" color="secondary" align="center">
                No demo cinemas in {city} yet.
              </Text>
            )}
          </View>

          <Text variant="micro" color="tertiary" style={styles.demoNote}>
            DEMO CINEMAS — FICTIONAL LOCATIONS, NOT REAL PARTNERS
          </Text>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(229, 169, 60, 0.15)',
    borderWidth: 1,
    borderColor: colors.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandSubtitle: {
    letterSpacing: 2,
    fontSize: 9,
    fontWeight: '700',
  },
  brandTitle: {
    letterSpacing: 1.5,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  galleryButton: {
    width: 38,
    height: 38,
    borderRadius: radii.round,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButton: {
    width: 38,
    height: 38,
    borderRadius: radii.round,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  cinemaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.round,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cinemaPillText: {
    maxWidth: 240,
    fontWeight: '600',
  },
  heroSection: {
    marginBottom: spacing.lg,
  },
  heroLoading: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroCarousel: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  heroCard: {
    marginRight: spacing.sm,
  },
  chipsScroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  movieSlider: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sliderCard: {
    marginRight: spacing.md,
  },
  sliderLoading: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  imaxBanner: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: '#161426',
    borderWidth: 1,
    borderColor: 'rgba(229, 169, 60, 0.3)',
  },
  imaxLeft: {
    gap: spacing.xs,
  },
  imaxTitle: {
    marginTop: spacing.xs,
  },
  locationSheetContent: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  cityChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  cinemaList: {
    gap: spacing.xs,
  },
  cinemaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceInput,
  },
  cinemaRowActive: {
    borderColor: colors.borderGold,
    backgroundColor: colors.surfaceElevated,
  },
  demoNote: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
