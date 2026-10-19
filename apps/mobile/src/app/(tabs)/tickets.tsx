import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
} from '../../components/ui';
import { api, isApiConnectionError } from '../../services/api';
import { formatShowtimeDate, formatShowtimeTime } from '../../utils/datetime';

export default function MyTicketsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');
  const [selectedTicketBooking, setSelectedTicketBooking] = useState<Booking | null>(null);

  const fetchTickets = async () => {
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
          ? 'Cannot reach ReelPass servers. Start the backend on port 4000 to view your tickets.'
          : 'Could not load your tickets.'
      );
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTickets();
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
              Upcoming ({bookings.length})
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
              Past History (0)
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
        {activeTab === 'past' || bookings.length === 0 ? (
          <EmptyState
            icon={loadError ? 'cloud-offline-outline' : 'ticket-outline'}
            title={loadError ? 'Tickets Unavailable' : 'No Active Tickets'}
            description={
              loadError ||
              "You don't have any upcoming reservations. Check out the latest movies and book your seats now."
            }
            actionTitle="Discover Movies"
            onAction={() => router.replace('/(tabs)')}
          />
        ) : (
          bookings.map((booking) => {
            const dateStr = formatShowtimeDate(booking.showtime.startTime);
            const timeStr = formatShowtimeTime(booking.showtime.startTime);
            const isConfirmed = booking.status === 'confirmed';

            return (
              <Card
                key={booking.id}
                variant="goldBorder"
                padding="none"
                style={styles.ticketCard}
              >
                {/* Cinema & Status Strip */}
                <View style={styles.ticketHeaderStrip}>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" color="gold" style={styles.cinemaName} numberOfLines={1}>
                      {booking.showtime.cinemaName}
                    </Text>
                    <Text variant="micro" color="secondary" numberOfLines={1}>
                      {booking.showtime.cinemaNeighborhood
                        ? `${booking.showtime.cinemaNeighborhood}, ${booking.showtime.cinemaCity}`
                        : booking.showtime.cinemaCity}{' '}
                      • {booking.showtime.auditoriumName}
                    </Text>
                  </View>
                  <Badge
                    label={booking.status.toUpperCase()}
                    variant={isConfirmed ? 'success' : 'warning'}
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

                  {isConfirmed ? (
                    <Button
                      title="View QR Pass"
                      onPress={() => setSelectedTicketBooking(booking)}
                      variant="primary"
                      size="sm"
                      iconLeading={<Ionicons name="qr-code" size={14} color={colors.textInverse} />}
                    />
                  ) : (
                    <Button
                      title="Pending Details"
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
        title={selectedTicketBooking?.status === 'confirmed' ? 'Digital Cinema Pass' : 'Booking Details'}
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
                <Ionicons name="time-outline" size={44} color={colors.gold} />
              </View>

              <Badge
                label={selectedTicketBooking.status.toUpperCase()}
                variant={selectedTicketBooking.status === 'pending' ? 'warning' : 'danger'}
              />

              <Text variant="h2" align="center" style={{ marginTop: spacing.xs }}>
                {selectedTicketBooking.status === 'pending'
                  ? 'Payment Confirmation Pending'
                  : 'Reservation Inactive'}
              </Text>

              <Text variant="body" color="secondary" align="center" style={styles.pendingDescription}>
                {selectedTicketBooking.status === 'pending'
                  ? 'Your seats are temporarily held. Digital admission QR passes are issued exclusively for confirmed bookings once payment is settled.'
                  : 'This reservation has expired or was cancelled. Admission passes are not active for this booking.'}
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
                  Unconfirmed bookings expire automatically to return contested seats to the auditorium seat map.
                </Text>
              </View>

              <Button
                title="Close"
                onPress={() => setSelectedTicketBooking(null)}
                variant="outline"
                size="md"
                style={{ width: '100%', marginTop: spacing.md }}
              />
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
});
