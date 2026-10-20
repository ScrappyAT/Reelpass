import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../../theme';
import {
  Text,
  Card,
  Badge,
  Button,
} from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut, isAuthenticated } = useAuth();

  const handleSignOut = () => {
    signOut();
    router.replace('/onboarding');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text variant="h1" style={styles.headerTitle}>
          Profile
        </Text>
        <Text variant="body" color="secondary">
          Membership privileges and application preferences
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* User Membership Card */}
        <Card variant="goldBorder" padding="lg" style={styles.profileCard}>
          <View style={styles.avatarRow}>
            <View style={styles.avatarCircle}>
              <Text variant="h1" color="gold">
                {user ? user.fullName.charAt(0).toUpperCase() : 'M'}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="h2">{user ? user.fullName : 'Guest Explorer'}</Text>
              <Text variant="caption" color="secondary">
                {user ? user.email : 'Sign in to access VIP tier'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <Badge label="GOLD TIER MEMBER" variant="gold" />
                {user?.id === 'u-1001-demo-user-id' && (
                  <Badge label="DEMO ACCOUNT" variant="warning" />
                )}
              </View>
            </View>
          </View>

          {/* Loyalty Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statCol}>
              <Text variant="micro" color="tertiary">
                LOYALTY PTS
              </Text>
              <Text variant="h3" color="gold">
                1,450
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text variant="micro" color="tertiary">
                SCREENINGS
              </Text>
              <Text variant="h3">14</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text variant="micro" color="tertiary">
                SAVED
              </Text>
              <Text variant="h3">6</Text>
            </View>
          </View>
        </Card>

        {/* Demonstration Data Banner */}
        {user?.id === 'u-1001-demo-user-id' && (
          <View style={styles.demoBanner}>
            <Ionicons name="information-circle-outline" size={16} color={colors.gold} />
            <Text variant="micro" color="secondary" style={styles.demoBannerText}>
              <Text variant="micro" color="gold" style={{ fontWeight: '700' }}>
                Demonstration Profile:
              </Text>{' '}
              Pre-configured sample account with simulated membership and loyalty data for previewing ReelPass features.
            </Text>
          </View>
        )}

        {/* Section 1: Developer & Component Gallery */}
        <Text variant="micro" color="tertiary" style={styles.sectionHeader}>
          DESIGN SYSTEM & TESTING
        </Text>
        <Card variant="default" padding="none" style={styles.menuCard}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => router.push('/gallery')}
            style={styles.menuItem}
            accessibilityRole="button"
            accessibilityLabel="Open Component Gallery"
          >
            <View style={[styles.menuIcon, { backgroundColor: 'rgba(229, 169, 60, 0.15)' }]}>
              <Ionicons name="color-palette" size={20} color={colors.gold} />
            </View>
            <View style={styles.menuItemContent}>
              <Text variant="bodyBold">Component Gallery</Text>
              <Text variant="caption" color="secondary">
                Inspect all 12 reusable UI component states
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </Card>

        {/* Section 2: Preferences */}
        <Text variant="micro" color="tertiary" style={styles.sectionHeader}>
          PREFERENCES & BILLING
        </Text>
        <Card variant="default" padding="none" style={styles.menuCard}>
          <TouchableOpacity activeOpacity={0.8} style={styles.menuItem}>
            <View style={styles.menuIcon}>
              <Ionicons name="location-outline" size={20} color={colors.textPrimary} />
            </View>
            <View style={styles.menuItemContent}>
              <Text variant="bodyBold">Preferred Theatres</Text>
              <Text variant="caption" color="secondary">
                ReelPass Cinemas Lekki (Lagos)
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity activeOpacity={0.8} style={styles.menuItem}>
            <View style={styles.menuIcon}>
              <Ionicons name="card-outline" size={20} color={colors.textPrimary} />
            </View>
            <View style={styles.menuItemContent}>
              <Text variant="bodyBold">Payment Methods</Text>
              <Text variant="caption" color="secondary">
                Flutterwave Sandbox (Phase 2 Integration)
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity activeOpacity={0.8} style={styles.menuItem}>
            <View style={styles.menuIcon}>
              <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
            </View>
            <View style={styles.menuItemContent}>
              <Text variant="bodyBold">Screening Alerts</Text>
              <Text variant="caption" color="secondary">
                Showtime reminders and booking confirmations
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </Card>

        {/* TMDB Attribution Section */}
        <View style={styles.attributionBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textTertiary} />
          <Text variant="micro" color="tertiary" style={styles.attributionText}>
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </Text>
        </View>

        {/* Sign Out Button */}
        <View style={styles.actions}>
          {isAuthenticated ? (
            <Button
              title="Sign Out"
              onPress={handleSignOut}
              variant="outline"
              size="md"
              style={styles.signOutButton}
            />
          ) : (
            <Button
              title="Sign In with Account"
              onPress={() => router.push('/auth/login')}
              variant="primary"
              size="md"
            />
          )}
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
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  headerTitle: {
    marginBottom: 2,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 40,
    gap: spacing.lg,
  },
  profileCard: {
    marginBottom: spacing.xs,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: radii.round,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 2,
    borderColor: colors.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.surfaceInput,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  statCol: {
    alignItems: 'center',
    gap: 2,
  },
  statDivider: {
    width: 1,
    height: '80%',
    backgroundColor: colors.border,
    alignSelf: 'center',
  },
  sectionHeader: {
    marginTop: spacing.xs,
    marginLeft: spacing.xs,
  },
  menuCard: {
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemContent: {
    flex: 1,
    gap: 2,
  },
  menuDivider: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginLeft: 58,
  },
  attributionBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginVertical: spacing.xs,
  },
  attributionText: {
    flex: 1,
    lineHeight: 14,
  },
  demoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(229, 169, 60, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(229, 169, 60, 0.25)',
    borderRadius: radii.md,
    padding: spacing.md,
    marginVertical: spacing.xs,
  },
  demoBannerText: {
    flex: 1,
    lineHeight: 16,
  },
  actions: {
    marginTop: spacing.md,
  },
  signOutButton: {
    width: '100%',
  },
});
