const mysql = require('mysql2/promise');
const slugify = require('slugify');
require('dotenv').config();

async function runMigration() {
  const dbName = process.env.DB_NAME || 'craft_delhi';
  console.log(`🚀 Starting category slug migration for database: ${dbName}...`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    connectTimeout: 30000,
    enableKeepAlive: true
  });

  try {
    // 1. Check if 'slug' column exists in product_categories
    const [columns] = await connection.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'product_categories' AND COLUMN_NAME = 'slug'`,
      [dbName]
    );

    if (columns.length === 0) {
      console.log(`➕ Adding 'slug' column to product_categories table...`);
      await connection.query(`ALTER TABLE product_categories ADD COLUMN slug VARCHAR(255) NULL AFTER name`);
      console.log(`✅ Column 'slug' added successfully.`);
    } else {
      console.log(`ℹ️ Column 'slug' already exists in product_categories.`);
    }

    // 2. Backfill null or empty slugs for existing categories
    const [categories] = await connection.query(
      `SELECT id, name FROM product_categories WHERE slug IS NULL OR slug = ''`
    );

    if (categories.length === 0) {
      console.log(`✨ All categories already have valid slugs.`);
    } else {
      console.log(`🔄 Backfilling slugs for ${categories.length} categories...`);
      const slugCounts = new Map();

      // Process in batches of 25 for efficient database execution
      const BATCH_SIZE = 25;
      for (let i = 0; i < categories.length; i += BATCH_SIZE) {
        const chunk = categories.slice(i, i + BATCH_SIZE);
        const cases = [];
        const values = [];
        const ids = [];

        for (const cat of chunk) {
          let baseSlug = slugify(cat.name || '', { lower: true, strict: true }) || `category-${cat.id}`;
          let slug = baseSlug;
          let count = slugCounts.get(baseSlug) || 0;
          if (count > 0) {
            slug = `${baseSlug}-${count}`;
          }
          slugCounts.set(baseSlug, count + 1);

          cases.push(`WHEN ? THEN ?`);
          values.push(cat.id, slug);
          ids.push(cat.id);

          console.log(`  - Category ID ${cat.id} ("${cat.name}") -> slug: "${slug}"`);
        }

        if (ids.length > 0) {
          const updateSql = `
            UPDATE product_categories 
            SET slug = CASE id ${cases.join(' ')} END
            WHERE id IN (${ids.map(() => '?').join(',')})
          `;
          await connection.query(updateSql, [...values, ...ids]);
        }
      }
      console.log(`✅ Backfill completed successfully.`);
    }

    console.log(`🎉 Category slug migration finished successfully!`);
  } catch (error) {
    console.error(`❌ Migration failed:`, error.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

runMigration();
