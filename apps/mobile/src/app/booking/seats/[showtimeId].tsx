import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { Seat, Showtime, SeatMapLayout, Booking, formatNaira } from '@matinee/shared';
import { colors, radii, shadows, spacing } from '../../../theme';
import {
  Text,
  Button,
  Badge,
  SeatMap,
  BottomSheet,
  useToast,
  EmptyState,
  Skeleton,
} from '../../../components/ui';
import { api, isApiConnectionError } from '../../../services/api';
import { formatShowtimeDate, formatShowtimeTime } from '../../../utils/datetime';

type PaymentUiState = 'idle' | 'initializing' | 'checkout_open' | 'verifying' | 'pending' | 'success' | 'failed' | 'cancelled';

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
  const [position, setPosition] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestKey = useRef<{ selection: string; key: string } | null>(null);
  const reservingRef = useRef(false);
  const payingRef = useRef(false);
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);
  const [showSuccessSheet, setShowSuccessSheet] = useState(false);

  // Payment UI flow state
  const [paymentState, setPaymentState] = useState<PaymentUiState>('idle');
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    if (!showtimeId) return;
    let active = true;
    let detailsLoaded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      let nextMs = 5000;
      try {
        const admission = await api.getShowtimeAdmission(showtimeId);
        if (!active) return;
        if (!admission.success || !admission.data) {
          const retry = (admission.error?.details as { retryAfter?: number } | undefined)?.retryAfter;
          if (retry) nextMs = Math.max(nextMs, retry * 1000);
          throw new Error(admission.error?.message || 'The waiting room is unavailable.');
        }
        setPosition(admission.data.position);
        if (!admission.data.admitted) {
          nextMs = admission.data.retryAfter * 1000;
          setLoadError(null);
          return;
        }
        const [seats, details] = await Promise.all([
          api.getShowtimeSeats(showtimeId),
          detailsLoaded ? undefined : api.getShowtimeById(showtimeId),
        ]);
        if (!active) return;
        if (!seats.success || !seats.data) throw new Error(seats.error?.message || 'Could not load the seat map.');
        const updated = seats.data;
        setLoadError(null);
        setLayout(updated);
        const available = new Map(updated.seats.filter(seat => seat.status === 'available').map(seat => [seat.id, seat]));
        setSelectedSeats(previous => {
          const current = previous.flatMap(seat => available.get(seat.id) ?? []);
          return current.length === previous.length && current.every((seat, i) => seat.price === previous[i].price)
            ? previous : current;
        });
        if (details?.data) {
          setShowtime(details.data);
          detailsLoaded = true;
        }
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : 'Could not update seats.');
      } finally {
        if (active) {
          setLoading(false);
          timer = setTimeout(() => void refresh(), nextMs);
        }
      }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [showtimeId, refreshKey]);

  const handleToggleSeat = useCallback((seat: Seat) => {
    setSelectedSeats(previous => previous.some(item => item.id === seat.id)
      ? previous.filter(item => item.id !== seat.id)
      : previous.length < 8 ? [...previous, seat] : previous);
  }, []);

  useEffect(() => {
    if (paymentState === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [paymentState]);

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

    if (reservingRef.current) return;
    reservingRef.current = true;
    setReserving(true);
    try {
      const ids = selectedSeats.map(seat => seat.id);
      const selection = JSON.stringify([showtimeId, [...ids].sort()]);
      if (requestKey.current?.selection !== selection) {
        requestKey.current = { selection, key: 'hold-' + Date.now() + '-' + Math.random().toString(36).slice(2) };
      }
      const res = await api.createBooking(showtimeId, ids, requestKey.current.key);
      if (res.success && res.data) {
        setCreatedBooking(res.data);
        requestKey.current = null;
        setPaymentState('idle');
        setPaymentError(null);
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
      reservingRef.current = false;
      setReserving(false);
    }
  };

  const applyPaymentStatus = (booking: Booking) => {
    setCreatedBooking(booking);
    if (booking.status === 'confirmed' && booking.paymentStatus === 'successful') {
      setPaymentState('success');
    } else if (booking.status === 'cancelled' || booking.status === 'expired') {
      setPaymentState('cancelled');
      setPaymentError('This reservation has ended. Any late payment is reviewed for refund.');
    } else {
      setPaymentState('pending');
    }
  };

  const handlePayNow = async () => {
    if (createdBooking?.status !== 'pending' || payingRef.current) return;
    payingRef.current = true;
    setPaymentState('initializing');
    setPaymentError(null);
    try {
      const checkout = await api.initializePayment(createdBooking.id);
      if (!checkout.success || !checkout.data?.link) {
        setPaymentState(checkout.success ? 'pending' : 'failed');
        setPaymentError(checkout.error?.message || 'Checkout is being prepared. Check the status before trying again.');
        return;
      }
      setPaymentState('checkout_open');
      const result = await WebBrowser.openAuthSessionAsync(checkout.data.link, 'mobile://payment-complete');
      setPaymentState('verifying');
      const status = result.type === 'success'
        ? await api.verifyPayment({ bookingId: createdBooking.id, reference: checkout.data.reference })
        : await api.getPaymentStatus(createdBooking.id);
      if (!status.success || !status.data) throw new Error(status.error?.message || 'Payment status is unavailable.');
      applyPaymentStatus(status.data.booking);
    } catch (error) {
      setPaymentState('failed');
      setPaymentError(error instanceof Error ? error.message : 'Payment status is unavailable.');
    } finally { payingRef.current = false; }
  };

  const handleCheckStatus = async () => {
    if (!createdBooking || payingRef.current) return;
    payingRef.current = true;
    setPaymentState('verifying');
    setPaymentError(null);
    try {
      const status = await api.getPaymentStatus(createdBooking.id);
      if (!status.success || !status.data) throw new Error(status.error?.message || 'Payment status is unavailable.');
      applyPaymentStatus(status.data.booking);
    } catch (error) {
      setPaymentState('failed');
      setPaymentError(error instanceof Error ? error.message : 'Could not check payment status.');
    } finally { payingRef.current = false; }
  };

  const handleRelease = async () => {
    if (createdBooking?.status !== 'pending' || payingRef.current) return;
    payingRef.current = true;
    try {
      const result = await api.cancelBooking(createdBooking.id);
      if (!result.success) throw new Error(result.error?.message || 'Could not release this reservation.');
      setCreatedBooking(null);
      setSelectedSeats([]);
      setShowSuccessSheet(false);
      setRefreshKey(key => key + 1);
    } catch (error) {
      showToast({ title: 'Reservation status', message: error instanceof Error ? error.message : 'Please try again.', type: 'error' });
    } finally { payingRef.current = false; }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Skeleton width="80%" height={200} />
        <Text variant="body" style={{ marginTop: spacing.md }}>Loading seats…</Text>
      </View>
    );
  }

  if (position > 0 && !showSuccessSheet) {
    return (
      <View style={[styles.container, styles.centered]}>
        <EmptyState title="Waiting room" description={'You are number ' + position + ' in line. Your position updates automatically.'}
          actionTitle="Back to showtimes" onAction={() => router.back()} />
        {loadError && <Text variant="caption" color="warning">{loadError}</Text>}
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
          actionTitle="Try again"
          onAction={() => { setLoading(true); setRefreshKey(key => key + 1); }}
        />
      </View>
    );
  }

  const activeBooking = createdBooking;

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

      {loadError && <Text variant="caption" color="warning" style={{ padding: spacing.md }}>{loadError}</Text>}

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
          <Text variant="caption">Seat subtotal · up to 8 seats</Text>
        </View>

        <Button
          title={selectedSeats.length > 0 ? `Reserve Seats` : 'Select Seats'}
          onPress={handleReserve}
          loading={reserving}
          disabled={selectedSeats.length === 0 || Boolean(loadError)}
          variant="primary"
          size="lg"
          style={styles.reserveButton}
          iconTrailing={<Ionicons name="ticket" size={18} color={colors.textInverse} />}
        />
      </View>

      {/* Booking & Flutterwave Payment BottomSheet */}
      <BottomSheet
        visible={showSuccessSheet}
        onClose={() => {
          if (paymentState === 'initializing' || paymentState === 'verifying') return;
          setShowSuccessSheet(false);
        }}
        title={
          paymentState === 'success'
            ? 'Admission Confirmed'
            : paymentState === 'verifying' || paymentState === 'initializing'
              ? 'Payment Processing'
              : paymentState === 'failed' || paymentState === 'cancelled'
                ? 'Payment Status'
                : 'Booking Summary'
        }
      >
        <View style={styles.modalContent}>
          {/* STATE 1: VERIFYING / INITIALIZING */}
          {(paymentState === 'initializing' || paymentState === 'verifying' || paymentState === 'checkout_open') && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.gold} />
              <Text variant="h2" align="center" style={{ marginTop: spacing.md }}>
                {paymentState === 'initializing'
                  ? 'Connecting to Flutterwave...'
                  : paymentState === 'checkout_open'
                    ? 'Awaiting Payment...'
                    : 'Verifying Transaction...'}
              </Text>
              <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xs }}>
                Securing your seat reservation with Flutterwave Standard Checkout (NGN).
              </Text>
            </View>
          )}

          {paymentState === 'pending' && (
            <View style={styles.modalActions}>
              <Badge label="CONFIRMATION PENDING" variant="warning" />
              <Text variant="body">{paymentError || 'Your ticket will appear after Flutterwave confirms the payment.'}</Text>
              <Button title="Check payment status" onPress={handleCheckStatus} />
              <Button title="Open checkout" onPress={handlePayNow} variant="outline" />
              <Button title="Release seats" onPress={handleRelease} variant="ghost" />
            </View>
          )}

          {/* STATE 2: SUCCESS */}
          {paymentState === 'success' && activeBooking && (
            <Animated.View entering={FadeInDown.duration(240)} style={styles.modalContent}>
              <View style={styles.successIconCircle}>
                <Ionicons name="checkmark-circle" size={42} color={colors.gold} />
              </View>

              <Badge label="PAYMENT SUCCESSFUL" variant="success" />

              <Text variant="h2" align="center" style={styles.successTitle}>
                Booking Confirmed!
              </Text>

              <Text variant="body" color="secondary" align="center" style={styles.successDescription}>
                Reference:{' '}
                <Text variant="bodyBold" color="gold">
                  {activeBooking.bookingReference}
                </Text>
              </Text>

              {/* Digital QR Code Pass */}
              <View style={styles.qrContainer}>
                <View style={styles.qrWhiteBox}>
                  <QRCode
                    value={activeBooking.qrCode || `REELPASS-BOOKING-${activeBooking.bookingReference}`}
                    size={150}
                    color="#000000"
                    backgroundColor="#FFFFFF"
                  />
                </View>
                <Text variant="micro" color="tertiary" align="center" style={{ marginTop: spacing.xs }}>
                  Scan at auditorium checkpoint for admission
                </Text>
              </View>

              <View style={styles.ticketSummaryBox}>
                <Text variant="caption" color="secondary">
                  Cinema:{' '}
                  <Text variant="caption" color="primary">
                    {activeBooking.showtime.cinemaName} • {layout.auditoriumName}
                  </Text>
                </Text>
                <Text variant="caption" color="secondary">
                  When:{' '}
                  <Text variant="caption" color="primary">
                    {formatShowtimeDate(activeBooking.showtime.startTime)} • {formatShowtimeTime(activeBooking.showtime.startTime)}
                  </Text>
                </Text>
                <Text variant="caption" color="secondary">
                  Seats:{' '}
                  <Text variant="caption" color="gold">
                    {activeBooking.seats.map((s) => s.label).join(', ')}
                  </Text>
                </Text>
                <Text variant="caption" color="secondary">
                  Amount Paid:{' '}
                  <Text variant="caption" color="gold">
                    {formatNaira(activeBooking.totalAmount)}
                  </Text>
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
                  iconLeading={<Ionicons name="qr-code" size={16} color={colors.textInverse} />}
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
            </Animated.View>
          )}

          {/* STATE 3: FAILED OR CANCELLED */}
          {(paymentState === 'failed' || paymentState === 'cancelled') && (
            <>
              <View style={[styles.successIconCircle, { borderColor: paymentState === 'cancelled' ? colors.gold : colors.error }]}>
                <Ionicons
                  name={paymentState === 'cancelled' ? 'alert-circle-outline' : 'close-circle-outline'}
                  size={40}
                  color={paymentState === 'cancelled' ? colors.gold : colors.error}
                />
              </View>

              <Badge
                label={paymentState === 'cancelled' ? 'PAYMENT CANCELLED' : 'PAYMENT FAILED'}
                variant={paymentState === 'cancelled' ? 'warning' : 'danger'}
              />

              <Text variant="h2" align="center" style={styles.successTitle}>
                {paymentState === 'cancelled' ? 'Checkout Incomplete' : 'Payment Failed'}
              </Text>

              <Text variant="body" color="secondary" align="center" style={styles.successDescription}>
                {paymentError || 'Your payment was not processed.'}
              </Text>

              <View style={styles.ticketSummaryBox}>
                <Text variant="caption" color="secondary">
                  Reference:{' '}
                  <Text variant="caption" color="gold">
                    {activeBooking?.bookingReference || '—'}
                  </Text>
                </Text>
                <Text variant="caption" color="secondary">
                  Seats:{' '}
                  <Text variant="caption" color="primary">
                    {(activeBooking?.seats || selectedSeats).map((s) => s.label).join(', ')}
                  </Text>
                </Text>
                <Text variant="caption" color="secondary">
                  Amount Due:{' '}
                  <Text variant="caption" color="gold">
                    {formatNaira(activeBooking?.totalAmount ?? totalPrice)}
                  </Text>
                </Text>
                <Text variant="micro" color="tertiary" style={{ marginTop: 2 }}>
                  Check your reservation status before attempting another payment.
                </Text>
              </View>

              <View style={styles.modalActions}>
                <Button
                  disabled={activeBooking?.status !== 'pending'}
                  title="Open checkout"
                  onPress={() => handlePayNow()}
                  variant="primary"
                  size="md"
                  iconLeading={<Ionicons name="refresh" size={16} color={colors.textInverse} />}
                />
                <Button
                  title="Check Payment Status"
                  onPress={handleCheckStatus}
                  variant="outline"
                  size="sm"
                />
                {activeBooking?.status === 'pending' && (
                  <Button title="Release seats" onPress={handleRelease} variant="ghost" size="sm" />
                )}
                <Button
                  title="View in My Tickets"
                  onPress={() => {
                    setShowSuccessSheet(false);
                    router.replace('/(tabs)/tickets');
                  }}
                  variant="ghost"
                  size="sm"
                />
              </View>
            </>
          )}

          {/* STATE 4: IDLE (RESERVED, READY TO PAY) */}
          {paymentState === 'idle' && (
            <>
              <View style={styles.successIconCircle}>
                <Ionicons name="time-outline" size={36} color={colors.gold} />
              </View>

              <Badge label="SEATS RESERVED (PAYMENT PENDING)" variant="warning" />

              <Text variant="h2" align="center" style={styles.successTitle}>
                Reservation Summary
              </Text>

              <Text variant="body" color="secondary" align="center" style={styles.successDescription}>
                Booking Reference:{' '}
                <Text variant="bodyBold" color="gold">
                  {createdBooking?.bookingReference || '—'}
                </Text>
              </Text>

              <View style={styles.ticketSummaryBox}>
                <Text variant="caption" color="secondary">
                  Movie:{' '}
                  <Text variant="caption" color="primary">
                    {showtime?.movieTitle || '—'}
                  </Text>
                </Text>
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
                  Service fee: {formatNaira(createdBooking?.serviceFee ?? 0)}
                </Text>
                <Text variant="caption" color="secondary">
                  Total Payable:{' '}
                  <Text variant="caption" color="gold">
                    {formatNaira(createdBooking?.totalAmount ?? totalPrice)}
                  </Text>
                </Text>
                <Text variant="micro" color="tertiary" style={{ marginTop: 2 }}>
                  Your QR ticket appears after Flutterwave confirms the payment.
                </Text>
              </View>

              <View style={styles.modalActions}>
                <Button
                  title={`Pay with Flutterwave (${formatNaira(createdBooking?.totalAmount ?? totalPrice)})`}
                  onPress={() => handlePayNow()}
                  variant="primary"
                  size="md"
                  iconLeading={<Ionicons name="card-outline" size={18} color={colors.textInverse} />}
                />
                {activeBooking?.status === 'pending' && (
                  <Button title="Release seats" onPress={handleRelease} variant="ghost" size="sm" />
                )}
                <Button
                  title="View in My Tickets"
                  onPress={() => {
                    setShowSuccessSheet(false);
                    router.replace('/(tabs)/tickets');
                  }}
                  variant="ghost"
                  size="sm"
                />
              </View>
            </>
          )}
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
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  successIconCircle: {
    width: 68,
    height: 68,
    borderRadius: radii.round,
    backgroundColor: 'rgba(229, 169, 60, 0.15)',
    borderWidth: 1.5,
    borderColor: colors.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  successTitle: {
    marginTop: spacing.xs,
    marginBottom: spacing.xxs,
  },
  successDescription: {
    marginBottom: spacing.md,
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  qrWhiteBox: {
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketSummaryBox: {
    width: '100%',
    backgroundColor: colors.surfaceCard,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
    marginBottom: spacing.lg,
  },
  modalActions: {
    width: '100%',
    gap: spacing.sm,
  },
});
