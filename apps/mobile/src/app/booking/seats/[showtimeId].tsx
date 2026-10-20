import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
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
} from '../../../components/ui';
import { api, isApiConnectionError } from '../../../services/api';
import { formatShowtimeDate, formatShowtimeTime } from '../../../utils/datetime';

type PaymentUiState = 'idle' | 'initializing' | 'checkout_open' | 'verifying' | 'success' | 'failed' | 'cancelled';

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

  // Payment UI flow state
  const [paymentState, setPaymentState] = useState<PaymentUiState>('idle');
  const [paymentError, setPaymentError] = useState<string | null>(null);

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
      setReserving(false);
    }
  };

  const handlePayNow = async (bookingOverride?: Booking) => {
    const targetBooking = bookingOverride || createdBooking;
    if (!targetBooking) return;

    setPaymentState('initializing');
    setPaymentError(null);

    try {
      const initRes = await api.initializePayment(targetBooking.id);
      if (!initRes.success || !initRes.data?.link) {
        setPaymentState('failed');
        setPaymentError(initRes.error?.message || 'Could not initialize payment session.');
        return;
      }

      setPaymentState('checkout_open');
      const checkoutUrl = initRes.data.link;
      const ref = initRes.data.reference;

      // Open in-app browser with redirect intercept for mobile scheme
      const result = await WebBrowser.openAuthSessionAsync(
        checkoutUrl,
        'mobile://payment-complete'
      );

      setPaymentState('verifying');

      let returnedStatus: string | null = null;
      let transactionId: string | undefined;
      let returnedRef = ref;

      if (result.type === 'success' && result.url) {
        try {
          const parsed = new URL(result.url);
          returnedStatus = parsed.searchParams.get('status');
          const txId = parsed.searchParams.get('transaction_id');
          if (txId) transactionId = txId;
          const rRef = parsed.searchParams.get('tx_ref');
          if (rRef) returnedRef = rRef;
        } catch {
          // If URL parsing fails, proceed with stored reference
        }
      }

      // Always perform server-side verification with Flutterwave API
      const verifyRes = await api.verifyPayment({
        bookingId: targetBooking.id,
        reference: returnedRef,
        transactionId,
      });

      if (verifyRes.success && verifyRes.data?.isConfirmed && verifyRes.data.booking) {
        setCreatedBooking(verifyRes.data.booking);
        setPaymentState('success');
      } else {
        if (returnedStatus === 'cancelled' || result.type === 'cancel' || result.type === 'dismiss') {
          setPaymentState('cancelled');
          setPaymentError('Checkout window closed. Your seats are still held. Tap Pay Now to try again.');
        } else {
          setPaymentState('failed');
          setPaymentError(verifyRes.error?.message || 'Payment could not be confirmed. Please check your transaction.');
        }
      }
    } catch (err: any) {
      setPaymentState('failed');
      setPaymentError(err.message || 'Payment processing error occurred.');
    }
  };

  const handleCheckStatus = async () => {
    if (!createdBooking) return;
    setPaymentState('verifying');
    setPaymentError(null);
    try {
      const statusRes = await api.getPaymentStatus(createdBooking.id);
      if (statusRes.success && statusRes.data?.isConfirmed && statusRes.data.booking) {
        setCreatedBooking(statusRes.data.booking);
        setPaymentState('success');
      } else {
        setPaymentState('idle');
        showToast({
          title: 'Payment Pending',
          message: 'Payment has not been completed yet. You can tap Pay Now to proceed.',
          type: 'gold',
        });
      }
    } catch (err: any) {
      setPaymentState('failed');
      setPaymentError(err.message || 'Could not verify payment status.');
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

  const activeBooking = createdBooking;
  const isConfirmed = activeBooking?.status === 'confirmed';

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

          {/* STATE 2: SUCCESS */}
          {paymentState === 'success' && activeBooking && (
            <>
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
            </>
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
                  Seats Held:{' '}
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
                  Your seats remain temporarily reserved. You can retry payment immediately.
                </Text>
              </View>

              <View style={styles.modalActions}>
                <Button
                  title="Retry Payment"
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
                <Button
                  title="Pay Later (View in My Tickets)"
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
                  Total Payable:{' '}
                  <Text variant="caption" color="gold">
                    {formatNaira(createdBooking?.totalAmount ?? totalPrice)}
                  </Text>
                </Text>
                <Text variant="micro" color="tertiary" style={{ marginTop: 2 }}>
                  Pay via Flutterwave Standard Checkout to immediately issue your scannable QR ticket.
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
                <Button
                  title="Pay Later (View in My Tickets)"
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
