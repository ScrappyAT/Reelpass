import fs from 'fs';
import path from 'path';
import { getDbPool } from './pool';
import { memoryStore } from './memoryStore';

export async function seedDatabase() {
  const pool = getDbPool();
  if (!pool) {
    console.log('ℹ️ [Seed] No PostgreSQL connection available. Skipping DB migration and using in-memory store.');
    return;
  }

  try {
    const client = await pool.connect();
    console.log('🌱 [Seed] Running schema migration on PostgreSQL...');

    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await client.query(sql);
      console.log('✅ [Seed] Schema tables created successfully.');
    }

    // Check if cinemas already seeded
    const res = await client.query('SELECT COUNT(*) FROM cinemas');
    if (parseInt(res.rows[0].count, 10) === 0) {
      console.log('🌱 [Seed] Seeding initial cinemas, auditoriums, and seats...');

      for (const cinema of Array.from(memoryStore.cinemas.values())) {
        await client.query(
          `INSERT INTO cinemas (id, name, city, address, postal_code, phone, latitude, longitude, amenities, image_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
          [
            cinema.id,
            cinema.name,
            cinema.city,
            cinema.address,
            cinema.postalCode,
            cinema.phone,
            cinema.latitude,
            cinema.longitude,
            cinema.amenities,
            cinema.imageUrl,
          ]
        );
      }

      console.log('✅ [Seed] Seed completed.');
    } else {
      console.log('ℹ️ [Seed] Database already has cinema records. Seed bypassed.');
    }

    client.release();
  } catch (error: any) {
    console.warn(`⚠️ [Seed] PostgreSQL seed could not run: ${error.message}. Continuing with in-memory store.`);
  }
}

// Direct execution support
if (require.main === module) {
  seedDatabase().then(() => {
    console.log('Done');
    process.exit(0);
  });
}
