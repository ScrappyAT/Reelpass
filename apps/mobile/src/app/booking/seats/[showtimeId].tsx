import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Seat, Showtime, SeatMapLayout, Booking, formatNaira } from '@matinee/shared';
import { colors, radii, shadows, spacing } from '../../../theme';
import {
  Text,
  Button,
  SeatMap,
  BottomSheet,
  useToast,
  EmptyState,
} from '../../../components/ui';
import { api, isApiConnectionError } from '../../../services/api';
import { formatShowtimeDate, formatShowtimeTime } from '../../../utils/datetime';

/** Turn an API error envelope or thrown error into an actionable user message. */
function describeBookingError(res: {
  error?: { code?: string; message?: string; details?: unknown };
}): string {
  const code = res.error?.code;
  if (code === 'VALIDATION_ERROR' && Array.isArray(res.error?.details)) {
    const parts = res.error.details as { field: string; message: string }[];
    return parts.map((d) => `${d.field}: ${d.message}`).join('\n');
  }
  if (code === 'UNAUTHORIZED' || code === 'INVALID_TOKEN') {
    return 'Please sign in again to reserve seats.';
  }
  if (code === 'SEAT_UNAVAILABLE') {
    return res.error?.message || 'One of your seats was just taken. Please pick again.';
  }
  return res.error?.message || 'Could not complete reservation.';
}

export default function SeatSelectionScreen() {
  const { showtimeId } = useLocalSearchParams<{ showtimeId: string }>();
  const router = useRouter();
  const { insets } = { insets: useSafeAreaInsets() };
  const { showToast } = useToast();

  const [layout, setLayout] = useState<SeatMapLayout | null>(null);
  const [showtime, setShowtime] = useState<Showtime | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reserving, setReserving] = useState(false);
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);
  const [showSuccessSheet, setShowSuccessSheet] = useState(false);

  useEffect(() => {
    const fetchSeatLayout = async () => {
      if (!showtimeId) return;
      try {
        const [seatsRes, stRes] = await Promise.all([
          api.getShowtimeSeats(showtimeId),
          api.getShowtimeById(showtimeId),
        ]);

        if (seatsRes.success && seatsRes.data) {
          setLayout(seatsRes.data);
        } else if (!seatsRes.success) {
          setLoadError(seatsRes.error?.message || 'Could not load this seat map.');
        }
        if (stRes.success && stRes.data) {
          setShowtime(stRes.data);
        }
      } catch (e: any) {
        console.warn('Failed to load seats:', e);
        setLoadError(
          isApiConnectionError(e)
            ? e.message
            : 'Could not load the seating configuration for this auditorium.'
        );
      } finally {
        setLoading(false);
      }
    };

    fetchSeatLayout();
  }, [showtimeId]);

  const handleToggleSeat = (seat: Seat) => {
    const isAlreadySelected = selectedSeats.some((s) => s.id === seat.id);

    if (isAlreadySelected) {
      setSelectedSeats(selectedSeats.filter((s) => s.id !== seat.id));
    } else {
      if (selectedSeats.length >= 8) {
        showToast({
          title: 'Seat Limit',
          message: 'You can reserve a maximum of 8 seats per booking.',
          type: 'gold',
        });
        return;
      }
      setSelectedSeats([...selectedSeats, seat]);
    }
  };

  const totalPrice = selectedSeats.reduce((sum, s) => sum + s.price, 0);

  const handleReserve = async () => {
    if (selectedSeats.length === 0) {
      showToast({
        title: 'Select Seats',
        message: 'Please choose at least one seat to proceed.',
        type: 'error',
      });
      return;
    }

    if (reserving) return; // Guard against double-tap duplicate submissions

    setReserving(true);
    try {
      const res = await api.createBooking(
        showtimeId,
        selectedSeats.map((s) => s.id)
      );

      if (res.success && res.data) {
        setCreatedBooking(res.data);
        setShowSuccessSheet(true);
      } else {
        // If conflict or seat unavailable, refresh layout immediately to show latest seat status
        api.getShowtimeSeats(showtimeId).then((seatsRes) => {
          if (seatsRes.success && seatsRes.data) {
            setLayout(seatsRes.data);
          }
        }).catch(() => {});
        setSelectedSeats([]);
        showToast({
          title: 'Reservation Conflict',
          message: describeBookingError(res),
          type: 'error',
        });
      }
    } catch (err: any) {
      showToast({
        title: isApiConnectionError(err) ? 'Backend Unavailable' : 'Error',
        message: isApiConnectionError(err)
          ? err.message
          : err.message || 'Booking failed.',
        type: 'error',
      });
    } finally {
      setReserving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.gold} />
        <Text variant="body" color="secondary" style={{ marginTop: 12 }}>
          Rendering 300+ seat layout...
        </Text>
      </View>
    );
  }

  if (!layout) {
    return (
      <View style={[styles.container, styles.centered]}>
        <EmptyState
          title="Seat Map Unavailable"
          description={
            loadError ||
            'Could not load the seating configuration for this auditorium.'
          }
          actionTitle="Back"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Header Summary */}
      <View style={styles.header}>
        <View style={styles.headerDetails}>
          <Text variant="h2" numberOfLines={1}>
            {showtime?.movieTitle || 'Movie Screening'}
          </Text>
          <Text variant="caption" color="secondary" numberOfLines={2}>
            {showtime?.cinemaName} • {layout.auditoriumName} • {layout.totalSeats} Seats
          </Text>
        </View>
      </View>

      {/* 300+ Seat Map Grid */}
      <View style={styles.seatMapWrapper}>
        <SeatMap
          seats={layout.seats}
          selectedSeatIds={selectedSeats.map((s) => s.id)}
          onToggleSeat={handleToggleSeat}
          screenType={layout.screenType.toUpperCase()}
        />
      </View>

      {/* Bottom Sticky Action Bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.summaryInfo}>
          <Text variant="micro" color="tertiary">
            {selectedSeats.length > 0
              ? `${selectedSeats.length} SEAT${selectedSeats.length > 1 ? 'S' : ''}: ${selectedSeats
                  .map((s) => s.label)
                  .join(', ')}`
              : 'NO SEATS SELECTED'}
          </Text>
          <Text variant="h2" color="gold">
            {formatNaira(totalPrice)}
          </Text>
        </View>

        <Button
          title={selectedSeats.length > 0 ? `Reserve Seats` : 'Select Seats'}
          onPress={handleReserve}
          loading={reserving}
          disabled={selectedSeats.length === 0}
          variant="primary"
          size="lg"
          style={styles.reserveButton}
          iconTrailing={<Ionicons name="ticket" size={18} color={colors.textInverse} />}
        />
      </View>

      {/* Reservation Confirmation BottomSheet */}
      <BottomSheet
        visible={showSuccessSheet}
        onClose={() => setShowSuccessSheet(false)}
        title="Reservation Summary"
      >
        <View style={styles.modalContent}>
          <View style={styles.successIconCircle}>
            <Ionicons name="time-outline" size={36} color={colors.gold} />
          </View>

          <Text variant="h2" align="center" style={styles.successTitle}>
            Seats Reserved (Payment Pending)
          </Text>

          <Text variant="body" color="secondary" align="center" style={styles.successDescription}>
            Booking Reference:{' '}
            <Text variant="bodyBold" color="gold">
              {createdBooking?.bookingReference || '—'}
            </Text>
          </Text>

          <View style={styles.ticketSummaryBox}>
            <Text variant="caption" color="secondary">
              Cinema:{' '}
              <Text variant="caption" color="primary">
                {createdBooking?.showtime.cinemaName || showtime?.cinemaName || '—'}
              </Text>
            </Text>
            <Text variant="caption" color="secondary">
              When:{' '}
              <Text variant="caption" color="primary">
                {createdBooking
                  ? `${formatShowtimeDate(createdBooking.showtime.startTime)} • ${formatShowtimeTime(createdBooking.showtime.startTime)}`
                  : showtime
                    ? `${formatShowtimeDate(showtime.startTime)} • ${formatShowtimeTime(showtime.startTime)}`
                    : '—'}
              </Text>
            </Text>
            <Text variant="caption" color="secondary">
              Seats:{' '}
              <Text variant="caption" color="primary">
                {(createdBooking?.seats || selectedSeats).map((s) => s.label).join(', ')}
              </Text>
            </Text>
            <Text variant="caption" color="secondary">
              Total Amount:{' '}
              <Text variant="caption" color="gold">
                {formatNaira(createdBooking?.totalAmount ?? totalPrice)}
              </Text>
            </Text>
            <Text variant="caption" color="secondary">
              Status:{' '}
              <Text variant="caption" color="gold">
                Reserved (Payment Pending)
              </Text>
            </Text>
            <Text variant="micro" color="tertiary" style={{ marginTop: 2 }}>
              Your seats are held. Digital admission passes are issued upon payment confirmation in Phase 2.
            </Text>
          </View>

          <View style={styles.modalActions}>
            <Button
              title="View in My Tickets"
              onPress={() => {
                setShowSuccessSheet(false);
                router.replace('/(tabs)/tickets');
              }}
              variant="primary"
              size="md"
            />
            <Button
              title="Done"
              onPress={() => {
                setShowSuccessSheet(false);
                router.replace('/(tabs)');
              }}
              variant="ghost"
              size="sm"
            />
          </View>
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
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  headerDetails: {
    gap: 2,
  },
  seatMapWrapper: {
    flex: 1,
  },
  bottomBar: {
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
  summaryInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  reserveButton: {
    minWidth: 160,
  },
  modalContent: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  successIconCircle: {
    width: 70,
    height: 70,
    borderRadius: radii.round,
    backgroundColor: 'rgba(229, 169, 60, 0.15)',
    borderWidth: 1.5,
    borderColor: colors.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successTitle: {
    marginBottom: spacing.xs,
  },
  successDescription: {
    marginBottom: spacing.lg,
  },
  ticketSummaryBox: {
    width: '100%',
    backgroundColor: colors.surfaceCard,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
    marginBottom: spacing.xl,
  },
  modalActions: {
    width: '100%',
    gap: spacing.sm,
  },
});
