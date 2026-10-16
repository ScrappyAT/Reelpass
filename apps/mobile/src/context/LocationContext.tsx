import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { Cinema } from '@matinee/shared';
import { api, FALLBACK_CINEMAS } from '../services/api';

export const SUPPORTED_CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan'] as const;
export type NigerianCity = (typeof SUPPORTED_CITIES)[number];

export const DEFAULT_CITY: NigerianCity = 'Lagos';

interface LocationContextType {
  /** All demo cinemas loaded from the backend (Nigerian cities only). */
  cinemas: Cinema[];
  /** Currently selected city — defaults to Lagos. */
  city: string;
  /** Cinemas that belong to the selected city. */
  cityCinemas: Cinema[];
  /** Specifically chosen cinema inside the city (defaults to the first one). */
  selectedCinema: Cinema | null;
  selectCity: (city: string) => void;
  selectCinema: (cinemaId: string) => void;
  loading: boolean;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export const LocationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cinemas, setCinemas] = useState<Cinema[]>(FALLBACK_CINEMAS);
  const [city, setCity] = useState<string>(DEFAULT_CITY);
  const [selectedCinemaId, setSelectedCinemaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCinemas = async () => {
      try {
        const res = await api.getCinemas();
        if (res.success && res.data && res.data.length > 0) {
          setCinemas(res.data);
        }
      } catch (e) {
        console.warn('Cinemas unavailable — using built-in Lagos-first demo list.', e);
      } finally {
        setLoading(false);
      }
    };

    loadCinemas();
  }, []);

  const cityCinemas = useMemo(
    () => cinemas.filter((c) => c.city.toLowerCase() === city.toLowerCase()),
    [cinemas, city]
  );

  const selectedCinema = useMemo(() => {
    if (!cityCinemas.length) return null;
    const match = cityCinemas.find((c) => c.id === selectedCinemaId);
    return match || cityCinemas[0];
  }, [cityCinemas, selectedCinemaId]);

  const selectCity = (nextCity: string) => {
    setCity(nextCity);
    // Reset selection so the first cinema of the new city becomes the default.
    setSelectedCinemaId(null);
  };

  const selectCinema = (cinemaId: string) => {
    const cinema = cinemas.find((c) => c.id === cinemaId);
    if (cinema) {
      setCity(cinema.city);
      setSelectedCinemaId(cinemaId);
    }
  };

  return (
    <LocationContext.Provider
      value={{
        cinemas,
        city,
        cityCinemas,
        selectedCinema,
        selectCity,
        selectCinema,
        loading,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
};

export const useLocation = () => {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return context;
};

/** Format a cinema's location label, e.g. "Lekki, Lagos". */
export function cinemaLocationLabel(cinema: Pick<Cinema, 'city' | 'neighborhood'>): string {
  return cinema.neighborhood ? `${cinema.neighborhood}, ${cinema.city}` : cinema.city;
}
