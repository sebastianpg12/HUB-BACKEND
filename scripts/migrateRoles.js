/**
 * Migra los roles obsoletos en User y Membership a los nuevos roles genéricos.
 *
 * Mapeo:
 *   manager     → supervisor
 *   employee    → collaborator
 *   development → collaborator
 *   fullstack   → collaborator
 *
 * Idempotente — si ya no quedan docs con roles viejos, no hace nada.
 *
 * Uso:
 *   # Dry-run (muestra cuántos docs se afectarían, sin tocar nada):
 *   node scripts/migrateRoles.js
 *
 *   # Aplicar contra la BD del .env:
 *   node scripts/migrateRoles.js --confirm
 *
 *   # Aplicar contra prod pasando URI por env temporal:
 *   $env:MONGO_URI="mongodb+srv://USER:PASS@host/gems-crm"; node scripts/migrateRoles.js --confirm
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

require('dotenv').config();
const mongoose = require('mongoose');

const CONFIRM = process.argv.includes('--confirm');

const ROLE_MAP = {
  manager:     'supervisor',
  employee:    'collaborator',
  development: 'collaborator',
  fullstack:   'collaborator',
};

const OLD_ROLES = Object.keys(ROLE_MAP);

function previewTarget(uri) {
  try {
    const m = uri.match(/@([^/]+)\/([^?]+)/);
    if (!m) return '(no se pudo parsear)';
    return `${m[1]}/${m[2]}`;
  } catch { return '(no se pudo parsear)'; }
}

async function migrateCollection(collection, label) {
  const counts = {};
  let total = 0;

  for (const oldRole of OLD_ROLES) {
    const count = await collection.countDocuments({ role: oldRole });
    if (count > 0) {
      counts[oldRole] = count;
      total += count;
    }
  }

  if (total === 0) {
    console.log(`  · ${label}: sin docs con roles obsoletos (skip)`);
    return;
  }

  console.log(`  ${label}: ${total} doc(s) a migrar —`, counts);

  if (!CONFIRM) return;

  for (const [oldRole, newRole] of Object.entries(ROLE_MAP)) {
    const result = await collection.updateMany(
      { role: oldRole },
      { $set: { role: newRole } }
    );
    if (result.modifiedCount > 0) {
      console.log(`    ✅ ${oldRole} → ${newRole}: ${result.modifiedCount} actualizado(s)`);
    }
  }
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('[MigrateRoles] MONGO_URI no está definido.');
    process.exit(1);
  }

  console.log(`[MigrateRoles] Target: ${previewTarget(process.env.MONGO_URI)}`);
  if (!CONFIRM) {
    console.log('[MigrateRoles] DRY-RUN — sin --confirm no se modifica nada.\n');
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('[MigrateRoles] Conectado a MongoDB\n');

  const users       = mongoose.connection.collection('users');
  const memberships = mongoose.connection.collection('memberships');

  await migrateCollection(users,       'users');
  await migrateCollection(memberships, 'memberships');

  if (!CONFIRM) {
    console.log('\n[MigrateRoles] Para aplicar los cambios: node scripts/migrateRoles.js --confirm');
  } else {
    console.log('\n[MigrateRoles] ✅ Migración completada');
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
