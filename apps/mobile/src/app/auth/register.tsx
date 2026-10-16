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
import { colors, spacing } from '../../theme';
import { Button, Input, Text, useToast } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

export default function RegisterScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const { showToast } = useToast();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const handleRegister = async () => {
    const newErrors: { [key: string]: string } = {};
    if (!fullName.trim()) newErrors.fullName = 'Full name is required';
    if (!email.trim() || !email.includes('@')) newErrors.email = 'Valid email is required';
    if (!password || password.length < 6) newErrors.password = 'Password must be at least 6 characters';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    setErrors({});
    const success = await signUp({
      fullName: fullName.trim(),
      email: email.trim(),
      phoneNumber: phoneNumber.trim() || undefined,
      password,
    });
    setLoading(false);

    if (success) {
      showToast({
        title: 'Account Created',
        message: 'Welcome to ReelPass. Your profile is ready.',
        type: 'success',
      });
      router.replace('/(tabs)');
    } else {
      showToast({
        title: 'Registration Failed',
        message: 'Unable to create account. Please try again.',
        type: 'error',
      });
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
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back to sign in"
          >
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.titleSection}>
          <Text variant="h1" style={styles.title}>
            Join ReelPass
          </Text>
          <Text variant="body" color="secondary" style={styles.subtitle}>
            Experience luxury cinema with instant reservations, seat selection, and digital tickets.
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            label="Full Name"
            placeholder="e.g. Alex Vance"
            value={fullName}
            onChangeText={setFullName}
            error={errors.fullName}
            iconLeading={<Ionicons name="person-outline" size={18} color={colors.textTertiary} />}
          />

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
            label="Phone Number (Optional)"
            placeholder="+234 803 000 0000"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            keyboardType="phone-pad"
            iconLeading={<Ionicons name="call-outline" size={18} color={colors.textTertiary} />}
          />

          <Input
            label="Password"
            placeholder="At least 6 characters"
            value={password}
            onChangeText={setPassword}
            isPassword
            error={errors.password}
            iconLeading={<Ionicons name="lock-closed-outline" size={18} color={colors.textTertiary} />}
          />

          <Button
            title="Create Account"
            onPress={handleRegister}
            loading={loading}
            variant="primary"
            size="lg"
            style={styles.submitButton}
          />

          <View style={styles.footerRow}>
            <Text variant="body" color="secondary">
              Already have an account?{' '}
            </Text>
            <TouchableOpacity onPress={() => router.push('/auth/login')}>
              <Text variant="bodyBold" color="gold">
                Sign In
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
    marginBottom: spacing.lg,
  },
  backButton: {
    padding: spacing.xs,
  },
  titleSection: {
    marginBottom: spacing.xxl,
  },
  title: {
    marginBottom: spacing.xs,
  },
  subtitle: {
    maxWidth: 320,
  },
  form: {
    gap: spacing.sm,
  },
  submitButton: {
    marginTop: spacing.md,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
});
