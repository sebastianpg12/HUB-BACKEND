/**
 * Plugin Mongoose que inyecta `organizationId` automáticamente en cada query
 * y en cada .save() cuando hay un contexto de tenant activo.
 *
 * Defensa principal contra fugas cross-tenant. Aún así, las rutas DEBERÍAN
 * pasar organizationId explícitamente como defensa en profundidad.
 *
 * Si no hay contexto (ej. scripts), el plugin no hace nada — el desarrollador
 * debe filtrar manualmente o usar runWithoutTenant explícitamente.
 */
const { getTenantContext } = require('../../services/tenantContext');

const QUERY_HOOKS = [
  'count',
  'countDocuments',
  'estimatedDocumentCount',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndRemove',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany'
];

function tenantScopePlugin(schema) {
  // Solo aplica a schemas que tengan campo organizationId. Modelos globales (User,
  // Organization, Membership) se saltan automáticamente.
  if (!schema.path('organizationId')) return;

  // Inyectar filtro en queries
  QUERY_HOOKS.forEach((hook) => {
    schema.pre(hook, function applyTenantFilter(next) {
      const ctx = getTenantContext();
      if (!ctx || ctx.bypass) return next();
      if (!ctx.organizationId) return next();

      const currentFilter = this.getFilter();
      // Si el código ya filtró por una org diferente, NO sobrescribimos pero alertamos.
      if (currentFilter.organizationId && String(currentFilter.organizationId) !== String(ctx.organizationId)) {
        console.warn('[tenantScope] Query con organizationId diferente al contexto. Mantengo el explícito.');
        return next();
      }
      this.where({ organizationId: ctx.organizationId });
      next();
    });
  });

  // Aggregate: inyectar $match al principio
  schema.pre('aggregate', function applyTenantMatch(next) {
    const ctx = getTenantContext();
    if (!ctx || ctx.bypass) return next();
    if (!ctx.organizationId) return next();

    const pipeline = this.pipeline();
    const first = pipeline[0];
    if (!(first && first.$match && first.$match.organizationId)) {
      pipeline.unshift({ $match: { organizationId: ctx.organizationId } });
    }
    next();
  });

  // IMPORTANTE: usar pre('validate') no pre('save') — la validación corre antes
  // de save, y como organizationId es required, fallaría antes de que pre('save')
  // pueda inyectarlo. pre('validate') corre primero en el ciclo de save.
  // Force-override: aunque req.body trajera otro organizationId, el contexto gana.
  schema.pre('validate', function applyTenantOnValidate(next) {
    const ctx = getTenantContext();
    if (!ctx || ctx.bypass) return next();
    if (ctx.organizationId) {
      if (this.organizationId && String(this.organizationId) !== String(ctx.organizationId)) {
        console.warn('[tenantScope] Intento de save con organizationId distinto al contexto — overrideando.');
      }
      this.organizationId = ctx.organizationId;
    }
    next();
  });

  // insertMany: force-set organizationId del contexto en cada doc
  schema.pre('insertMany', function applyTenantOnInsertMany(next, docs) {
    const ctx = getTenantContext();
    if (!ctx || ctx.bypass || !ctx.organizationId) return next();
    if (Array.isArray(docs)) {
      docs.forEach(d => { d.organizationId = ctx.organizationId; });
    }
    next();
  });

  // En findOneAndUpdate / updateOne / updateMany, evitar que $set.organizationId
  // permita cambiar la org de un documento ajeno.
  ['findOneAndUpdate', 'updateOne', 'updateMany', 'replaceOne'].forEach((hook) => {
    schema.pre(hook, function preventOrgChange(next) {
      const ctx = getTenantContext();
      if (!ctx || ctx.bypass) return next();
      const update = this.getUpdate() || {};
      if (update.organizationId) delete update.organizationId;
      if (update.$set && update.$set.organizationId) delete update.$set.organizationId;
      this.setUpdate(update);
      next();
    });
  });
}

module.exports = tenantScopePlugin;
