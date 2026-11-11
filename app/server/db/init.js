const fs = require('fs');
const path = require('path');

/**
 * DATABASE INITIALIZATION & MIGRATIONS
 * Handles creation of tables, schema upgrades, and initial provider seeding.
 */
module.exports = (db) => {
    // 1. Initial Tables
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, type TEXT DEFAULT 'xtream', timeshift INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS categories (id TEXT NOT NULL, name TEXT NOT NULL, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, id));
        CREATE TABLE IF NOT EXISTS channels (stream_id INTEGER NOT NULL, name TEXT NOT NULL, stream_icon TEXT, category_id TEXT, num INTEGER, epg_channel_id TEXT, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, stream_id));
        CREATE TABLE IF NOT EXISTS epg_listings (id TEXT PRIMARY KEY, stream_id INTEGER, provider_id TEXT, title TEXT, description TEXT, start_time TEXT, stop_time TEXT);
        CREATE TABLE IF NOT EXISTS vod_categories (id TEXT NOT NULL, name TEXT NOT NULL, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, id));
        CREATE TABLE IF NOT EXISTS series_categories (id TEXT NOT NULL, name TEXT NOT NULL, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, id));
        CREATE TABLE IF NOT EXISTS vod_active (stream_id INTEGER NOT NULL, name TEXT NOT NULL, stream_icon TEXT, category_id TEXT, container_extension TEXT, rating TEXT, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, stream_id));
        CREATE TABLE IF NOT EXISTS series_active (series_id INTEGER NOT NULL, name TEXT NOT NULL, cover TEXT, category_id TEXT, rating TEXT, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, series_id));
        CREATE TABLE IF NOT EXISTS watch_history (user_id TEXT, stream_id TEXT, resume_time INTEGER, duration INTEGER, last_watched TEXT, type TEXT, parent_id TEXT, name TEXT, poster TEXT, PRIMARY KEY (user_id, stream_id));
        CREATE TABLE IF NOT EXISTS metadata_overrides (item_id TEXT, type TEXT, poster TEXT, backdrop TEXT, logo TEXT, PRIMARY KEY (item_id, type));
        CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'xtream', provider_id TEXT, username TEXT, password TEXT, m3u_url TEXT, is_active INTEGER DEFAULT 0, last_used TEXT, created_at TEXT, user_agent TEXT, timeshift INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS favorites (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, item_id TEXT NOT NULL, item_type TEXT NOT NULL, name TEXT, poster TEXT, provider_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, item_id, item_type));
        CREATE TABLE IF NOT EXISTS recent_channels (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, stream_id INTEGER NOT NULL, name TEXT, stream_icon TEXT, provider_id TEXT, last_watched TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, stream_id));
    `);

    // 2. Incremental Migrations
    const runMigration = (table, column, alterSql) => {
        try {
            const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all();
            if (!tableInfo.find(c => c.name === column)) {
                db.exec(alterSql);
                console.log(`[DB] Migration: Added ${column} to ${table}.`);
            }
        } catch (e) {
            console.error(`[DB] Migration ${column} failed:`, e.message);
        }
    };

    runMigration('providers', 'timeshift', "ALTER TABLE providers ADD COLUMN timeshift INTEGER DEFAULT 0");
    runMigration('watch_history', 'type', "ALTER TABLE watch_history ADD COLUMN type TEXT; ALTER TABLE watch_history ADD COLUMN parent_id TEXT; ALTER TABLE watch_history ADD COLUMN name TEXT; ALTER TABLE watch_history ADD COLUMN poster TEXT;");
    runMigration('epg_listings', 'provider_id', "ALTER TABLE epg_listings ADD COLUMN provider_id TEXT");

    const migrateProviderScopedTable = (table, expectedPrimaryKey, createSql, copySql) => {
        const primaryKey = db.prepare(`PRAGMA table_info(${table})`).all()
            .filter(column => column.pk > 0)
            .sort((left, right) => left.pk - right.pk)
            .map(column => column.name);
        if (primaryKey.join(',') === expectedPrimaryKey.join(',')) return;

        const temporaryTable = `${table}_provider_scoped`;
        db.transaction(() => {
            db.exec(`DROP TABLE IF EXISTS ${temporaryTable}`);
            db.exec(createSql.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${temporaryTable}`));
            db.exec(copySql.replace(`INSERT OR REPLACE INTO ${table}`, `INSERT OR REPLACE INTO ${temporaryTable}`));
            db.exec(`DROP TABLE ${table}`);
            db.exec(`ALTER TABLE ${temporaryTable} RENAME TO ${table}`);
        })();
        console.log(`[DB] Migration: Scoped ${table} primary key by provider.`);
    };

    migrateProviderScopedTable(
        'categories',
        ['provider_id', 'id'],
        'CREATE TABLE categories (id TEXT NOT NULL, name TEXT NOT NULL, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, id))',
        "INSERT OR REPLACE INTO categories (id, name, provider_id) SELECT id, name, COALESCE(provider_id, 'legacy') FROM categories"
    );
    migrateProviderScopedTable(
        'channels',
        ['provider_id', 'stream_id'],
        'CREATE TABLE channels (stream_id INTEGER NOT NULL, name TEXT NOT NULL, stream_icon TEXT, category_id TEXT, num INTEGER, epg_channel_id TEXT, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, stream_id))',
        "INSERT OR REPLACE INTO channels (stream_id, name, stream_icon, category_id, num, epg_channel_id, provider_id) SELECT stream_id, name, stream_icon, category_id, num, epg_channel_id, COALESCE(provider_id, 'legacy') FROM channels"
    );
    migrateProviderScopedTable(
        'vod_categories',
        ['provider_id', 'id'],
        'CREATE TABLE vod_categories (id TEXT NOT NULL, name TEXT NOT NULL, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, id))',
        "INSERT OR REPLACE INTO vod_categories (id, name, provider_id) SELECT id, name, COALESCE(provider_id, 'legacy') FROM vod_categories"
    );
    migrateProviderScopedTable(
        'series_categories',
        ['provider_id', 'id'],
        'CREATE TABLE series_categories (id TEXT NOT NULL, name TEXT NOT NULL, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, id))',
        "INSERT OR REPLACE INTO series_categories (id, name, provider_id) SELECT id, name, COALESCE(provider_id, 'legacy') FROM series_categories"
    );
    migrateProviderScopedTable(
        'vod_active',
        ['provider_id', 'stream_id'],
        'CREATE TABLE vod_active (stream_id INTEGER NOT NULL, name TEXT NOT NULL, stream_icon TEXT, category_id TEXT, container_extension TEXT, rating TEXT, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, stream_id))',
        "INSERT OR REPLACE INTO vod_active (stream_id, name, stream_icon, category_id, container_extension, rating, provider_id) SELECT stream_id, name, stream_icon, category_id, container_extension, rating, COALESCE(provider_id, 'legacy') FROM vod_active"
    );
    migrateProviderScopedTable(
        'series_active',
        ['provider_id', 'series_id'],
        'CREATE TABLE series_active (series_id INTEGER NOT NULL, name TEXT NOT NULL, cover TEXT, category_id TEXT, rating TEXT, provider_id TEXT NOT NULL, PRIMARY KEY (provider_id, series_id))',
        "INSERT OR REPLACE INTO series_active (series_id, name, cover, category_id, rating, provider_id) SELECT series_id, name, cover, category_id, rating, COALESCE(provider_id, 'legacy') FROM series_active"
    );

    // 3. Provider Seeding (Locked/Whitelabel Mode)
    try {
        const { getProviderConfigPath } = require('../runtimePaths');
        const configPath = getProviderConfigPath();

        if (fs.existsSync(configPath)) {
            const providers = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const insert = db.prepare('INSERT OR REPLACE INTO providers (id, name, url, type, timeshift) VALUES (?, ?, ?, ?, ?)');

            db.transaction(() => {
                // If using config, it's the absolute source
                db.prepare('DELETE FROM providers').run();
                for (const p of providers) {
                    insert.run(p.id, p.name, p.url, p.type || 'xtream', p.timeshift || 0);
                }
            })();
            console.log(`[DB] Successfully loaded ${providers.length} whitelabel providers.`);
        }
    } catch (err) {
        console.error('[DB] Provider seed failed:', err.message);
    }
};
