import React, { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Movie } from '@matinee/shared';
import { colors, radii, spacing } from '../../theme';
import {
  Input,
  Text,
  MovieCard,
  Chip,
  Skeleton,
  EmptyState,
} from '../../components/ui';
import { api } from '../../services/api';

const QUICK_TAGS = ['Dune', 'Oppenheimer', 'IMAX', 'Sci-Fi', 'Action'];

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (searchTerm: string) => {
    if (!searchTerm.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    setHasSearched(true);
    try {
      const res = await api.searchMovies(searchTerm.trim());
      if (res.success && res.data) {
        setResults(res.data);
      }
    } catch (e) {
      console.warn('Search failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
  };

  const handleQuickTag = (tag: string) => {
    setQuery(tag);
    handleSearch(tag);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Search Header */}
      <View style={styles.header}>
        <Text variant="h1" style={styles.headerTitle}>
          Search Catalog
        </Text>
        <Text variant="body" color="secondary">
          Find movies, IMAX releases, directors, and genres
        </Text>

        <View style={styles.searchBarRow}>
          <Input
            placeholder="Search titles, actors, genres..."
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              if (!text.trim()) setHasSearched(false);
            }}
            onSubmitEditing={() => handleSearch(query)}
            returnKeyType="search"
            iconLeading={<Ionicons name="search" size={20} color={colors.gold} />}
            iconTrailing={
              query.length > 0 ? (
                <TouchableOpacity onPress={handleClear}>
                  <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : null
            }
            containerStyle={styles.searchInput}
          />
        </View>

        {/* Quick Search Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagsContainer}
        >
          {QUICK_TAGS.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              selected={query.toLowerCase() === tag.toLowerCase()}
              onPress={() => handleQuickTag(tag)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Results Section */}
      <View style={styles.resultsContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            {[1, 2, 3].map((k) => (
              <View key={k} style={styles.skeletonRow}>
                <Skeleton width={80} height={115} borderRadius={radii.md} />
                <View style={styles.skeletonContent}>
                  <Skeleton width="70%" height={18} />
                  <Skeleton width="90%" height={14} />
                  <Skeleton width="40%" height={14} />
                </View>
              </View>
            ))}
          </View>
        ) : hasSearched && results.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title="No Titles Found"
            description={`We couldn't find any movie matching "${query}". Try searching for Dune, Oppenheimer, or Interstellar.`}
            actionTitle="Clear Search"
            onAction={handleClear}
          />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.resultsList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <MovieCard
                movie={item}
                variant="horizontal"
                onPress={() => router.push(`/movie/${item.id}`)}
              />
            )}
            ListHeaderComponent={
              hasSearched && results.length > 0 ? (
                <Text variant="caption" color="secondary" style={styles.resultsCount}>
                  Showing {results.length} matching screenings
                </Text>
              ) : null
            }
            ListEmptyComponent={
              !hasSearched ? (
                <View style={styles.emptyPrompt}>
                  <Ionicons name="film-outline" size={48} color={colors.border} />
                  <Text variant="body" color="tertiary" align="center" style={styles.promptText}>
                    Search across our curated selection of Hollywood blockbusters and IMAX screenings.
                  </Text>
                </View>
              ) : null
            }
          />
        )}
      </View>
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
  searchBarRow: {
    marginTop: spacing.md,
  },
  searchInput: {
    marginBottom: spacing.xs,
  },
  tagsContainer: {
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  resultsContainer: {
    flex: 1,
  },
  resultsCount: {
    marginBottom: spacing.md,
  },
  resultsList: {
    padding: spacing.lg,
    paddingBottom: 40,
  },
  loadingContainer: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surfaceCard,
    padding: spacing.sm,
    borderRadius: radii.lg,
  },
  skeletonContent: {
    flex: 1,
    justifyContent: 'space-around',
  },
  emptyPrompt: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: spacing.xxl,
  },
  promptText: {
    marginTop: spacing.md,
    maxWidth: 260,
  },
});
