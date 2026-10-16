import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing } from '../../theme';
import { Button, Input, Text, useToast } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, demoSignIn } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const handleLogin = async () => {
    const newErrors: { email?: string; password?: string } = {};
    if (!email.trim()) newErrors.email = 'Email is required';
    if (!password) newErrors.password = 'Password is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    setErrors({});
    const success = await signIn(email.trim(), password);
    setLoading(false);

    if (success) {
      showToast({
        title: 'Welcome Back',
        message: 'Successfully signed in to ReelPass.',
        type: 'success',
      });
      router.back();
    } else {
      showToast({
        title: 'Sign In Failed',
        message: 'Please check your email and password.',
        type: 'error',
      });
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    const success = await demoSignIn();
    setLoading(false);

    if (success) {
      showToast({
        title: 'Demo Mode Activated',
        message: 'Signed in as Alex Vance (Demo Account).',
        type: 'gold',
      });
      router.back();
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header with Close */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close sign in"
          >
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Brand & Titles */}
        <View style={styles.titleSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="film" size={28} color={colors.gold} />
          </View>
          <Text variant="h1" style={styles.title}>
            Welcome Back
          </Text>
          <Text variant="body" color="secondary" style={styles.subtitle}>
            Sign in to access your movie tickets, loyalty status, and saved showtimes.
          </Text>
        </View>

        {/* Form Inputs */}
        <View style={styles.form}>
          <Input
            label="Email Address"
            placeholder="e.g. alex@reelpass.app"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            error={errors.email}
            iconLeading={<Ionicons name="mail-outline" size={18} color={colors.textTertiary} />}
          />

          <Input
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChangeText={setPassword}
            isPassword
            error={errors.password}
            iconLeading={<Ionicons name="lock-closed-outline" size={18} color={colors.textTertiary} />}
          />

          <Button
            title="Sign In"
            onPress={handleLogin}
            loading={loading}
            variant="primary"
            size="lg"
            style={styles.submitButton}
          />

          <Button
            title="Instant Demo Login (Alex Vance)"
            onPress={handleDemoLogin}
            variant="outline"
            size="md"
            style={styles.demoButton}
            iconLeading={<Ionicons name="sparkles" size={16} color={colors.gold} />}
          />

          <View style={styles.footerRow}>
            <Text variant="body" color="secondary">
              Don’t have an account?{' '}
            </Text>
            <TouchableOpacity onPress={() => router.push('/auth/register')}>
              <Text variant="bodyBold" color="gold">
                Create Account
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: 40,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.lg,
  },
  closeButton: {
    padding: spacing.xs,
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: radii.round,
    backgroundColor: 'rgba(229, 169, 60, 0.15)',
    borderWidth: 1,
    borderColor: colors.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    maxWidth: 280,
  },
  form: {
    gap: spacing.sm,
  },
  submitButton: {
    marginTop: spacing.md,
  },
  demoButton: {
    marginTop: spacing.xs,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
});
