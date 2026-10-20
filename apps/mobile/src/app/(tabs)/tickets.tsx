import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import QRCode from 'react-native-qrcode-svg';
import { Booking, formatNaira } from '@matinee/shared';
import { colors, radii, shadows, spacing } from '../../theme';
import {
  Text,
  Card,
  Badge,
  Button,
  BottomSheet,
  EmptyState,
  useToast,
} from '../../components/ui';
import { api, isApiConnectionError } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { formatShowtimeDate, formatShowtimeTime } from '../../utils/datetime';

export default function MyTicketsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, isLoading: authLoading } = useAuth();
  const { showToast } = useToast();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');
  const [selectedTicketBooking, setSelectedTicketBooking] = useState<Booking | null>(null);
  const [payingBookingId, setPayingBookingId] = useState<string | null>(null);
  const [checkingBookingId, setCheckingBookingId] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    try {
      const res = await api.getMyTickets();
      if (res.success && res.data) {
        setBookings(res.data);
        setLoadError(null);
      } else if (!res.success) {
        setLoadError(res.error?.message || 'Could not load your tickets.');
      }
    } catch (e: any) {
      console.warn('Failed to load tickets:', e);
      setLoadError(
        isApiConnectionError(e)
          ? 'Cannot reach ReelPass servers. Check connection to view your tickets.'
          : 'Could not load your tickets.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Fetch whenever screen gains focus or auth token initializes
  useFocusEffect(
    useCallback(() => {
      if (!authLoading) {
        fetchTickets();
      }
    }, [authLoading, fetchTickets])
  );

  useEffect(() => {
    if (!authLoading) {
      fetchTickets();
    }
  }, [authLoading, token, fetchTickets]);

  // Listen for deep link redirects back into the app from checkout
  useEffect(() => {
    const sub = Linking.addEventListener('url', (event) => {
      if (event.url && event.url.includes('payment-complete')) {
        fetchTickets();
      }
    });
    return () => sub.remove();
  }, [fetchTickets]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTickets();
  };

  const handlePayTicket = async (booking: Booking) => {
    setPayingBookingId(booking.id);
    try {
      const initRes = await api.initializePayment(booking.id);
      if (!initRes.success || !initRes.data?.link) {
        showToast({
          title: 'Payment Error',
          message: initRes.error?.message || 'Could not start checkout session.',
          type: 'error',
        });
        return;
      }

      const checkoutUrl = initRes.data.link;
      const ref = initRes.data.reference;

      const result = await WebBrowser.openAuthSessionAsync(
        checkoutUrl,
        'mobile://payment-complete'
      );

      let transactionId: string | undefined;
      let returnedRef = ref;
      if (result.type === 'success' && result.url) {
        try {
          const parsed = new URL(result.url);
          const txId = parsed.searchParams.get('transaction_id');
          if (txId) transactionId = txId;
          const rRef = parsed.searchParams.get('tx_ref');
          if (rRef) returnedRef = rRef;
        } catch {}
      }

      const verifyRes = await api.verifyPayment({
        bookingId: booking.id,
        reference: returnedRef,
        transactionId,
      });

      if (verifyRes.success && verifyRes.data?.isConfirmed && verifyRes.data.booking) {
        showToast({
          title: 'Payment Confirmed',
          message: 'Your contactless QR admission pass is ready!',
          type: 'gold',
        });
        setSelectedTicketBooking(verifyRes.data.booking);
        await fetchTickets();
      } else {
        if (result.type === 'cancel' || result.type === 'dismiss') {
          showToast({
            title: 'Payment Incomplete',
            message: 'Checkout window closed. Your seats remain reserved until expiry.',
            type: 'gold',
          });
        } else {
          showToast({
            title: 'Verification Failed',
            message: verifyRes.error?.message || 'Payment could not be verified.',
            type: 'error',
          });
        }
      }
    } catch (err: any) {
      showToast({
        title: 'Payment Error',
        message: err.message || 'Payment failed.',
        type: 'error',
      });
    } finally {
      setPayingBookingId(null);
    }
  };

  const handleCheckTicketStatus = async (booking: Booking) => {
    setCheckingBookingId(booking.id);
    try {
      const res = await api.getPaymentStatus(booking.id);
      if (res.success && res.data?.isConfirmed && res.data.booking) {
        showToast({
          title: 'Payment Verified',
          message: 'Your booking is confirmed! Pass has been generated.',
          type: 'gold',
        });
        setSelectedTicketBooking(res.data.booking);
        await fetchTickets();
      } else {
        showToast({
          title: 'Status Pending',
          message: 'Payment has not been completed. You can tap Pay Now to proceed.',
          type: 'gold',
        });
      }
    } catch (err: any) {
      showToast({
        title: 'Check Failed',
        message: err.message || 'Could not verify payment status.',
        type: 'error',
      });
    } finally {
      setCheckingBookingId(null);
    }
  };

  // Determine whether a booking is an active upcoming reservation
  const isUpcomingBooking = (b: Booking): boolean => {
    const now = Date.now();
    // Cancelled and explicit expired bookings belong to history
    if (b.status === 'cancelled' || b.status === 'expired') {
      return false;
    }
    // Pending hold reservations that exceeded their hold TTL are expired
    if (b.status === 'pending' && b.expiresAt && new Date(b.expiresAt).getTime() < now) {
      return false;
    }
    // Screening end time (or start time) must not be in the past
    const screeningEndMs = b.showtime?.endTime
      ? new Date(b.showtime.endTime).getTime()
      : new Date(b.showtime?.startTime || 0).getTime();
    return screeningEndMs >= now;
  };

  const upcomingBookings = useMemo(() => bookings.filter(isUpcomingBooking), [bookings]);
  const pastBookings = useMemo(() => bookings.filter((b) => !isUpcomingBooking(b)), [bookings]);
  const displayedBookings = activeTab === 'upcoming' ? upcomingBookings : pastBookings;

  const getStatusPresentation = (b: Booking) => {
    const now = Date.now();
    const isExpiredHold =
      b.status === 'expired' ||
      (b.status === 'pending' && b.expiresAt && new Date(b.expiresAt).getTime() < now);
    const isCancelled = b.status === 'cancelled';
    const isScreeningPast =
      (b.showtime?.endTime
        ? new Date(b.showtime.endTime).getTime()
        : new Date(b.showtime?.startTime || 0).getTime()) < now;

    if (isCancelled) {
      return { label: 'CANCELLED', variant: 'danger' as const, isConfirmed: false, isPending: false, isExpired: false };
    }
    if (isExpiredHold) {
      return { label: 'EXPIRED', variant: 'danger' as const, isConfirmed: false, isPending: false, isExpired: true };
    }
    if (b.status === 'confirmed') {
      if (isScreeningPast) {
        return { label: 'PAST SCREENING', variant: 'outline' as const, isConfirmed: true, isPending: false, isExpired: false };
      }
      return { label: 'CONFIRMED', variant: 'success' as const, isConfirmed: true, isPending: false, isExpired: false };
    }
    return { label: 'RESERVED (PENDING)', variant: 'warning' as const, isConfirmed: false, isPending: true, isExpired: false };
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text variant="h1" style={styles.headerTitle}>
          My Tickets
        </Text>
        <Text variant="body" color="secondary">
          Contactless passes and reservation history
        </Text>

        {/* Tab Switcher */}
        <View style={styles.tabsRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setActiveTab('upcoming')}
            style={[
              styles.tabButton,
              activeTab === 'upcoming' && styles.tabButtonActive,
            ]}
          >
            <Text
              variant="bodyBold"
              color={activeTab === 'upcoming' ? 'gold' : 'secondary'}
            >
              Upcoming ({upcomingBookings.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setActiveTab('past')}
            style={[
              styles.tabButton,
              activeTab === 'past' && styles.tabButtonActive,
            ]}
          >
            <Text
              variant="bodyBold"
              color={activeTab === 'past' ? 'gold' : 'secondary'}
            >
              Past History ({pastBookings.length})
            </Text>
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
        {loading && bookings.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text variant="caption" color="secondary" style={{ marginTop: spacing.sm }}>
              Loading reservations...
            </Text>
          </View>
        ) : displayedBookings.length === 0 ? (
          <EmptyState
            icon={loadError ? 'cloud-offline-outline' : activeTab === 'upcoming' ? 'ticket-outline' : 'time-outline'}
            title={
              loadError
                ? 'Tickets Unavailable'
                : activeTab === 'upcoming'
                  ? 'No Upcoming Reservations'
                  : 'No Past History'
            }
            description={
              loadError ||
              (activeTab === 'upcoming'
                ? "You don't have any upcoming reservations. Check out the latest movies and book your seats now."
                : "You don't have any past reservations or expired tickets yet.")
            }
            actionTitle={activeTab === 'upcoming' ? 'Discover Movies' : undefined}
            onAction={activeTab === 'upcoming' ? () => router.replace('/(tabs)') : undefined}
          />
        ) : (
          displayedBookings.map((booking) => {
            const dateStr = formatShowtimeDate(booking.showtime.startTime);
            const timeStr = formatShowtimeTime(booking.showtime.startTime);
            const statusInfo = getStatusPresentation(booking);

            return (
              <Card
                key={booking.id}
                variant={statusInfo.isConfirmed ? 'goldBorder' : 'default'}
                padding="none"
                style={styles.ticketCard}
              >
                {/* Cinema & Status Strip */}
                <View style={styles.ticketHeaderStrip}>
                  <View style={{ flex: 1, marginRight: spacing.sm }}>
                    <Text variant="caption" color="gold" style={styles.cinemaName} numberOfLines={2}>
                      {booking.showtime.cinemaName}
                    </Text>
                    <Text variant="micro" color="secondary" numberOfLines={2}>
                      {booking.showtime.cinemaNeighborhood
                        ? `${booking.showtime.cinemaNeighborhood}, ${booking.showtime.cinemaCity}`
                        : booking.showtime.cinemaCity}{' '}
                      • {booking.showtime.auditoriumName}
                    </Text>
                  </View>
                  <Badge
                    label={statusInfo.label}
                    variant={statusInfo.variant}
                  />
                </View>

                {/* Main Movie Info */}
                <View style={styles.ticketBody}>
                  <View style={styles.movieDetails}>
                    <Text variant="h2">{booking.showtime.movieTitle}</Text>
                    <Text variant="caption" color="secondary" style={styles.formatLabel}>
                      {booking.showtime.format}
                    </Text>

                    <View style={styles.dateTimeSeatsRow}>
                      <View style={styles.infoCol}>
                        <Text variant="micro" color="tertiary">
                          DATE
                        </Text>
                        <Text variant="bodyBold">{dateStr}</Text>
                      </View>

                      <View style={styles.infoCol}>
                        <Text variant="micro" color="tertiary">
                          TIME
                        </Text>
                        <Text variant="bodyBold" color="gold">
                          {timeStr}
                        </Text>
                      </View>

                      <View style={styles.infoCol}>
                        <Text variant="micro" color="tertiary">
                          SEATS
                        </Text>
                        <Text variant="bodyBold" color="gold">
                          {booking.seats.map((s) => s.label).join(', ')}
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* Perforated Divider */}
                <View style={styles.perforatedLine} />

                {/* Footer Action */}
                <View style={styles.ticketFooter}>
                  <View>
                    <Text variant="micro" color="tertiary">
                      BOOKING REF
                    </Text>
                    <Text variant="caption" color="primary" style={styles.refText}>
                      {booking.bookingReference}
                    </Text>
                  </View>

                  {statusInfo.isConfirmed ? (
                    <Button
                      title="View QR Pass"
                      onPress={() => setSelectedTicketBooking(booking)}
                      variant="primary"
                      size="sm"
                      iconLeading={<Ionicons name="qr-code" size={14} color={colors.textInverse} />}
                    />
                  ) : statusInfo.isPending ? (
                    <Button
                      title="Complete Payment"
                      onPress={() => setSelectedTicketBooking(booking)}
                      variant="primary"
                      size="sm"
                      iconLeading={<Ionicons name="card-outline" size={14} color={colors.textInverse} />}
                    />
                  ) : (
                    <Button
                      title="Reservation Details"
                      onPress={() => setSelectedTicketBooking(booking)}
                      variant="outline"
                      size="sm"
                      iconLeading={<Ionicons name="time-outline" size={14} color={colors.gold} />}
                    />
                  )}
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* QR Pass / Reservation Status Bottom Sheet */}
      <BottomSheet
        visible={!!selectedTicketBooking}
        onClose={() => setSelectedTicketBooking(null)}
        title={selectedTicketBooking?.status === 'confirmed' ? 'Digital Cinema Pass' : 'Reservation Details'}
      >
        {selectedTicketBooking && (
          selectedTicketBooking.status === 'confirmed' ? (
            <View style={styles.qrPassContainer}>
              <Text variant="h2" align="center">
                {selectedTicketBooking.showtime.movieTitle}
              </Text>
              <Text variant="caption" color="gold" align="center">
                {selectedTicketBooking.showtime.cinemaName} •{' '}
                {selectedTicketBooking.showtime.cinemaNeighborhood
                  ? `${selectedTicketBooking.showtime.cinemaNeighborhood}, ${selectedTicketBooking.showtime.cinemaCity}`
                  : selectedTicketBooking.showtime.cinemaCity}
              </Text>

              {/* Cinematic QR Box with Real Scannable QR Code */}
              <View style={styles.qrBox}>
                <View style={styles.qrWhiteCanvas}>
                  <QRCode
                    value={
                      selectedTicketBooking.qrCode ||
                      selectedTicketBooking.tickets?.[0]?.qrCodeData ||
                      `REELPASS-${selectedTicketBooking.bookingReference}`
                    }
                    size={170}
                    color="#0B0B0F"
                    backgroundColor="#FFFFFF"
                    quietZone={10}
                  />
                </View>
                <Text variant="micro" color="gold" style={styles.qrBoxText}>
                  SCAN AT AUDITORIUM ENTRANCE
                </Text>
                <Text variant="micro" color="tertiary" style={styles.qrPayloadText} numberOfLines={1}>
                  {selectedTicketBooking.qrCode || selectedTicketBooking.tickets?.[0]?.qrCodeData || selectedTicketBooking.bookingReference}
                </Text>
              </View>

              <View style={styles.passDetailsRow}>
                <View style={styles.passCol}>
                  <Text variant="micro" color="tertiary">
                    REFERENCE
                  </Text>
                  <Text variant="bodyBold">{selectedTicketBooking.bookingReference}</Text>
                </View>
                <View style={styles.passCol}>
                  <Text variant="micro" color="tertiary">
                    SEATS
                  </Text>
                  <Text variant="bodyBold" color="gold">
                    {selectedTicketBooking.seats.map((s) => s.label).join(', ')}
                  </Text>
                </View>
                <View style={styles.passCol}>
                  <Text variant="micro" color="tertiary">
                    TOTAL
                  </Text>
                  <Text variant="bodyBold">{formatNaira(selectedTicketBooking.totalAmount)}</Text>
                </View>
              </View>

              <Button
                title="Close Pass"
                onPress={() => setSelectedTicketBooking(null)}
                variant="outline"
                size="md"
                style={{ width: '100%', marginTop: spacing.md }}
              />
            </View>
          ) : (
            <View style={styles.pendingPassContainer}>
              <View style={styles.pendingIconBox}>
                <Ionicons
                  name={selectedTicketBooking.status === 'cancelled' || selectedTicketBooking.status === 'expired' ? 'alert-circle-outline' : 'time-outline'}
                  size={44}
                  color={colors.gold}
                />
              </View>

              <Badge
                label={getStatusPresentation(selectedTicketBooking).label}
                variant={getStatusPresentation(selectedTicketBooking).variant}
              />

              <Text variant="h2" align="center" style={{ marginTop: spacing.xs }}>
                {selectedTicketBooking.status === 'pending' && (!selectedTicketBooking.expiresAt || new Date(selectedTicketBooking.expiresAt).getTime() >= Date.now())
                  ? 'Seats Reserved (Payment Pending)'
                  : selectedTicketBooking.status === 'cancelled'
                    ? 'Reservation Cancelled'
                    : 'Reservation Expired'}
              </Text>

              <Text variant="body" color="secondary" align="center" style={styles.pendingDescription}>
                {selectedTicketBooking.status === 'pending' && (!selectedTicketBooking.expiresAt || new Date(selectedTicketBooking.expiresAt).getTime() >= Date.now())
                  ? 'Your seats are temporarily held. Complete payment via Flutterwave to instantly generate your contactless digital cinema pass.'
                  : 'This reservation is inactive. Contested seats have been returned to the auditorium seat map.'}
              </Text>

              {/* Reservation summary */}
              <View style={styles.pendingSummaryBox}>
                <View style={styles.pendingSummaryRow}>
                  <Text variant="caption" color="secondary">Movie</Text>
                  <Text variant="bodyBold">{selectedTicketBooking.showtime.movieTitle}</Text>
                </View>
                <View style={styles.pendingSummaryRow}>
                  <Text variant="caption" color="secondary">Cinema</Text>
                  <Text variant="caption" color="primary">{selectedTicketBooking.showtime.cinemaName}</Text>
                </View>
                <View style={styles.pendingSummaryRow}>
                  <Text variant="caption" color="secondary">Reference</Text>
                  <Text variant="bodyBold" color="gold">{selectedTicketBooking.bookingReference}</Text>
                </View>
                <View style={styles.pendingSummaryRow}>
                  <Text variant="caption" color="secondary">Seats</Text>
                  <Text variant="bodyBold" color="gold">
                    {selectedTicketBooking.seats.map((s) => s.label).join(', ')}
                  </Text>
                </View>
                <View style={styles.pendingSummaryRow}>
                  <Text variant="caption" color="secondary">Amount Due</Text>
                  <Text variant="bodyBold">{formatNaira(selectedTicketBooking.totalAmount)}</Text>
                </View>
              </View>

              <View style={styles.pendingNotice}>
                <Ionicons name="information-circle-outline" size={18} color={colors.gold} />
                <Text variant="micro" color="secondary" style={{ flex: 1, lineHeight: 16 }}>
                  Unpaid reservations expire automatically to return contested seats to the auditorium seat map.
                </Text>
              </View>

              {selectedTicketBooking.status === 'pending' && (!selectedTicketBooking.expiresAt || new Date(selectedTicketBooking.expiresAt).getTime() >= Date.now()) ? (
                <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.md }}>
                  <Button
                    title={`Pay Now (${formatNaira(selectedTicketBooking.totalAmount)})`}
                    onPress={() => handlePayTicket(selectedTicketBooking)}
                    loading={payingBookingId === selectedTicketBooking.id}
                    variant="primary"
                    size="md"
                    iconLeading={<Ionicons name="card-outline" size={16} color={colors.textInverse} />}
                  />
                  <Button
                    title="Check Payment Status"
                    onPress={() => handleCheckTicketStatus(selectedTicketBooking)}
                    loading={checkingBookingId === selectedTicketBooking.id}
                    variant="outline"
                    size="sm"
                    iconLeading={<Ionicons name="refresh" size={14} color={colors.gold} />}
                  />
                  <Button
                    title="Close"
                    onPress={() => setSelectedTicketBooking(null)}
                    variant="ghost"
                    size="sm"
                  />
                </View>
              ) : (
                <Button
                  title="Close"
                  onPress={() => setSelectedTicketBooking(null)}
                  variant="outline"
                  size="md"
                  style={{ width: '100%', marginTop: spacing.md }}
                />
              )}
            </View>
          )
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  headerTitle: {
    marginBottom: 2,
  },
  tabsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: colors.gold,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 40,
    gap: spacing.lg,
  },
  ticketCard: {
    marginBottom: spacing.md,
  },
  ticketHeaderStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  cinemaName: {
    fontWeight: '700',
  },
  ticketBody: {
    padding: spacing.md,
  },
  movieDetails: {
    gap: 4,
  },
  formatLabel: {
    marginBottom: spacing.sm,
  },
  dateTimeSeatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceInput,
    padding: spacing.sm,
    borderRadius: radii.md,
    marginTop: spacing.xs,
  },
  infoCol: {
    gap: 2,
  },
  perforatedLine: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    marginHorizontal: spacing.sm,
  },
  ticketFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceCard,
  },
  refText: {
    fontWeight: '700',
  },
  qrPassContainer: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  qrBox: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 2,
    borderColor: colors.borderGold,
    borderRadius: radii.xl,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.md,
    ...shadows.goldGlow,
  },
  qrWhiteCanvas: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.md,
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrBoxText: {
    marginTop: spacing.sm,
    letterSpacing: 1,
  },
  qrPayloadText: {
    marginTop: 2,
    maxWidth: 220,
    textAlign: 'center',
  },
  passDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    borderRadius: radii.lg,
    marginVertical: spacing.sm,
  },
  passCol: {
    alignItems: 'center',
    gap: 2,
  },
  pendingPassContainer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  pendingIconBox: {
    width: 76,
    height: 76,
    borderRadius: radii.round,
    backgroundColor: 'rgba(229, 169, 60, 0.12)',
    borderWidth: 2,
    borderColor: colors.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  pendingDescription: {
    paddingHorizontal: spacing.md,
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
  pendingSummaryBox: {
    width: '100%',
    backgroundColor: colors.surfaceInput,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginVertical: spacing.xs,
  },
  pendingSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pendingNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(229, 169, 60, 0.08)',
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(229, 169, 60, 0.25)',
    width: '100%',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
});
