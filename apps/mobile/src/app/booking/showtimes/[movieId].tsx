import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Cinema, Showtime, Movie, formatNaira } from '@matinee/shared';
import { colors, radii, shadows, spacing } from '../../../theme';
import {
  Text,
  Card,
  Badge,
  Skeleton,
  EmptyState,
} from '../../../components/ui';
import { api } from '../../../services/api';
import { useLocation, cinemaLocationLabel } from '../../../context/LocationContext';
import { buildLagosDateChips, formatShowtimeTime, getLagosDateKey } from '../../../utils/datetime';

export default function ShowtimeSelectionScreen() {
  const { movieId } = useLocalSearchParams<{ movieId: string }>();
  const router = useRouter();
  const { city, cityCinemas, selectedCinema } = useLocation();

  const [movie, setMovie] = useState<Movie | null>(null);
  const [cinemas, setCinemas] = useState<Cinema[]>([]);
  const [showtimes, setShowtimes] = useState<Showtime[]>([]);
  const [loading, setLoading] = useState(true);

  // Date chips are built from the Africa/Lagos calendar, not the device locale.
  const dateChips = useMemo(() => buildLagosDateChips(4), []);
  const [selectedDate, setSelectedDate] = useState<string>(dateChips[0].id);

  useEffect(() => {
    const loadData = async () => {
      if (!movieId) return;
      try {
        const [movieRes, cinemasRes, showtimesRes] = await Promise.all([
          api.getMovieById(movieId),
          api.getCinemas(),
          api.getShowtimes(movieId),
        ]);

        if (movieRes.success && movieRes.data) setMovie(movieRes.data);
        if (cinemasRes.success && cinemasRes.data) setCinemas(cinemasRes.data);
        if (showtimesRes.success && showtimesRes.data) setShowtimes(showtimesRes.data);
      } catch (e) {
        console.warn('Failed to load showtimes:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [movieId]);

  // Reflect the chosen location: show the selected city's cinemas,
  // with the specifically chosen cinema first.
  const visibleCinemas = useMemo(() => {
    const pool = cityCinemas.length > 0 ? cityCinemas : cinemas;
    const inCity = pool.filter((c) => c.city.toLowerCase() === city.toLowerCase());
    const list = inCity.length > 0 ? inCity : pool;
    return [...list].sort((a, b) => {
      if (selectedCinema && a.id === selectedCinema.id) return -1;
      if (selectedCinema && b.id === selectedCinema.id) return 1;
      return 0;
    });
  }, [cinemas, cityCinemas, city, selectedCinema]);

  const dayShowtimes = useMemo(
    () => showtimes.filter((st) => getLagosDateKey(st.startTime) === selectedDate),
    [showtimes, selectedDate]
  );

  return (
    <View style={styles.container}>
      {/* Movie Quick Summary Bar */}
      {movie && (
        <View style={styles.movieHeader}>
          <View style={styles.movieHeaderDetails}>
            <Text variant="h2" numberOfLines={1}>
              {movie.title}
            </Text>
            <Text variant="caption" color="secondary">
              {movie.runtimeMinutes} min • {movie.genres.map((g) => g.name).join(', ')} • {movie.certification}
            </Text>
          </View>
        </View>
      )}

      {/* Date Selector Chips (Africa/Lagos) */}
      <View style={styles.dateSelectorSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.datesScroll}
        >
          {dateChips.map((d) => {
            const isSelected = selectedDate === d.id;
            return (
              <TouchableOpacity
                key={d.id}
                onPress={() => setSelectedDate(d.id)}
                activeOpacity={0.8}
                style={[
                  styles.datePill,
                  isSelected ? styles.datePillSelected : styles.datePillUnselected,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Date ${d.label} ${d.sublabel}`}
              >
                <Text
                  variant="caption"
                  style={isSelected ? styles.dateTextSelected : styles.dateTextUnselected}
                >
                  {d.label}
                </Text>
                <Text
                  variant="micro"
                  style={isSelected ? styles.dateSubTextSelected : styles.dateSubTextUnselected}
                >
                  {d.sublabel}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Cinema Showtimes List */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.cinemasScroll}
      >
        {loading ? (
          <View style={{ gap: spacing.md }}>
            {[1, 2].map((k) => (
              <Card key={k} padding="lg">
                <Skeleton width="60%" height={20} style={{ marginBottom: 8 }} />
                <Skeleton width="40%" height={14} style={{ marginBottom: 16 }} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Skeleton width={80} height={38} borderRadius={radii.md} />
                  <Skeleton width={80} height={38} borderRadius={radii.md} />
                  <Skeleton width={80} height={38} borderRadius={radii.md} />
                </View>
              </Card>
            ))}
          </View>
        ) : visibleCinemas.length === 0 ? (
          <EmptyState
            title="No Showtimes Found"
            description={`There are no scheduled showtimes in ${city} for this date. Please check back later.`}
          />
        ) : (
          <>
            <Text variant="micro" color="tertiary" style={styles.cityLabel}>
              {city.toUpperCase()} • DEMO CINEMAS
            </Text>
            {visibleCinemas.map((cinema) => {
            const cinemaShowtimes = dayShowtimes.filter((st) => st.cinemaId === cinema.id);
            return (
              <Card key={cinema.id} variant="default" padding="lg" style={styles.cinemaCard}>
                {/* Cinema Info */}
                <View style={styles.cinemaInfoRow}>
                  <View style={{ flex: 1 }}>
                    <Text variant="h3" numberOfLines={2}>
                      {cinema.name}
                    </Text>
                    <View style={styles.locationRow}>
                      <Ionicons name="location-outline" size={13} color={colors.gold} />
                      <Text variant="caption" color="secondary" numberOfLines={2} style={{ flex: 1 }}>
                        {cinemaLocationLabel(cinema)} • {cinema.address}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Amenities Badges */}
                <View style={styles.amenitiesRow}>
                  {cinema.amenities.slice(0, 3).map((amenity) => (
                    <Badge
                      key={amenity}
                      label={amenity.replace('_', ' ').toUpperCase()}
                      variant={amenity === 'imax' ? 'imax' : 'outline'}
                    />
                  ))}
                </View>

                {/* Showtime Pills */}
                <Text variant="micro" color="tertiary" style={styles.showtimesLabel}>
                  SELECT AUDITORIUM & SHOWTIME
                </Text>

                <View style={styles.showtimesGrid}>
                  {cinemaShowtimes.length > 0 ? (
                    cinemaShowtimes.map((st) => {
                      const timeStr = formatShowtimeTime(st.startTime);
                      return (
                        <TouchableOpacity
                          key={st.id}
                          activeOpacity={0.8}
                          onPress={() => router.push(`/booking/seats/${st.id}`)}
                          style={styles.showtimePill}
                          accessibilityRole="button"
                          accessibilityLabel={`Showtime at ${timeStr}, ${st.format}, price ${formatNaira(st.priceStandard)}`}
                        >
                          <Text variant="bodyBold" color="gold" style={styles.showtimeTime}>
                            {timeStr}
                          </Text>
                          <Text variant="micro" color="secondary">
                            {st.format}
                          </Text>
                          <Text variant="caption" color="tertiary" style={styles.showtimePrice}>
                            {formatNaira(st.priceStandard)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })
                  ) : (
                    <Text variant="caption" color="tertiary">
                      No showtimes at this cinema on the selected date.
                    </Text>
                  )}
                </View>
              </Card>
            );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  movieHeader: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  movieHeaderDetails: {
    flex: 1,
    gap: 2,
  },
  dateSelectorSection: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  datesScroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  datePill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
    minWidth: 80,
  },
  datePillUnselected: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  datePillSelected: {
    backgroundColor: colors.gold,
    borderWidth: 1,
    borderColor: colors.goldLight,
    ...shadows.subtle,
  },
  dateTextUnselected: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  dateTextSelected: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  dateSubTextUnselected: {
    color: colors.textTertiary,
  },
  dateSubTextSelected: {
    color: colors.textInverse,
  },
  cinemasScroll: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: 40,
  },
  cityLabel: {
    marginBottom: -spacing.sm,
  },
  cinemaCard: {
    marginBottom: spacing.md,
  },
  cinemaInfoRow: {
    marginBottom: spacing.sm,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  amenitiesRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  showtimesLabel: {
    marginBottom: spacing.sm,
  },
  showtimesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  showtimePill: {
    backgroundColor: colors.surfaceInput,
    borderWidth: 1,
    borderColor: colors.borderGold,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    minWidth: 92,
  },
  showtimeTime: {
    fontSize: 16,
  },
  showtimePrice: {
    fontSize: 11,
    marginTop: 2,
  },
});
