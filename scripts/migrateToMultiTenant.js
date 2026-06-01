/**
 * Migración a arquitectura multi-tenant.
 *
 * Pasos:
 *  1. Crear (o reutilizar) la organización default "GEMS Innovations" con slug "gems".
 *  2. Backfillear organizationId en todas las colecciones de tenant.
 *  3. Crear Memberships para cada usuario existente apuntando a la org default,
 *     migrando role + permissions desde el User.
 *  4. Mover el documento Setting de branding global a la org default (si existe).
 *
 * Idempotente: re-ejecutar es seguro. Solo backfillea documentos sin organizationId.
 *
 * Uso:
 *   node scripts/migrateToMultiTenant.js
 */

// Fix DNS SRV en Windows / Node 17+
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

require('dotenv').config();
const mongoose = require('mongoose');

const DEFAULT_ORG = {
  name: process.env.DEFAULT_ORG_NAME || 'GEMS Innovations',
  slug: process.env.DEFAULT_ORG_SLUG || 'gems',
  plan: 'enterprise',
  branding: {
    displayName: 'GEMS Innovations',
    primaryColor: '#8b5cf6',
    accentColor: '#8b5cf6'
  }
};

// Modelos a migrar (todos los que ahora tienen organizationId)
const TENANT_MODELS = [
  'Activity', 'Board', 'Case', 'ChatRoom', 'Client', 'Doc',
  'FixedExpense', 'Followup', 'Issue', 'Message', 'Minute',
  'Notification', 'Payment', 'ProspectConversation', 'Role',
  'Setting', 'Task', 'Team', 'Ticket', 'Transaction', 'Wiki'
];

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('[Migration] MONGO_URI no está definido en .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('[Migration] Conectado a MongoDB');

  const Organization = require('../models/Organization');
  const Membership = require('../models/Membership');
  const User = require('../models/User');

  // 1. Crear o reutilizar la org default
  let defaultOrg = await Organization.findOne({ slug: DEFAULT_ORG.slug });
  if (!defaultOrg) {
    defaultOrg = await Organization.create(DEFAULT_ORG);
    console.log(`[Migration] Organización default creada: ${defaultOrg.name} (${defaultOrg._id})`);
  } else {
    console.log(`[Migration] Organización default existente: ${defaultOrg.name} (${defaultOrg._id})`);
  }

  // 2. Backfill organizationId en todos los modelos de tenant
  for (const modelName of TENANT_MODELS) {
    try {
      const Model = require(`../models/${modelName}`);
      const result = await Model.updateMany(
        { $or: [{ organizationId: { $exists: false } }, { organizationId: null }] },
        { $set: { organizationId: defaultOrg._id } }
      );
      console.log(`[Migration] ${modelName}: ${result.modifiedCount} documentos actualizados`);
    } catch (err) {
      console.error(`[Migration] Error en ${modelName}:`, err.message);
    }
  }

  // 3. Crear Memberships para todos los usuarios existentes
  const users = await User.find({});
  console.log(`[Migration] Procesando ${users.length} usuarios...`);

  for (const user of users) {
    const existing = await Membership.findOne({
      user: user._id,
      organization: defaultOrg._id
    });

    if (existing) {
      console.log(`  · ${user.email}: membership ya existe`);
      continue;
    }

    // Migrar permisos del User al Membership
    const userPerms = user.permissions ? user.permissions.toObject() : {};
    const isFirstAdmin = user.role === 'admin';

    await Membership.create({
      user: user._id,
      organization: defaultOrg._id,
      role: user.role || 'employee',
      isOwner: isFirstAdmin,
      status: 'active',
      department: user.department || null,
      departmentRole: user.departmentRole || 'member',
      position: user.position || null,
      supervisor: user.supervisor || null,
      permissions: {
        dashboard: userPerms.dashboard !== undefined ? userPerms.dashboard : true,
        clients: userPerms.clients || { view: true },
        activities: userPerms.activities || { view: true },
        reports: userPerms.reports || { view: false, export: false },
        accounting: userPerms.accounting || { view: false },
        cases: userPerms.cases || { view: true },
        team: userPerms.team || { view: false }
      },
      acceptedAt: user.createdAt || new Date()
    });
    console.log(`  · ${user.email}: membership creado (${user.role}${isFirstAdmin ? ', owner' : ''})`);
  }

  // 4. Verificar el setting de branding
  const Setting = require('../models/Setting');
  const brandSettings = await Setting.find({ key: 'brand' });
  console.log(`[Migration] ${brandSettings.length} setting(s) 'brand' encontrados, todos en org default ahora`);

  // Si la org default no tiene branding personalizado pero existe un Setting 'brand', adoptarlo
  if (brandSettings.length > 0 && (!defaultOrg.branding || !defaultOrg.branding.logo)) {
    const brand = brandSettings[0].value || {};
    defaultOrg.branding = {
      displayName: brand.name || defaultOrg.branding?.displayName,
      logo: brand.logo || defaultOrg.branding?.logo || null,
      primaryColor: brand.accentColor || defaultOrg.branding?.primaryColor || '#8b5cf6',
      accentColor: brand.accentColor || defaultOrg.branding?.accentColor || '#8b5cf6',
      darkMode: brand.darkMode || false
    };
    await defaultOrg.save();
    console.log('[Migration] Branding del Setting global adoptado por la org default');
  }

  console.log('\n[Migration] ✅ Completada exitosamente');
  console.log(`[Migration] Org default ID: ${defaultOrg._id}`);
  console.log('[Migration] Guarda este ID si necesitas referencias manuales.');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('[Migration] ❌ Error fatal:', err);
  process.exit(1);
});
