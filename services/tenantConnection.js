/**
 * Capa de conexiones Mongo por organización.
 *
 * Estrategia actual: shared DB con scoping por organizationId.
 * Esta capa queda lista para migrar tenants enterprise a BD dedicada
 * sin reescribir las rutas: si org.dbConnection.uri está poblado,
 * getConnectionForOrg(org) retorna una conexión dedicada (cacheada).
 *
 * Cuando llegue ese momento, las rutas pasarán a usar:
 *   const conn = await getConnectionForOrg(req.organization);
 *   const Client = conn.model('Client', ClientSchema);
 *
 * Por ahora siempre devuelve mongoose.connection (la conexión por defecto).
 */
const mongoose = require('mongoose');

const cache = new Map(); // orgId -> { connection, lastUsed }

async function getConnectionForOrg(org) {
  if (!org || !org.dbConnection || !org.dbConnection.uri) {
    return mongoose.connection;
  }

  const orgId = org._id.toString();
  const cached = cache.get(orgId);
  if (cached && cached.connection.readyState === 1) {
    cached.lastUsed = Date.now();
    return cached.connection;
  }

  const conn = await mongoose.createConnection(org.dbConnection.uri, {
    dbName: org.dbConnection.dbName || undefined,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000
  }).asPromise();

  cache.set(orgId, { connection: conn, lastUsed: Date.now() });
  return conn;
}

async function closeConnectionForOrg(orgId) {
  const cached = cache.get(orgId);
  if (cached) {
    await cached.connection.close().catch(() => {});
    cache.delete(orgId);
  }
}

function listOpenConnections() {
  return Array.from(cache.entries()).map(([orgId, { lastUsed }]) => ({ orgId, lastUsed }));
}

module.exports = {
  getConnectionForOrg,
  closeConnectionForOrg,
  listOpenConnections
};
