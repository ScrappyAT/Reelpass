import type { Pool } from 'pg';
import { withTransaction } from './migrate';

const plan = `
WITH latest AS (
  SELECT DISTINCT ON (st.auditorium_id, st.movie_id) st.*,
    (st.start_time AT TIME ZONE 'Africa/Lagos')::time AS slot
  FROM showtimes st JOIN cinemas c ON c.id = st.cinema_id
  WHERE c.is_demo AND st.cancelled_at IS NULL AND st.id NOT LIKE 'demo-next-%'
    AND st.end_time > st.start_time AND st.end_time - st.start_time < INTERVAL '6 hours'
  ORDER BY st.auditorium_id, st.movie_id, st.start_time DESC, st.id
), templates AS (
  SELECT latest.*, COUNT(*) OVER (PARTITION BY auditorium_id) AS film_count,
    ROW_NUMBER() OVER (PARTITION BY auditorium_id ORDER BY movie_id) - 1 AS film_index
  FROM latest
), slots AS (
  SELECT t.*, (d.local_date + t.slot)
        AT TIME ZONE 'Africa/Lagos' AS new_start
  FROM templates t CROSS JOIN generate_series(0, 6) AS day(day_offset)
  CROSS JOIN LATERAL (SELECT (NOW() AT TIME ZONE 'Africa/Lagos')::date + day.day_offset AS local_date) d
  WHERE MOD(d.local_date - DATE '2000-01-01', film_count) = film_index
), upcoming AS (
  SELECT 'demo-next-' || md5(auditorium_id || ':' || EXTRACT(EPOCH FROM new_start)::text) AS new_id,
     movie_id, cinema_id, auditorium_id, new_start, new_start + (end_time - start_time) AS new_end,
     format, price_standard_kobo, price_vip_kobo
  FROM slots WHERE new_start > NOW()
), candidates AS (
  SELECT u.* FROM upcoming u WHERE NOT EXISTS (
    SELECT 1 FROM showtimes existing WHERE existing.auditorium_id = u.auditorium_id
      AND existing.cancelled_at IS NULL AND existing.start_time < u.new_end AND existing.end_time > u.new_start
  ) AND NOT EXISTS (SELECT 1 FROM showtimes existing WHERE existing.id = u.new_id)
)
`;

export async function refreshDemoShowtimes(pool: Pool, apply = false) {
  if (!apply) {
    const result = await pool.query<{ count: number }>(plan + 'SELECT COUNT(*)::int AS count FROM candidates');
    return { planned: result.rows[0].count, created: 0, seats: 0 };
  }
  return withTransaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('reelpass-demo-showtime-refresh', 0))");
    const result = await client.query<{ created: number; seats: number }>(plan + `, added AS (
      INSERT INTO showtimes (id,movie_id,cinema_id,auditorium_id,start_time,end_time,format,price_standard_kobo,price_vip_kobo)
      SELECT new_id,movie_id,cinema_id,auditorium_id,new_start,new_end,format,price_standard_kobo,price_vip_kobo
      FROM candidates ON CONFLICT (id) DO NOTHING RETURNING *
    ), inventory AS (
      INSERT INTO showtime_seats (showtime_id,seat_id,price_kobo)
      SELECT a.id,s.id,CASE WHEN s.seat_type='vip' THEN a.price_vip_kobo ELSE a.price_standard_kobo END
      FROM added a JOIN seats s ON s.auditorium_id=a.auditorium_id RETURNING 1
    ) SELECT (SELECT COUNT(*)::int FROM added) AS created, (SELECT COUNT(*)::int FROM inventory) AS seats`);
    return { planned: result.rows[0].created, ...result.rows[0] };
  });
}

if (require.main === module) {
  void (async () => {
    const { getDbPool, closeDbPool } = await import('./pool');
    const { resolveDataMode } = await import('../config/dataMode');
    const { requirePaymentSchema } = await import('./requirePaymentSchema');
    try {
      if (resolveDataMode() !== 'postgres') throw new Error('Showtime planning requires PostgreSQL.');
      const pool = getDbPool();
      if (!pool) throw new Error('Database pool unavailable.');
      await requirePaymentSchema(pool);
      console.log(JSON.stringify(await refreshDemoShowtimes(pool, process.argv.includes('--apply'))));
    } catch (error) {
      console.error('Showtime refresh failed:', error instanceof Error ? error.name : 'unknown');
      process.exitCode = 1;
    } finally { await closeDbPool(); }
  })();
}
