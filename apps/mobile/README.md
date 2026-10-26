# ReelPass Mobile Client — Expo React Native

[![Expo SDK](https://img.shields.io/badge/Expo-SDK%2057-black?style=flat&logo=expo)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React%20Native-0.86-blue?style=flat&logo=react)](https://reactnative.dev/)
[![EAS Build](https://img.shields.io/badge/Android%20APK-Tested%20Build-brightgreen?style=flat&logo=android)](https://expo.dev/accounts/scrappy4rl/projects/reelpass/builds/d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)

The **ReelPass** mobile application is a cinema ticket reservation client built with **React Native**, **Expo (SDK 57)**, **Expo Router**, and **TypeScript**. It delivers a dark, gold-accented cinema ticketing experience tailored for Nigerian moviegoers.

---

## 📱 Build & Platform Availability

- **Android Standalone Build (Tested)**:  
  [Download EAS Android APK Build `d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c`](https://expo.dev/accounts/scrappy4rl/projects/reelpass/builds/d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c)  
  *Fully verified on physical Android hardware for seat reservation, Flutterwave checkout, Android deep-link redirect, payment verification, and QR ticket issuance.*
- **iOS Demonstration**:  
  Demonstrated and verified using **Expo Go** and the Metro development server; not distributed as a standalone App Store / IPA package.

---

## 📌 Demonstration & Sandbox Notices

1. **Sandbox Payments**: All payment transactions utilize **Flutterwave Standard Checkout v3** in **sandbox test mode**. No actual banking charges or debit card deductions take place.
2. **Demonstration Data**: Cinema chains, auditoriums, showtimes, and seat maps are **sample fixtures** representing fictional cinemas in Lagos, Abuja, Port Harcourt, and Ibadan.
3. **Currency & Prices**: Prices are displayed in **Nigerian Naira (₦ / NGN)** and formatted consistently with server-side integer kobo amounts.

---

## ✨ Key Capabilities

1. **Movie Discovery & Showtimes**:
   - Curated movie feeds (Now Playing, Upcoming, Popular) integrated with TMDB.
   - Comprehensive movie details with trailers, synopsis, runtime, certification, and genres.
   - Cinema selection across Lagos (Lekki, Victoria Island, Ikeja), Abuja (Jabi), Port Harcourt, and Ibadan.

2. **Interactive Auditorium Seat Selection**:
   - Visual seat grid rendering real-time seat availability (Available, Held, Sold, Wheelchair, VIP).
   - Multi-seat selection (up to 8 seats per reservation) with instantaneous price tallying.
   - 5-minute seat hold timer with automatic release upon expiration.

3. **Flutterwave Payment Checkout**:
   - In-app browser checkout using `expo-web-browser` with automatic redirect interception.
   - Android deep-link handling via `mobile://payment-complete`, resolving route matching in standalone APKs.
   - Two-phase server verification ensuring bookings are only confirmed upon validated payment settlement.

4. **Digital Passports & QR Tickets**:
   - High-fidelity digital cinema pass generation using `react-native-qrcode-svg`.
   - Contactless scannable QR codes containing encrypted booking reference and ticket identification data.
   - Tabbed history organizing confirmed upcoming passes and past screenings.

5. **Self-Healing Authentication**:
   - Resilient session acquisition with cold-boot retries and proactive demo token guards.
   - Automatic 401 interceptor that refreshes credentials and retries operations without interrupting the user.

6. **Component Design System Gallery**:
   - Dedicated inspection screen (`/gallery`) showcasing 12 reusable UI component states (Badges, Buttons, Cards, SeatMap, Toast, Modals, Empty States).

---

## 🏗️ Project Architecture & Structure

The mobile client uses **Expo Router** for file-based routing and a modular component hierarchy:

```text
apps/mobile/
├── src/
│   ├── app/                          # Expo Router file-based screens
│   │   ├── _layout.tsx               # Root layout, fonts, splash screen, WebBrowser init
│   │   ├── (tabs)/                   # Bottom tab navigator
│   │   │   ├── _layout.tsx           # Tab bar styling & icons
│   │   │   ├── index.tsx             # Home: Movies, Hero banner, Cinema filter
│   │   │   ├── search.tsx            # Movie & Cinema Search
│   │   │   ├── tickets.tsx           # My Tickets: Active QR passes & history
│   │   │   └── profile.tsx           # Profile: Demo session, VIP tier, component gallery link
│   │   ├── movie/                    # Movie details & showtimes screen
│   │   │   └── [id].tsx
│   │   ├── booking/                  # Seat selection & reservation screen
│   │   │   └── seats/
│   │   │       └── [showtimeId].tsx
│   │   ├── payment-complete.tsx      # Deep link redirect receiver (mobile://payment-complete)
│   │   ├── onboarding.tsx            # Initial welcome & demo session launcher
│   │   ├── gallery.tsx               # Design system component gallery
│   │   └── auth/                     # Sign-in & registration screens
│   │       ├── login.tsx
│   │       └── register.tsx
│   │
│   ├── components/ui/                # Reusable design system UI components
│   │   ├── Badge.tsx                 # Status & tier badges (gold, success, warning, etc.)
│   │   ├── BottomSheet.tsx           # Modal slide-up confirmation sheet
│   │   ├── Button.tsx                # Buttons with variants (primary, gold, outline, ghost)
│   │   ├── Card.tsx                  # Elevated & gold-bordered surface cards
│   │   ├── EmptyState.tsx            # Zero-data states with contextual action buttons
│   │   ├── Modal.tsx                 # Popover dialogs
│   │   ├── SeatMap.tsx               # Interactive SVG/canvas seat layout grid
│   │   ├── Text.tsx                  # Typography scale (h1, h2, h3, body, caption, micro)
│   │   └── Toast.tsx                 # Animated notifications & feedback toasts
│   │
│   ├── context/                      # React context providers
│   │   └── AuthContext.tsx           # In-memory auth state & token listener
│   │
│   ├── services/                     # External services & API integration
│   │   └── api.ts                    # Resilient ApiClient with 12s timeout & auto-retry
│   │
│   ├── theme/                        # Design system tokens
│   │   ├── colors.ts                 # Dark theme palette & gold accent tokens
│   │   ├── typography.ts             # Font families, sizes, weights, line heights
│   │   ├── spacing.ts                # 4-point spacing scale (xs, sm, md, lg, xl, xxl)
│   │   ├── radii.ts                  # Border radius constants
│   │   └── index.ts                  # Theme bundle export
│   │
│   └── utils/                        # Formatting & helper utilities
│       ├── datetime.ts               # Date & time formatting (Lagos timezone)
│       └── validation.ts             # Form validation helpers
│
├── app.json                          # Expo configuration (deep linking, schemes, plugins)
├── eas.json                          # EAS Build profiles (preview APK, development)
├── metro.config.js                   # Monorepo-aware Metro configuration
├── package.json                      # Workspace dependencies & scripts
└── tsconfig.json                     # TypeScript compiler configuration
```

---

## 🛠️ Key Technical Solutions Implemented

### 1. Resilient Payment Redirection on Standalone Android
- **Problem**: In standalone Android builds, redirecting from the Flutterwave browser window back to `mobile://payment-complete` initially produced an `"Unmatched Route"` error because Expo Router required an explicit root route.
- **Solution**: 
  - Registered the explicit route [`apps/mobile/src/app/payment-complete.tsx`](file:///c:/Users/HP/Desktop/matinee/apps/mobile/src/app/payment-complete.tsx).
  - Enforced scheme handling in [`app.json`](file:///c:/Users/HP/Desktop/matinee/apps/mobile/app.json) with `scheme: "mobile"`.
  - Added `WebBrowser.maybeCompleteAuthSession()` in root layout to gracefully close in-app browser sessions upon deep-link interception.
  - Implemented client verification that extracts `tx_ref`, queries `/payments/verify`, updates the booking state, and displays the confirmed pass.

### 2. Cold-Start Authentication Self-Healing
- **Problem**: When launched on a physical Android device, initial network socket initialization latency caused `initAuth()` to fail, leaving the app in a "phantom" session without a valid token.
- **Solution**:
  - Implemented 2-attempt cold-boot retry with backoff in [`AuthContext.tsx`](file:///c:/Users/HP/Desktop/matinee/apps/mobile/src/context/AuthContext.tsx).
  - Added `refreshDemoToken()` in [`ApiClient`](file:///c:/Users/HP/Desktop/matinee/apps/mobile/src/services/api.ts) to proactively fetch a fresh demo token before executing protected booking or payment requests if the token is absent.
  - Added a token listener so `AuthContext` React state automatically synchronizes whenever `ApiClient` acquires credentials.

### 3. My Tickets Latency Resilience & In-Flight Locking
- **Problem**: Resolving historical bookings from cloud PostgreSQL on Railway took ~3.8–4.0s, triggering the mobile client's default 3.5s timeout and displaying `"Tickets Unavailable"`. Furthermore, concurrent mount hooks fired duplicate backend queries.
- **Solution**:
  - Increased timeout for database endpoints (`/bookings`, `/payments`, `/auth`, `/showtimes`) from 3.5s to **12.0s**.
  - Added `isFetchingRef` lock in [`tickets.tsx`](file:///c:/Users/HP/Desktop/matinee/apps/mobile/src/app/(tabs)/tickets.tsx) to prevent concurrent simultaneous queries.
  - Added automatic 2-attempt retry with backoff for transient timeouts.
  - Added an interactive **"Retry"** button in `EmptyState` allowing users to reload reservations on demand.

---

## 🚀 Running Locally

### Prerequisites
- Node.js v20+ or v22+
- npm v10+
- Expo Go app installed on your physical mobile device (available on Google Play / App Store)

### 1. Start Metro Bundler
```bash
# From repository root
npm run dev:mobile

# Or from apps/mobile directory
cd apps/mobile
npx expo start
```

### 2. Connect Your Device
- **Physical Device**: Scan the terminal QR code with your phone camera (iOS) or the **Expo Go** app (Android). Ensure your computer and device share the same Wi-Fi network.
- **Android Emulator**: Press `a` in the terminal to launch the active Android emulator.
- **iOS Simulator**: Press `i` in the terminal (macOS only).

### 3. Build & Verify Android JS Bundle
To compile and test the Hermes bytecode bundle without initiating a full cloud build:
```bash
npx expo export --platform android
```
Output is verified into the `dist/` directory with zero bundling errors.

---

## 🔗 Related Documentation

- [Root Repository README](../../README.md)
- [System Architecture](../../docs/ARCHITECTURE.md)
- [Verified Operational State](../../docs/STATE.md)
- [Mobile Design System Specifications](../../docs/COMPONENTS.md)
