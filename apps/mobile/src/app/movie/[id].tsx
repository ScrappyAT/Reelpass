import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Movie, formatNaira } from '@matinee/shared';
import { colors, radii, shadows, spacing } from '../../theme';
import {
  Text,
  Badge,
  Button,
  Skeleton,
  EmptyState,
} from '../../components/ui';
import { api } from '../../services/api';

const { width: _SCREEN_WIDTH } = Dimensions.get('window');

const BACKUP_POSTER = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80';
const BACKUP_BACKDROP = 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=1200&q=80';

export default function MovieDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [movie, setMovie] = useState<Movie | null>(null);
  const [loading, setLoading] = useState(true);
  const [backdropUri, setBackdropUri] = useState<string>(BACKUP_BACKDROP);
  const [posterUri, setPosterUri] = useState<string>(BACKUP_POSTER);
  const [backdropError, setBackdropError] = useState(false);
  const [posterError, setPosterError] = useState(false);

  useEffect(() => {
    const fetchMovie = async () => {
      if (!id) return;
      try {
        const res = await api.getMovieById(id);
        if (res.success && res.data) {
          setMovie(res.data);
          setBackdropUri(res.data.backdropUrl || res.data.posterUrl || BACKUP_BACKDROP);
          setPosterUri(res.data.posterUrl || BACKUP_POSTER);
        }
      } catch (e) {
        console.warn('Failed to load movie details:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchMovie();
  }, [id]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centeredLoading]}>
        <Skeleton width="100%" height={300} borderRadius={0} />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton width="70%" height={28} />
          <Skeleton width="40%" height={18} />
          <Skeleton width="100%" height={100} />
        </View>
      </View>
    );
  }

  if (!movie) {
    return (
      <View style={[styles.container, styles.centeredLoading]}>
        <EmptyState
          icon="alert-circle-outline"
          title="Movie Not Found"
          description="The screening details for this title could not be retrieved."
          actionTitle="Back to Discover"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Hero Backdrop with Floating Buttons */}
        <View style={styles.heroContainer}>
          {!backdropError ? (
            <Image
              source={{ uri: backdropUri }}
              style={styles.backdropImage}
              contentFit="cover"
              transition={300}
              onError={() => {
                if (backdropUri !== BACKUP_BACKDROP) {
                  setBackdropUri(BACKUP_BACKDROP);
                } else {
                  setBackdropError(true);
                }
              }}
            />
          ) : (
            <View style={[styles.backdropImage, styles.fallbackBackdrop]}>
              <Ionicons name="film" size={48} color={colors.gold} />
            </View>
          )}
          <LinearGradient
            colors={['rgba(11, 11, 15, 0.6)', 'transparent', colors.background]}
            style={styles.backdropGradient}
          />

          {/* Floating Top Actions */}
          <View style={[styles.floatingHeader, { top: insets.top + 10 }]}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.floatingButton}
              accessibilityRole="button"
              accessibilityLabel="Back to previous screen"
            >
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>

            <View style={styles.headerRightActions}>
              <TouchableOpacity
                style={styles.floatingButton}
                accessibilityRole="button"
                accessibilityLabel="Bookmark movie"
              >
                <Ionicons name="bookmark-outline" size={20} color={colors.gold} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.floatingButton}
                accessibilityRole="button"
                accessibilityLabel="Share movie"
              >
                <Ionicons name="share-social-outline" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Movie Meta Card Overlay */}
        <View style={styles.metaSection}>
          <View style={styles.posterRow}>
            {!posterError ? (
              <Image
                source={{ uri: posterUri }}
                style={styles.posterImage}
                contentFit="cover"
                transition={300}
                onError={() => {
                  if (posterUri !== BACKUP_POSTER) {
                    setPosterUri(BACKUP_POSTER);
                  } else {
                    setPosterError(true);
                  }
                }}
              />
            ) : (
              <View style={[styles.posterImage, styles.fallbackPoster]}>
                <Ionicons name="film-outline" size={32} color={colors.gold} />
              </View>
            )}
            <View style={styles.metaDetails}>
              <Text variant="h1" style={styles.movieTitle}>
                {movie.title}
              </Text>
              {movie.tagline && (
                <Text variant="caption" color="gold" style={styles.tagline}>
                  {`"${movie.tagline}"`}
                </Text>
              )}

              <View style={styles.badgesRow}>
                <View style={styles.ratingBadge}>
                  <Ionicons name="star" size={13} color={colors.gold} />
                  <Text variant="caption" color="gold" style={styles.ratingValue}>
                    {movie.rating.toFixed(1)}
                  </Text>
                  <Text variant="micro" color="tertiary">
                    ({movie.voteCount})
                  </Text>
                </View>
                <Badge label={movie.certification || 'PG-13'} variant="outline" />
                <Badge label={`${movie.runtimeMinutes} MIN`} variant="outline" />
              </View>
            </View>
          </View>

          {/* Genre Chips */}
          <View style={styles.genresList}>
            {movie.genres.map((genre) => (
              <Badge key={genre.id} label={genre.name} variant="gold" />
            ))}
          </View>

          {/* Synopsis */}
          <View style={styles.section}>
            <Text variant="h3" style={styles.sectionTitle}>
              Storyline
            </Text>
            <Text variant="body" color="secondary" style={styles.overviewText}>
              {movie.overview}
            </Text>
          </View>

          {/* Premium Formats Info */}
          <View style={styles.formatBox}>
            <View style={styles.formatIcon}>
              <Ionicons name="videocam-outline" size={24} color={colors.gold} />
            </View>
            <View style={styles.formatContent}>
              <Text variant="h3">IMAX with 4K Dual Laser</Text>
              <Text variant="caption" color="secondary">
                Next-generation laser projection and immersive 12-channel surround sound designed specifically for {movie.title}.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Sticky Bottom Booking Bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.priceContainer}>
          <Text variant="micro" color="tertiary">
            STANDARD & VIP FROM
          </Text>
          <Text variant="h2" color="gold">
            {formatNaira(450000)}
          </Text>
        </View>

        <Button
          title="Select Showtimes"
          onPress={() => router.push(`/booking/showtimes/${movie.id}`)}
          variant="primary"
          size="lg"
          style={styles.bookButton}
          iconTrailing={<Ionicons name="arrow-forward" size={18} color={colors.textInverse} />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centeredLoading: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 120,
  },
  heroContainer: {
    width: '100%',
    height: 320,
    position: 'relative',
  },
  backdropImage: {
    width: '100%',
    height: '100%',
  },
  fallbackBackdrop: {
    backgroundColor: '#191926',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdropGradient: {
    ...StyleSheet.absoluteFill,
  },
  floatingHeader: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  floatingButton: {
    width: 40,
    height: 40,
    borderRadius: radii.round,
    backgroundColor: 'rgba(11, 11, 15, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metaSection: {
    paddingHorizontal: spacing.lg,
    marginTop: -60,
  },
  posterRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  posterImage: {
    width: 125,
    height: 185,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.borderGold,
    ...shadows.card,
  },
  fallbackPoster: {
    backgroundColor: '#191926',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaDetails: {
    flex: 1,
    gap: 4,
  },
  movieTitle: {
    lineHeight: 28,
  },
  tagline: {
    fontStyle: 'italic',
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.xs,
    borderWidth: 1,
    borderColor: colors.borderGold,
    gap: 4,
  },
  ratingValue: {
    fontWeight: '700',
  },
  genresList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    marginBottom: spacing.xs,
  },
  overviewText: {
    lineHeight: 22,
  },
  formatBox: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  formatIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: 'rgba(229, 169, 60, 0.15)',
    borderWidth: 1,
    borderColor: colors.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formatContent: {
    flex: 1,
    gap: 2,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...shadows.card,
  },
  priceContainer: {
    gap: 2,
  },
  bookButton: {
    minWidth: 180,
  },
});
