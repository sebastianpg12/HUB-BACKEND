/**
 * Contexto de tenant por-request usando AsyncLocalStorage.
 *
 * Cada request HTTP que pasa por el middleware `tenantContextMiddleware` queda envuelta
 * en un store con { organizationId, userId, bypass }. Cualquier query Mongoose ejecutada
 * dentro de ese async chain puede leer el contexto vía `getTenantContext()`.
 *
 * El plugin `tenantScope` usa esto para inyectar { organizationId } automáticamente en
 * find/findOne/count/update/delete, y para setearlo en .save() si falta.
 *
 * Casos especiales que necesitan saltarse el scope (migraciones, jobs cross-tenant):
 *   runWithoutTenant(async () => { await Model.find({}); });
 */
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function tenantContextMiddleware(req, res, next) {
  const context = {
    organizationId: req.organizationId || null,
    userId: req.user?._id || null,
    bypass: false
  };
  storage.run(context, () => next());
}

function getTenantContext() {
  return storage.getStore() || null;
}

/**
 * Ejecuta un bloque sin scoping de tenant (admin/migración).
 * USAR CON CUIDADO — desactiva el filtro automático.
 */
function runWithoutTenant(fn) {
  const current = storage.getStore() || {};
  return storage.run({ ...current, bypass: true }, fn);
}

/**
 * Ejecuta un bloque dentro del contexto de una org específica (jobs, sockets).
 */
function runWithTenant(organizationId, fn) {
  return storage.run({ organizationId, userId: null, bypass: false }, fn);
}

module.exports = {
  tenantContextMiddleware,
  getTenantContext,
  runWithoutTenant,
  runWithTenant
};
