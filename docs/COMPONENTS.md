# ReelPass — UI Component System

**Project:** ReelPass / Matinee  
**Platform:** Expo React Native, TypeScript, Expo Router  
**Reviewed:** 21 October 2026

## 1. Design system source of truth

The mobile UI imports centralized values from `apps/mobile/src/theme/tokens.ts` via the theme module. Important examples:

| Token | Value | Purpose |
| --- | --- | --- |
| `colors.background` | `#0B0B0F` | Main dark background |
| `colors.surface` | `#151520` | Cards and panels |
| `colors.surfaceElevated` | `#1D1D2C` | Raised surfaces |
| `colors.gold` | `#E5A93C` | Brand/accent and selected seat |
| `colors.goldLight` | `#F5C66B` | Accent highlight |
| `colors.textPrimary` | `#F7F4EB` | Primary content |
| `colors.textSecondary` | `#B8B5AD` | Supporting text |
| `colors.border` | `#28283B` | Surface boundaries |
| `colors.success` | `#10B981` | Positive feedback |
| `colors.error` | `#EF4444` | Errors |

Typography variants include `display` (32px), `h1` (26px), `h2` (20px), `h3` (17px), `bodyLarge` (16px), `body` (14px), `caption` (12px), and `micro` (10px), plus bold body text. Spacing follows a 0–48 scale; radii range from 0 to 24 with a pill value of 9999. Shared shadow presets include `subtle`, `card` and `goldGlow`.

## 2. Twelve reusable UI components

The public exports are defined in `apps/mobile/src/components/ui/index.ts`:

| Component | File | Responsibility |
| --- | --- | --- |
| `Button` | `Button.tsx` | Primary/secondary actions, disabled and loading behavior |
| `Text` | `Text.tsx` | Semantic typography variants and theme colors |
| `Card` | `Card.tsx` | Reusable content containers and surface variants |
| `MovieCard` | `MovieCard.tsx` | Movie artwork and catalogue metadata |
| `Input` | `Input.tsx` | Consistent form fields |
| `Chip` | `Chip.tsx` | Filters, tags and compact choices |
| `Badge` | `Badge.tsx` | Status and category labels |
| `BottomSheet` | `BottomSheet.tsx` | Booking/payment and ticket-detail overlays |
| `Skeleton` | `Skeleton.tsx` | Loading placeholders; also exports skeleton helpers |
| `Toast` | `Toast.tsx` | Brief feedback messages |
| `EmptyState` | `EmptyState.tsx` | No-results and error/retry messaging |
| `SeatMap` | `SeatMap.tsx` | Interactive auditorium seating and seat selection |

`apps/mobile/src/app/gallery.tsx` is an in-app component gallery demonstrating the reusable components with sample content; it is not a real cinema booking.

## 3. Seat states and seat types

The seat map distinguishes operational **states** from physical **types**. Available, selected, held and sold are presentation states. Wheelchair-accessible and VIP describe seat types and can affect appearance/pricing.

| Presentation | Color / border token | Meaning |
| --- | --- | --- |
| Available | `seatAvailable` / `seatAvailableBorder` | Can be selected |
| Selected | `seatSelected` / `seatSelectedBorder` | Selected locally by user |
| Held | `seatHeld` / `seatHeldBorder` | Temporarily reserved |
| Sold | `seatSold` / `seatSoldBorder` | Already purchased |
| Accessible | `seatWheelchair` / `seatWheelchairBorder` | Wheelchair-accessible type |
| VIP | `seatVipBorder` | VIP seat type |

Server availability and pricing remain authoritative. The seat-map UI does not itself complete a reservation.

## 4. App screens and navigation

Expo Router screens in `apps/mobile/src/app` include onboarding, login, registration, Discover, Search, My Tickets, Profile, movie details, showtime selection, seat selection and component gallery. The tab bar exposes Discover, Search, My Tickets and Profile. Some booking experiences are implemented as a `BottomSheet`, rather than as separate navigation routes.

The **reservation and payment states** are: pending hold, checkout initialization/verification, successful confirmed booking, failed payment and cancelled checkout. QR admission access is for confirmed bookings. The mobile code uses Flutterwave checkout with backend verification; an actual end-to-end successful payment was **not verified** during this documentation pass because the deployed API was unavailable.

## 5. UX behavior and accessibility

The code includes haptic feedback on supported interactions, loading skeletons and activity indicators, empty/error states, image loading and fallbacks, scrolling layouts, safe-area spacing and themed dark surfaces. Verify focus order, touch targets, contrast and screen-reader labels on a physical device; this document does not claim a completed formal accessibility audit.

## 6. Figma correspondence

Figma file: https://www.figma.com/design/Gh0kzUtGs4547W19iH4WVa/Dev-and-Design-Bootcamp-Learning-Phase

The file contains imported Stitch visual concepts, a token board, added reference screens, seat-state documentation and payment-state documentation. **Concept frames and sample booking data are illustrative** and must not be interpreted as screenshots of successful live transactions. The implementation is the source of truth for actual app behavior.

## 7. Component maintenance guidelines

- Use shared tokens instead of introducing new hardcoded colors or spacing.
- Extend existing components with typed props and variants rather than duplicating UI.
- Keep status labels aligned with backend booking/payment status.
- Show actionable empty/error states; do not mask network failures as success.
- Review both the component gallery and the real screen after a shared-component change.

## 8. Source files

- `apps/mobile/src/components/ui/index.ts`
- `apps/mobile/src/components/ui/*.tsx`
- `apps/mobile/src/theme/tokens.ts`
- `apps/mobile/src/app/gallery.tsx`
- `apps/mobile/src/app/(tabs)/_layout.tsx`
- `apps/mobile/src/app/booking/seats/[showtimeId].tsx`
