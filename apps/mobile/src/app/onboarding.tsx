import React from 'react';
import {
  View,
  ImageBackground,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../theme';
import { Button, Text } from '../components/ui';
import { useAuth } from '../context/AuthContext';

export default function OnboardingScreen() {
  const router = useRouter();
  const { demoSignIn } = useAuth();

  const handleDemoAccess = async () => {
    await demoSignIn();
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <ImageBackground
        source={{
          uri: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=1200&q=80',
        }}
        style={styles.heroBackground}
        resizeMode="cover"
      >
        <LinearGradient
          colors={[
            'rgba(11, 11, 15, 0.4)',
            'rgba(11, 11, 15, 0.85)',
            colors.background,
          ]}
          style={styles.gradient}
        >
          <View style={styles.brandRow}>
            <View style={styles.brandLogo}>
              <Ionicons name="film" size={24} color={colors.gold} />
            </View>
            <View>
              <Text variant="h1" color="gold" style={styles.brandTitle}>
                REELPASS
              </Text>
              <Text variant="caption" color="secondary" style={styles.brandTagline}>
                Your seat. Your story.
              </Text>
            </View>
          </View>

          <View style={styles.content}>
            <Text variant="display" style={styles.headline}>
              Cinematic Luxury.{'\n'}Front Row Access.
            </Text>

            <Text variant="bodyLarge" color="secondary" style={styles.subheadline}>
              Book premium IMAX and Dolby Atmos showtimes across Nigeria with interactive 300+ seat reservation.
            </Text>

            <View style={styles.featuresList}>
              <View style={styles.featureItem}>
                <Ionicons name="sparkles" size={18} color={colors.gold} />
                <Text variant="body" color="primary" style={styles.featureText}>
                  Premium IMAX & Dolby Laser Soundstages
                </Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="grid-outline" size={18} color={colors.gold} />
                <Text variant="body" color="primary" style={styles.featureText}>
                  Interactive 300+ Seat Map with VIP Recliners
                </Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="qr-code-outline" size={18} color={colors.gold} />
                <Text variant="body" color="primary" style={styles.featureText}>
                  Instant Contactless Mobile Digital Tickets
                </Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="location-outline" size={18} color={colors.gold} />
                <Text variant="body" color="primary" style={styles.featureText}>
                  Cinemas in Lagos, Abuja, Port Harcourt & Ibadan
                </Text>
              </View>
            </View>

            <View style={styles.actions}>
              <Button
                title="Explore Movies"
                onPress={() => router.replace('/(tabs)')}
                variant="primary"
                size="lg"
                style={styles.primaryButton}
              />

              <Button
                title="Instant Demo Access"
                onPress={handleDemoAccess}
                variant="outline"
                size="md"
                style={styles.secondaryButton}
              />

              <Button
                title="Sign In with Account"
                onPress={() => router.push('/auth/login')}
                variant="ghost"
                size="sm"
              />
            </View>
          </View>
        </LinearGradient>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  heroBackground: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  gradient: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    paddingTop: 60,
    paddingBottom: 40,
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandLogo: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: 'rgba(229, 169, 60, 0.15)',
    borderWidth: 1,
    borderColor: colors.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    letterSpacing: 3,
    fontWeight: '800',
  },
  brandTagline: {
    marginTop: 2,
    letterSpacing: 0.4,
  },
  content: {
    gap: spacing.md,
  },
  headline: {
    letterSpacing: -0.5,
  },
  subheadline: {
    lineHeight: 24,
  },
  featuresList: {
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  featureText: {
    fontWeight: '500',
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryButton: {
    width: '100%',
  },
  secondaryButton: {
    width: '100%',
  },
});
