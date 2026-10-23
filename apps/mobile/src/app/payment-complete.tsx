import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { Booking, formatNaira } from '@matinee/shared';
import { colors, radii, shadows, spacing } from '../theme';
import { Text, Card, Badge, Button, useToast } from '../components/ui';
import { api, isApiConnectionError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { formatShowtimeDate, formatShowtimeTime } from '../utils/datetime';

type CompleteState = 'verifying' | 'success' | 'cancelled' | 'failed';

export default function PaymentCompleteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { token, isLoading: authLoading } = useAuth();

  const params = useLocalSearchParams<{
    status?: string;
    tx_ref?: string;
    txRef?: string;
    reference?: string;
    transaction_id?: string;
    transactionId?: string;
    bookingId?: string;
    booking_id?: string;
  }>();

  const incomingStatus = (params.status || '').toLowerCase();
  const incomingRef = params.tx_ref || params.txRef || params.reference || '';
  const incomingTxId = params.transaction_id || params.transactionId || '';
  const incomingBookingId = params.bookingId || params.booking_id || '';

  const [state, setState] = useState<CompleteState>(() => {
    if (incomingStatus === 'cancelled') return 'cancelled';
    if (incomingStatus === 'failed') return 'failed';
    return 'verifying';
  });

  const [booking, setBooking] = useState<Booking | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasAttemptedVerify, setHasAttemptedVerify] = useState(false);

  // Perform server-side payment verification
  const verifyPayment = useCallback(async () => {
    if (!incomingRef && !incomingTxId && !incomingBookingId) {
      setState('failed');
      setErrorMessage('No transaction reference or booking ID was received from the payment gateway.');
      return;
    }

    setState('verifying');
    setErrorMessage(null);

    try {
      const res = await api.verifyPayment({
        bookingId: incomingBookingId || undefined,
        reference: incomingRef || undefined,
        transactionId: incomingTxId || undefined,
      });

      if (res.success && res.data?.isConfirmed && res.data.booking) {
        setBooking(res.data.booking);
        setState('success');
      } else if (res.success && !res.data?.isConfirmed) {
        // Payment pending or held without confirmation
        if (incomingStatus === 'cancelled') {
          setState('cancelled');
          setErrorMessage('Payment was cancelled before completion. Your seats remain held.');
        } else {
          setState('failed');
          setErrorMessage(res.error?.message || 'Payment has not been confirmed yet.');
        }
      } else {
        setState('failed');
        setErrorMessage(res.error?.message || 'Payment verification failed. Please check your transaction.');
      }
    } catch (err: any) {
      setState('failed');
      setErrorMessage(
        isApiConnectionError(err)
          ? 'Cannot reach ReelPass servers to verify payment. Check your connection.'
          : err.message || 'Payment verification error occurred.'
      );
    }
  }, [incomingBookingId, incomingRef, incomingTxId, incomingStatus]);

  // Trigger verification once auth session is initialized
  useEffect(() => {
    if (authLoading) return;
    if (hasAttemptedVerify) return;

    // If gateway explicitly told us the user cancelled, honor that state
    if (incomingStatus === 'cancelled') {
      setState('cancelled');
      setErrorMessage('Checkout was closed or cancelled. Your seats remain temporarily held.');
      setHasAttemptedVerify(true);
      return;
    }

    // If gateway explicitly marked failure
    if (incomingStatus === 'failed') {
      setState('failed');
      setErrorMessage('The payment gateway reported a transaction failure. Please retry.');
      setHasAttemptedVerify(true);
      return;
    }

    setHasAttemptedVerify(true);
    verifyPayment();
  }, [authLoading, hasAttemptedVerify, incomingStatus, verifyPayment]);

  // Handle hardware back press on Android
  useEffect(() => {
    const onBackPress = () => {
      if (state === 'success') {
        router.replace('/(tabs)/tickets');
        return true;
      }
      router.replace('/(tabs)');
      return true;
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [state, router]);

  const handleGoToTickets = () => {
    router.replace('/(tabs)/tickets');
  };

  const handleGoHome = () => {
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ================================================================= */}
        {/* STATE 1: VERIFYING */}
        {/* ================================================================= */}
        {state === 'verifying' && (
          <View style={styles.stateWrapper}>
            <View style={styles.iconCircle}>
              <ActivityIndicator size="large" color={colors.gold} />
            </View>

            <Badge label="VERIFYING PAYMENT" variant="warning" />

            <Text variant="h2" align="center" style={styles.title}>
              Confirming Your Booking...
            </Text>

            <Text variant="body" color="secondary" align="center" style={styles.description}>
              Please wait while our server verifies your transaction with Flutterwave and issues your tickets.
            </Text>

            {incomingRef ? (
              <Card variant="default" style={styles.refCard}>
                <Text variant="micro" color="tertiary">
                  TRANSACTION REFERENCE
                </Text>
                <Text variant="bodyBold" color="gold" style={{ marginTop: 2 }}>
                  {incomingRef}
                </Text>
              </Card>
            ) : null}
          </View>
        )}

        {/* ================================================================= */}
        {/* STATE 2: SUCCESS / BOOKING CONFIRMED */}
        {/* ================================================================= */}
        {state === 'success' && booking && (
          <View style={styles.stateWrapper}>
            <View style={[styles.iconCircle, styles.successCircle]}>
              <Ionicons name="checkmark-circle" size={44} color={colors.gold} />
            </View>

            <Badge label="PAYMENT SUCCESSFUL" variant="success" />

            <Text variant="h2" align="center" style={styles.title}>
              Booking Confirmed!
            </Text>

            <Text variant="body" color="secondary" align="center" style={styles.description}>
              Reference:{' '}
              <Text variant="bodyBold" color="gold">
                {booking.bookingReference}
              </Text>
            </Text>

            {/* Digital QR Code Pass */}
            <View style={styles.qrContainer}>
              <View style={styles.qrWhiteBox}>
                <QRCode
                  value={booking.qrCode || `REELPASS-BOOKING-${booking.bookingReference}`}
                  size={160}
                  color="#000000"
                  backgroundColor="#FFFFFF"
                />
              </View>
              <Text variant="micro" color="tertiary" align="center" style={{ marginTop: spacing.xs }}>
                Scan at auditorium checkpoint for admission
              </Text>
            </View>

            {/* Ticket Details Box */}
            <Card variant="default" style={styles.ticketSummaryBox}>
              <View style={styles.summaryRow}>
                <Text variant="caption" color="secondary">
                  Movie:
                </Text>
                <Text variant="bodyBold" color="primary" numberOfLines={1} style={styles.summaryValue}>
                  {booking.showtime?.movieTitle || '—'}
                </Text>
              </View>

              <View style={styles.summaryRow}>
                <Text variant="caption" color="secondary">
                  Cinema:
                </Text>
                <Text variant="bodyBold" color="primary" numberOfLines={1} style={styles.summaryValue}>
                  {booking.showtime?.cinemaName || '—'}
                </Text>
              </View>

              <View style={styles.summaryRow}>
                <Text variant="caption" color="secondary">
                  When:
                </Text>
                <Text variant="bodyBold" color="primary" style={styles.summaryValue}>
                  {booking.showtime?.startTime
                    ? `${formatShowtimeDate(booking.showtime.startTime)} • ${formatShowtimeTime(booking.showtime.startTime)}`
                    : '—'}
                </Text>
              </View>

              <View style={styles.summaryRow}>
                <Text variant="caption" color="secondary">
                  Seats:
                </Text>
                <Text variant="bodyBold" color="gold" style={styles.summaryValue}>
                  {booking.seats?.map((s) => s.label).join(', ') || '—'}
                </Text>
              </View>

              <View style={[styles.summaryRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                <Text variant="caption" color="secondary">
                  Amount Paid:
                </Text>
                <Text variant="bodyBold" color="gold" style={styles.summaryValue}>
                  {formatNaira(booking.totalAmount)}
                </Text>
              </View>
            </Card>

            {/* Action Buttons */}
            <View style={styles.actions}>
              <Button
                title="View in My Tickets"
                onPress={handleGoToTickets}
                variant="primary"
                size="md"
                iconLeading={<Ionicons name="qr-code" size={18} color={colors.textInverse} />}
              />
              <Button
                title="Done (Back to Home)"
                onPress={handleGoHome}
                variant="ghost"
                size="sm"
              />
            </View>
          </View>
        )}

        {/* ================================================================= */}
        {/* STATE 3: CANCELLED */}
        {/* ================================================================= */}
        {state === 'cancelled' && (
          <View style={styles.stateWrapper}>
            <View style={[styles.iconCircle, styles.warningCircle]}>
              <Ionicons name="alert-circle-outline" size={44} color={colors.gold} />
            </View>

            <Badge label="PAYMENT CANCELLED" variant="warning" />

            <Text variant="h2" align="center" style={styles.title}>
              Checkout Incomplete
            </Text>

            <Text variant="body" color="secondary" align="center" style={styles.description}>
              {errorMessage || 'Your checkout was closed or cancelled before completion.'}
            </Text>

            <Card variant="default" style={styles.ticketSummaryBox}>
              <Text variant="caption" color="secondary">
                Your selected seats remain temporarily held in your reservations. You can complete payment at any time before the hold expires.
              </Text>
              {incomingRef ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text variant="micro" color="tertiary">
                    REFERENCE:
                  </Text>
                  <Text variant="bodyBold" color="gold">
                    {incomingRef}
                  </Text>
                </View>
              ) : null}
            </Card>

            <View style={styles.actions}>
              <Button
                title="Complete in My Tickets"
                onPress={handleGoToTickets}
                variant="primary"
                size="md"
                iconLeading={<Ionicons name="card-outline" size={18} color={colors.textInverse} />}
              />
              <Button
                title="Back to Home"
                onPress={handleGoHome}
                variant="ghost"
                size="sm"
              />
            </View>
          </View>
        )}

        {/* ================================================================= */}
        {/* STATE 4: FAILED */}
        {/* ================================================================= */}
        {state === 'failed' && (
          <View style={styles.stateWrapper}>
            <View style={[styles.iconCircle, styles.errorCircle]}>
              <Ionicons name="close-circle-outline" size={44} color={colors.error} />
            </View>

            <Badge label="PAYMENT NOT CONFIRMED" variant="danger" />

            <Text variant="h2" align="center" style={styles.title}>
              Payment Incomplete
            </Text>

            <Text variant="body" color="secondary" align="center" style={styles.description}>
              {errorMessage || 'The payment could not be confirmed. If money was deducted, our customer support team will reconcile or refund your transaction.'}
            </Text>

            <Card variant="default" style={styles.ticketSummaryBox}>
              <Text variant="caption" color="secondary">
                You can retry verification, or inspect your reservation status in My Tickets.
              </Text>
              {incomingRef ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text variant="micro" color="tertiary">
                    TRANSACTION REFERENCE:
                  </Text>
                  <Text variant="bodyBold" color="gold">
                    {incomingRef}
                  </Text>
                </View>
              ) : null}
            </Card>

            <View style={styles.actions}>
              <Button
                title="Retry Verification"
                onPress={verifyPayment}
                variant="primary"
                size="md"
                iconLeading={<Ionicons name="refresh" size={18} color={colors.textInverse} />}
              />
              <Button
                title="Go to My Tickets"
                onPress={handleGoToTickets}
                variant="outline"
                size="sm"
              />
              <Button
                title="Back to Home"
                onPress={handleGoHome}
                variant="ghost"
                size="sm"
              />
            </View>
          </View>
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
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stateWrapper: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successCircle: {
    borderColor: colors.gold,
    backgroundColor: 'rgba(229, 169, 60, 0.1)',
  },
  warningCircle: {
    borderColor: colors.gold,
    backgroundColor: 'rgba(229, 169, 60, 0.1)',
  },
  errorCircle: {
    borderColor: colors.error,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  title: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  description: {
    marginBottom: spacing.lg,
    maxWidth: 320,
  },
  refCard: {
    width: '100%',
    padding: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  qrWhiteBox: {
    padding: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.md,
    ...shadows.card,
  },
  ticketSummaryBox: {
    width: '100%',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  summaryValue: {
    flexShrink: 1,
    textAlign: 'right',
    maxWidth: '65%',
  },
  actions: {
    width: '100%',
    gap: spacing.sm,
  },
});
