import React, { useState } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Movie } from '@matinee/shared';
import { colors, radii, shadows, spacing } from '../../theme';
import { Text } from './Text';

export type MovieCardVariant = 'poster' | 'backdrop' | 'horizontal';

export interface MovieCardProps {
  movie: Movie;
  onPress: () => void;
  variant?: MovieCardVariant;
  style?: StyleProp<ViewStyle>;
}

const BACKUP_POSTER = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80';
const BACKUP_BACKDROP = 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=1200&q=80';

export const MovieCard: React.FC<MovieCardProps> = ({
  movie,
  onPress,
  variant = 'poster',
  style,
}) => {
  const [posterUri, setPosterUri] = useState<string>(movie.posterUrl || BACKUP_POSTER);
  const [backdropUri, setBackdropUri] = useState<string>(movie.backdropUrl || movie.posterUrl || BACKUP_BACKDROP);
  const [posterError, setPosterError] = useState(false);
  const [backdropError, setBackdropError] = useState(false);

  const handlePress = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // Ignore if haptics unavailable
    }
    onPress();
  };

  const handlePosterError = () => {
    if (posterUri !== BACKUP_POSTER) {
      setPosterUri(BACKUP_POSTER);
    } else {
      setPosterError(true);
    }
  };

  const handleBackdropError = () => {
    if (backdropUri !== BACKUP_BACKDROP) {
      setBackdropUri(BACKUP_BACKDROP);
    } else {
      setBackdropError(true);
    }
  };

  // 1. Wide Backdrop Hero Variant
  if (variant === 'backdrop') {
    return (
      <TouchableOpacity
        activeOpacity={0.88}
        onPress={handlePress}
        style={[styles.backdropCard, style]}
        accessibilityRole="button"
        accessibilityLabel={`${movie.title}, rated ${movie.rating}`}
      >
        {!backdropError ? (
          <Image
            source={{ uri: backdropUri }}
            style={styles.backdropImage}
            contentFit="cover"
            transition={300}
            onError={handleBackdropError}
          />
        ) : (
          <View style={[styles.backdropImage, styles.fallbackContainer]}>
            <Ionicons name="film" size={42} color={colors.gold} />
          </View>
        )}

        <LinearGradient
          colors={['transparent', 'rgba(11, 11, 15, 0.4)', 'rgba(11, 11, 15, 0.95)']}
          style={styles.backdropGradient}
        >
          <View style={styles.backdropBadgeRow}>
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={12} color={colors.gold} />
              <Text variant="caption" color="gold" style={styles.ratingText}>
                {movie.rating.toFixed(1)}
              </Text>
            </View>
            <View style={styles.formatBadge}>
              <Text variant="micro" color="primary">
                {movie.certification || 'PG-13'}
              </Text>
            </View>
          </View>

          <Text variant="h2" numberOfLines={1} style={styles.backdropTitle}>
            {movie.title}
          </Text>
          {movie.tagline && (
            <Text variant="caption" color="secondary" numberOfLines={1}>
              {movie.tagline}
            </Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  // 2. Horizontal Search List Variant
  if (variant === 'horizontal') {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handlePress}
        style={[styles.horizontalCard, style]}
        accessibilityRole="button"
        accessibilityLabel={`${movie.title}, rated ${movie.rating}`}
      >
        {!posterError ? (
          <Image
            source={{ uri: posterUri }}
            style={styles.horizontalImage}
            contentFit="cover"
            transition={300}
            onError={handlePosterError}
          />
        ) : (
          <View style={[styles.horizontalImage, styles.fallbackContainer]}>
            <Ionicons name="film-outline" size={24} color={colors.gold} />
          </View>
        )}

        <View style={styles.horizontalDetails}>
          <View style={styles.horizontalHeader}>
            <Text variant="h3" numberOfLines={1} style={styles.movieTitle}>
              {movie.title}
            </Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={13} color={colors.gold} />
              <Text variant="caption" color="gold" style={styles.ratingText}>
                {movie.rating.toFixed(1)}
              </Text>
            </View>
          </View>

          <Text variant="caption" color="secondary" numberOfLines={2} style={styles.horizontalOverview}>
            {movie.overview}
          </Text>

          <View style={styles.horizontalFooter}>
            <Text variant="caption" color="tertiary">
              {movie.runtimeMinutes} min • {movie.genres.slice(0, 2).map((g) => g.name).join(', ')}
            </Text>
            <View style={styles.badgeCert}>
              <Text variant="micro" color="secondary">
                {movie.certification || 'PG-13'}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  // 3. Default Portrait Poster Card
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={handlePress}
      style={[styles.posterCard, style]}
      accessibilityRole="button"
      accessibilityLabel={`${movie.title}, rated ${movie.rating}`}
    >
      <View style={styles.posterImageWrapper}>
        {!posterError ? (
          <Image
            source={{ uri: posterUri }}
            style={styles.posterImage}
            contentFit="cover"
            transition={300}
            onError={handlePosterError}
          />
        ) : (
          <View style={[styles.posterImage, styles.fallbackContainer]}>
            <Ionicons name="film" size={36} color={colors.gold} />
            <Text variant="micro" color="gold" align="center" style={{ marginTop: 6, paddingHorizontal: 4 }}>
              {movie.title}
            </Text>
          </View>
        )}

        <LinearGradient
          colors={['rgba(0,0,0,0.5)', 'transparent', 'rgba(11, 11, 15, 0.95)']}
          style={styles.posterGradient}
        >
          <View style={styles.topBadgeRow}>
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={11} color={colors.gold} />
              <Text variant="micro" color="gold" style={styles.ratingText}>
                {movie.rating.toFixed(1)}
              </Text>
            </View>
          </View>

          <View style={styles.bottomInfo}>
            <Text variant="bodyBold" numberOfLines={1} style={styles.posterTitle}>
              {movie.title}
            </Text>
            <Text variant="micro" color="secondary" numberOfLines={1}>
              {movie.genres[0]?.name || 'Feature'} • {movie.runtimeMinutes}m
            </Text>
          </View>
        </LinearGradient>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  // Portrait Poster
  posterCard: {
    width: 148,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  posterImageWrapper: {
    width: '100%',
    height: 220,
    position: 'relative',
    backgroundColor: colors.surfaceElevated,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  posterGradient: {
    ...StyleSheet.absoluteFill,
    padding: spacing.sm,
    justifyContent: 'space-between',
  },
  topBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  bottomInfo: {
    gap: 2,
  },
  posterTitle: {
    color: colors.textPrimary,
  },

  // Wide Backdrop Card
  backdropCard: {
    width: 320,
    height: 190,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  backdropImage: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surfaceElevated,
  },
  backdropGradient: {
    ...StyleSheet.absoluteFill,
    padding: spacing.lg,
    justifyContent: 'flex-end',
  },
  backdropBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  backdropTitle: {
    color: colors.textPrimary,
  },

  // Horizontal Card
  horizontalCard: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceCard,
    borderRadius: radii.lg,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.md,
    ...shadows.subtle,
  },
  horizontalImage: {
    width: 80,
    height: 115,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  horizontalDetails: {
    flex: 1,
    marginLeft: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  horizontalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  movieTitle: {
    flex: 1,
    marginRight: spacing.sm,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  horizontalOverview: {
    marginVertical: spacing.xs,
  },
  horizontalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgeCert: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 0.5,
    borderColor: colors.border,
  },

  // Common Badges
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11, 11, 15, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radii.xs,
    borderWidth: 0.5,
    borderColor: 'rgba(229, 169, 60, 0.3)',
    gap: 3,
  },
  ratingText: {
    fontWeight: '700',
  },
  formatBadge: {
    backgroundColor: 'rgba(11, 11, 15, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radii.xs,
    borderWidth: 0.5,
    borderColor: colors.border,
  },

  // Fallback designed container
  fallbackContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#191926',
    borderWidth: 1,
    borderColor: colors.borderGold,
  },
});
