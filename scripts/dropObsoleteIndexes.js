/**
 * Borra índices únicos globales que fueron reemplazados por unique compound
 * con organizationId durante la migración a multi-tenant.
 *
 * Idempotente — si el índice ya no existe, lo ignora.
 *
 * Uso seguro:
 *   # Contra la BD del .env (dev):
 *   node scripts/dropObsoleteIndexes.js --confirm
 *
 *   # Contra otra BD (ej. prod), pasando la URI por env temporal:
 *   $env:MONGO_URI="mongodb+srv://USER:PASS@cluster/gems-crm"; node scripts/dropObsoleteIndexes.js --confirm
 *
 *   # Dry-run: muestra a qué BD se conectaría sin hacer cambios:
 *   node scripts/dropObsoleteIndexes.js
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

require('dotenv').config();
const mongoose = require('mongoose');

const CONFIRM = process.argv.includes('--confirm');

const OBSOLETE = [
  { collection: 'roles', index: 'name_1' },
  { collection: 'tickets', index: 'ticketNumber_1' }
];

function previewTarget(uri) {
  // No imprimir credenciales. Solo el host + dbName.
  try {
    const m = uri.match(/@([^/]+)\/([^?]+)/);
    if (!m) return '(no se pudo parsear)';
    return `${m[1]}/${m[2]}`;
  } catch { return '(no se pudo parsear)'; }
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('[Cleanup] MONGO_URI no está definido.');
    process.exit(1);
  }
  console.log(`[Cleanup] Target: ${previewTarget(process.env.MONGO_URI)}`);

  if (!CONFIRM) {
    console.log('\n[Cleanup] DRY-RUN. Sin --confirm no se ejecuta nada.');
    console.log('Si la BD destino es correcta, vuelve a correr con --confirm:');
    console.log('  node scripts/dropObsoleteIndexes.js --confirm\n');
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('[Cleanup] Conectado a MongoDB');

  for (const { collection, index } of OBSOLETE) {
    try {
      const coll = mongoose.connection.collection(collection);
      const indexes = await coll.indexes();
      const exists = indexes.find(i => i.name === index);
      if (!exists) {
        console.log(`  · ${collection}.${index}: no existe (skip)`);
        continue;
      }
      await coll.dropIndex(index);
      console.log(`  ✅ ${collection}.${index}: eliminado`);
    } catch (err) {
      console.error(`  ❌ ${collection}.${index}:`, err.message);
    }
  }

  // Recrear índices definidos en los schemas (los compound nuevos)
  console.log('[Cleanup] Sincronizando índices de schemas...');
  mongoose.plugin(require('../models/plugins/tenantScope'));
  const Role = require('../models/Role');
  const Ticket = require('../models/Ticket');
  await Role.syncIndexes();
  await Ticket.syncIndexes();
  console.log('  ✅ Índices de Role y Ticket sincronizados');

  console.log('\n[Cleanup] ✅ Completado');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
