import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Movie, Seat } from '@matinee/shared';
import { colors, spacing } from '../theme';
import {
  Button,
  Text,
  Card,
  MovieCard,
  Input,
  Chip,
  Badge,
  BottomSheet,
  Skeleton,
  SkeletonPoster,
  SkeletonText,
  EmptyState,
  SeatMap,
  useToast,
} from '../components/ui';

// Sample movie for showcase
const sampleMovie: Movie = {
  id: 'demo-gallery-1',
  tmdbId: 693134,
  title: 'Dune: Part Two (IMAX Laser)',
  tagline: 'Long live the fighters.',
  overview: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
  posterUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=800&q=80',
  backdropUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
  releaseDate: '2024-03-01',
  runtimeMinutes: 166,
  genres: [{ id: 878, name: 'Sci-Fi' }, { id: 12, name: 'Adventure' }],
  rating: 8.5,
  voteCount: 5400,
  certification: 'PG-13',
  status: 'now_playing',
};

// Generate 320 seats for the gallery interactive demo
const generateGallerySeats = (): Seat[] => {
  const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
  const seats: Seat[] = [];
  rows.forEach((row, rIdx) => {
    for (let c = 1; c <= 20; c++) {
      const isVip = rIdx >= 14;
      const isWheelchair = rIdx === 0 && (c <= 2 || c >= 19);
      let status: 'available' | 'held' | 'sold' = 'available';
      if ((rIdx * 7 + c * 3) % 19 === 0) status = 'sold';
      else if ((rIdx * 5 + c * 11) % 23 === 0) status = 'held';

      seats.push({
        id: `gal-${row}${c}`,
        auditoriumId: 'aud-gal',
        row,
        number: c,
        label: `${row}${c}`,
        type: isWheelchair ? 'wheelchair' : isVip ? 'vip' : 'standard',
        status,
        // NGN demo prices stored as integer kobo.
        price: isVip ? 750000 : 450000,
      });
    }
  });
  return seats;
};

export default function ComponentGalleryScreen() {
  const { showToast } = useToast();

  // State controls for interactive gallery components
  const [inputText, setInputText] = useState('Interstellar IMAX');
  const [chipSelected, setChipSelected] = useState('imax');
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [gallerySeats] = useState<Seat[]>(generateGallerySeats);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>(['gal-H10', 'gal-H11']);

  const handleToggleSeat = (seat: Seat) => {
    if (selectedSeatIds.includes(seat.id)) {
      setSelectedSeatIds(selectedSeatIds.filter((id) => id !== seat.id));
    } else {
      setSelectedSeatIds([...selectedSeatIds, seat.id]);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.headerBox}>
          <Text variant="h1" color="gold">
            ReelPass Design System
          </Text>
          <Text variant="body" color="secondary">
            Visual gallery showcasing all 12 core reusable UI components, variants, accessibility attributes, and responsive states.
          </Text>
        </View>

        {/* 1. BUTTON COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            1. Button Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            Variants: Primary (Gold), Secondary (Glass/Charcoal), Outline, Ghost, Danger
          </Text>
          <View style={styles.componentsGrid}>
            <Button title="Primary Gold (Lg)" variant="primary" size="lg" onPress={() => {}} />
            <Button
              title="Primary with Icon"
              variant="primary"
              size="md"
              iconLeading={<Ionicons name="sparkles" size={16} color={colors.textInverse} />}
              onPress={() => {}}
            />
            <Button title="Secondary Surface (Md)" variant="secondary" size="md" onPress={() => {}} />
            <Button title="Outline Amber (Md)" variant="outline" size="md" onPress={() => {}} />
            <Button title="Ghost Action (Sm)" variant="ghost" size="sm" onPress={() => {}} />
            <Button title="Danger / Destructive" variant="danger" size="md" onPress={() => {}} />
            <Button title="Loading State" variant="primary" size="md" loading onPress={() => {}} />
            <Button title="Disabled State" variant="primary" size="md" disabled onPress={() => {}} />
          </View>
        </View>

        {/* 2. TEXT COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            2. Text Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            Typography hierarchy with warm ivory and amber gold tokens
          </Text>
          <Card padding="md" style={{ gap: spacing.xs }}>
            <Text variant="display">Display Text (32px / 800)</Text>
            <Text variant="h1">Header 1 (26px / 700)</Text>
            <Text variant="h2">Header 2 (20px / 700)</Text>
            <Text variant="h3">Header 3 (17px / 600)</Text>
            <Text variant="bodyLarge">Body Large (16px / 400)</Text>
            <Text variant="body">Body Standard (14px / 400)</Text>
            <Text variant="bodyBold">Body Bold (14px / 600)</Text>
            <Text variant="caption">Caption (12px / 500)</Text>
            <Text variant="micro">MICRO LABEL (10px / 700)</Text>
            <Text variant="bodyBold" color="gold">
              Amber Gold Text Accent
            </Text>
            <Text variant="body" color="tertiary">
              Tertiary Muted Text
            </Text>
          </Card>
        </View>

        {/* 3. CARD COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            3. Card Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            Surface variants: Default, Elevated, Glassmorphic, and Gold Border Glow
          </Text>
          <View style={{ gap: spacing.md }}>
            <Card variant="default" padding="md">
              <Text variant="h3">Default Surface Card</Text>
              <Text variant="caption" color="secondary">
                Standard container with subtle charcoal border.
              </Text>
            </Card>

            <Card variant="elevated" padding="md">
              <Text variant="h3">Elevated Card</Text>
              <Text variant="caption" color="secondary">
                Elevated background with deep dark shadow.
              </Text>
            </Card>

            <Card variant="glass" padding="md">
              <Text variant="h3">Glass Card</Text>
              <Text variant="caption" color="secondary">
                Translucent overlay card with 0.08 white border.
              </Text>
            </Card>

            <Card variant="goldBorder" padding="md">
              <Text variant="h3" color="gold">
                Gold Border & Glow Card
              </Text>
              <Text variant="caption" color="secondary">
                Luxury card highlighting confirmed bookings and VIP passes.
              </Text>
            </Card>
          </View>
        </View>

        {/* 4. MOVIE CARD COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            4. MovieCard Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            Layouts: Poster (Portrait), Backdrop (Wide), Horizontal (List)
          </Text>
          <Text variant="caption" color="gold" style={{ marginBottom: 8 }}>
            Poster Card Variant:
          </Text>
          <MovieCard movie={sampleMovie} variant="poster" onPress={() => {}} />

          <Text variant="caption" color="gold" style={{ marginTop: 16, marginBottom: 8 }}>
            Backdrop Hero Card Variant:
          </Text>
          <MovieCard movie={sampleMovie} variant="backdrop" onPress={() => {}} />

          <Text variant="caption" color="gold" style={{ marginTop: 16, marginBottom: 8 }}>
            Horizontal List Card Variant:
          </Text>
          <MovieCard movie={sampleMovie} variant="horizontal" onPress={() => {}} />
        </View>

        {/* 5. INPUT COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            5. Input Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            States: Standard, with Leading Icon, Password Reveal, Error validation
          </Text>
          <Input
            label="Movie Query"
            placeholder="Search titles..."
            value={inputText}
            onChangeText={setInputText}
            iconLeading={<Ionicons name="search" size={18} color={colors.gold} />}
            helperText="Type any title to see live updates"
          />

          <Input
            label="Secure Password"
            placeholder="Enter password"
            value="supersecretpassword"
            onChangeText={() => {}}
            isPassword
            iconLeading={<Ionicons name="lock-closed-outline" size={18} color={colors.textTertiary} />}
          />

          <Input
            label="Input with Error"
            placeholder="Email address"
            value="invalid-email@"
            onChangeText={() => {}}
            error="Please enter a complete valid email address"
            iconLeading={<Ionicons name="mail-outline" size={18} color={colors.error} />}
          />
        </View>

        {/* 6. CHIP COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            6. Chip Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            Pills with active gold state, icons, and item count badges
          </Text>
          <View style={styles.rowWrap}>
            <Chip
              label="All Screenings"
              selected={chipSelected === 'all'}
              onPress={() => setChipSelected('all')}
              count={24}
            />
            <Chip
              label="IMAX Laser"
              selected={chipSelected === 'imax'}
              onPress={() => setChipSelected('imax')}
              icon={<Ionicons name="sparkles" size={14} color={chipSelected === 'imax' ? colors.textInverse : colors.gold} />}
              count={8}
            />
            <Chip
              label="Dolby Atmos"
              selected={chipSelected === 'dolby'}
              onPress={() => setChipSelected('dolby')}
            />
            <Chip
              label="VIP Recliners"
              selected={chipSelected === 'vip'}
              onPress={() => setChipSelected('vip')}
            />
          </View>
        </View>

        {/* 7. BADGE COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            7. Badge Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            Semantic and cinema format indicators
          </Text>
          <View style={styles.rowWrap}>
            <Badge label="GOLD MEMBER" variant="gold" />
            <Badge label="IMAX LASER" variant="imax" />
            <Badge label="DOLBY ATMOS" variant="dolby" />
            <Badge label="WHEELCHAIR ACCESSIBLE" variant="wheelchair" />
            <Badge label="CONFIRMED" variant="success" />
            <Badge label="HELD SEAT" variant="warning" />
            <Badge label="SOLD OUT" variant="danger" />
            <Badge label="PG-13 RATING" variant="outline" />
          </View>
        </View>

        {/* 8. BOTTOM SHEET COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            8. BottomSheet Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            Slide-up modal with backdrop blur, drag handle, and dismiss trigger
          </Text>
          <Button
            title="Open Interactive BottomSheet"
            variant="outline"
            size="md"
            onPress={() => setIsSheetOpen(true)}
            iconLeading={<Ionicons name="layers-outline" size={18} color={colors.gold} />}
          />

          <BottomSheet
            visible={isSheetOpen}
            onClose={() => setIsSheetOpen(false)}
            title="Design System Demo Sheet"
          >
            <View style={{ gap: spacing.md, paddingVertical: spacing.sm }}>
              <Text variant="body" color="primary">
                This is the ReelPass BottomSheet modal, featuring rounded top borders, an accessible drag bar, and responsive touch dismissal.
              </Text>
              <Button
                title="Dismiss BottomSheet"
                variant="primary"
                size="md"
                onPress={() => setIsSheetOpen(false)}
              />
            </View>
          </BottomSheet>
        </View>

        {/* 9. SKELETON COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            9. Skeleton Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            Smooth pulsing placeholders for posters, text, and cards
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
            <SkeletonPoster />
            <View style={{ flex: 1, gap: 10 }}>
              <Skeleton width="90%" height={20} />
              <SkeletonText lines={4} />
            </View>
          </View>
        </View>

        {/* 10. TOAST COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            10. Toast Notification Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            Global toast notifications with haptic triggers and auto-dismiss
          </Text>
          <View style={styles.rowWrap}>
            <Button
              title="Success Toast"
              variant="secondary"
              size="sm"
              onPress={() =>
                showToast({
                  title: 'Success',
                  message: 'Your seats have been securely reserved.',
                  type: 'success',
                })
              }
            />
            <Button
              title="Error Toast"
              variant="secondary"
              size="sm"
              onPress={() =>
                showToast({
                  title: 'Booking Error',
                  message: 'This seat was just claimed by another guest.',
                  type: 'error',
                })
              }
            />
            <Button
              title="Gold Toast"
              variant="secondary"
              size="sm"
              onPress={() =>
                showToast({
                  title: 'VIP Privilege',
                  message: 'Complimentary popcorn voucher applied to pass.',
                  type: 'gold',
                })
              }
            />
            <Button
              title="Info Toast"
              variant="secondary"
              size="sm"
              onPress={() =>
                showToast({
                  title: 'Doors Opening',
                  message: 'Auditorium 1 seating commences in 15 minutes.',
                  type: 'info',
                })
              }
            />
          </View>
        </View>

        {/* 11. EMPTY STATE COMPONENT */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            11. EmptyState Component
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            Cinematic empty container with circular icon and optional action
          </Text>
          <Card padding="none">
            <EmptyState
              icon="ticket-outline"
              title="No Screening Passes Found"
              description="You currently have no past booking records. Start discovering movies now."
              actionTitle="Discover Movies"
              onAction={() => {}}
            />
          </Card>
        </View>

        {/* 12. SEAT MAP COMPONENT (300+ SEATS) */}
        <View style={styles.section}>
          <Text variant="h2" style={styles.sectionTitle}>
            12. SeatMap Component (320 Seats Performance Demo)
          </Text>
          <Text variant="caption" color="secondary" style={styles.sectionSubtitle}>
            High-performance memoized grid: 16 rows (A to P) × 20 columns = 320 seats. Visually distinguishes Available, Selected (Gold), Held (Amber), Sold (Dark), Wheelchair (Cyan), and VIP (Gold border).
          </Text>

          <Card padding="none" style={{ paddingVertical: spacing.md }}>
            <SeatMap
              seats={gallerySeats}
              selectedSeatIds={selectedSeatIds}
              onToggleSeat={handleToggleSeat}
              screenType="IMAX LASER 320-SEAT"
            />

            <View style={styles.seatSummaryBox}>
              <Text variant="caption" color="secondary">
                Selected ({selectedSeatIds.length} seats):{' '}
                <Text variant="bodyBold" color="gold">
                  {selectedSeatIds.map((id) => id.replace('gal-', '')).join(', ') || 'None'}
                </Text>
              </Text>
            </View>
          </Card>
        </View>
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
    padding: spacing.lg,
    paddingBottom: 60,
    gap: spacing.xxl,
  },
  headerBox: {
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textPrimary,
  },
  sectionSubtitle: {
    marginBottom: spacing.xs,
  },
  componentsGrid: {
    gap: spacing.sm,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  seatSummaryBox: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
});
