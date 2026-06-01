// ─── GEMS Hub — Test Data Seed ────────────────────────────────────
// Uso: node scripts/seedTestData.js
// Crea: 3 usuarios, 4 clientes, 5 actividades, 3 casos, 3 tickets, 3 prospectos

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const mongoose = require('mongoose');

const User     = require('../models/User');
const Client   = require('../models/Client');
const Activity = require('../models/Activity');
const Case     = require('../models/Case');
const Ticket   = require('../models/Ticket');
const Prospect = require('../models/ProspectConversation');

const d = (days) => new Date(Date.now() + days * 86400000);

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Conectado a gems-hub\n');

  // ── 1. USUARIOS ────────────────────────────────────────────────
  console.log('👤 Creando usuarios...');
  await User.deleteMany({ email: { $in: [
    'maria.lopez@gems.cr',
    'carlos.vargas@gems.cr',
    'ana.mora@gems.cr',
  ]}});

  const [maria, carlos, ana] = await User.insertMany([
    {
      name: 'María López',
      email: 'maria.lopez@gems.cr',
      password: 'Gems12-',
      role: 'supervisor',
      position: 'Gerente Comercial',
      department: 'Ventas',
      isActive: true,
      permissions: {
        dashboard: true,
        clients:    { view: true, create: true, edit: true, delete: false },
        activities: { view: true, create: true, edit: true, delete: false },
        reports:    { view: true, export: true },
        accounting: { view: true, create: true, edit: true, delete: false },
        cases:      { view: true, create: true, edit: true, delete: false },
        team:       { view: true, create: true, edit: true, delete: false },
      },
    },
    {
      name: 'Carlos Vargas',
      email: 'carlos.vargas@gems.cr',
      password: 'Gems12-',
      role: 'user',
      position: 'Ejecutivo de Ventas',
      department: 'Ventas',
      isActive: true,
      permissions: {
        dashboard: true,
        clients:    { view: true, create: true, edit: true, delete: false },
        activities: { view: true, create: true, edit: true, delete: true },
        reports:    { view: false, export: false },
        accounting: { view: false, create: false, edit: false, delete: false },
        cases:      { view: true, create: true, edit: false, delete: false },
        team:       { view: true, create: false, edit: false, delete: false },
      },
    },
    {
      name: 'Ana Mora',
      email: 'ana.mora@gems.cr',
      password: 'Gems12-',
      role: 'support',
      position: 'Soporte Técnico',
      department: 'Tecnología',
      isActive: true,
      permissions: {
        dashboard: true,
        clients:    { view: true, create: false, edit: false, delete: false },
        activities: { view: true, create: true, edit: true, delete: true },
        reports:    { view: false, export: false },
        accounting: { view: false, create: false, edit: false, delete: false },
        cases:      { view: true, create: true, edit: true, delete: true },
        team:       { view: true, create: false, edit: false, delete: false },
      },
    },
  ]);
  console.log(`   → ${maria.name}, ${carlos.name}, ${ana.name}`);

  // ── 2. CLIENTES ────────────────────────────────────────────────
  console.log('🏢 Creando clientes...');
  await Client.deleteMany({ name: { $in: [
    'Agencia Creativa Pulso',
    'TechSolutions MSP',
    'Constructora Meridiano',
    'Estudio Nómada',
  ]}});

  const [pulso, techsol, meridiano, nomada] = await Client.insertMany([
    {
      name: 'Agencia Creativa Pulso',
      email: 'contacto@agenciapulso.cr',
      phone: '+506 2234-5678',
      company: 'Agencia Pulso S.A.',
      tags: ['agencia', 'creativo', 'activo'],
      profile: {
        about: 'Agencia de diseño y marketing digital con 8 años en el mercado.',
        industry: 'Marketing & Diseño',
        size: '11-50',
        location: 'San José, Costa Rica',
        website: 'https://agenciapulso.cr',
      },
      services: [{
        name: 'GEMS Hub Pro',
        plan: 'Mensual',
        status: 'active',
        startDate: d(-90),
      }],
    },
    {
      name: 'TechSolutions MSP',
      email: 'ops@techsolutions.cr',
      phone: '+506 2256-9900',
      company: 'TechSolutions CR Ltda.',
      tags: ['tecnología', 'msp', 'activo'],
      profile: {
        about: 'Proveedor de servicios IT gestionados para PyMES.',
        industry: 'Tecnología / IT',
        size: '11-50',
        location: 'Heredia, Costa Rica',
        website: 'https://techsolutions.cr',
      },
      services: [{
        name: 'GEMS Hub Business',
        plan: 'Anual',
        status: 'active',
        startDate: d(-180),
      }],
    },
    {
      name: 'Constructora Meridiano',
      email: 'admin@meridiano.cr',
      phone: '+506 2289-1122',
      company: 'Constructora Meridiano S.A.',
      tags: ['construcción', 'field-service'],
      profile: {
        about: 'Empresa de construcción y mantenimiento de infraestructura.',
        industry: 'Construcción',
        size: '51-200',
        location: 'Alajuela, Costa Rica',
      },
      services: [{
        name: 'GEMS Hub Field',
        plan: 'Mensual',
        status: 'trial',
        startDate: d(-14),
      }],
    },
    {
      name: 'Estudio Nómada',
      email: 'hola@estudionómada.com',
      phone: '+506 2201-3344',
      company: 'Estudio Nómada UX',
      tags: ['ux', 'diseño', 'pequeño'],
      profile: {
        about: 'Estudio boutique de UX/UI y estrategia digital.',
        industry: 'Diseño / UX',
        size: '1-10',
        location: 'Cartago, Costa Rica',
      },
      services: [],
    },
  ]);
  console.log(`   → ${pulso.name}, ${techsol.name}, ${meridiano.name}, ${nomada.name}`);

  // ── 3. ACTIVIDADES ─────────────────────────────────────────────
  console.log('📋 Creando actividades...');
  await Activity.deleteMany({ title: { $regex: /^\[TEST\]/ } });

  await Activity.insertMany([
    {
      title: '[TEST] Reunión de onboarding — Agencia Pulso',
      description: 'Primera sesión de configuración de la cuenta y capacitación del equipo.',
      date: d(-5),
      dueDate: d(-5),
      status: 'completed',
      priority: 'high',
      clientId: pulso._id,
      assignedTo: [maria._id],
      completionPercentage: 100,
      createdBy: maria._id,
    },
    {
      title: '[TEST] Revisión mensual KPIs — TechSolutions',
      description: 'Análisis de métricas del mes y ajuste de estrategias.',
      date: d(2),
      dueDate: d(2),
      status: 'pending',
      priority: 'medium',
      clientId: techsol._id,
      assignedTo: [carlos._id],
      completionPercentage: 0,
      createdBy: carlos._id,
    },
    {
      title: '[TEST] Soporte técnico — Integración API',
      description: 'Configurar la integración con el sistema contable del cliente.',
      date: d(0),
      dueDate: d(1),
      status: 'in-progress',
      priority: 'urgent',
      clientId: techsol._id,
      assignedTo: [ana._id, carlos._id],
      completionPercentage: 40,
      createdBy: ana._id,
    },
    {
      title: '[TEST] Demo plataforma — Constructora Meridiano',
      description: 'Demostración del módulo de field service y tickets.',
      date: d(3),
      dueDate: d(3),
      status: 'pending',
      priority: 'high',
      clientId: meridiano._id,
      assignedTo: [carlos._id],
      completionPercentage: 0,
      createdBy: carlos._id,
    },
    {
      title: '[TEST] Propuesta comercial — Estudio Nómada',
      description: 'Preparar y enviar propuesta para plan básico.',
      date: d(-2),
      dueDate: d(1),
      status: 'in-progress',
      priority: 'medium',
      clientId: nomada._id,
      assignedTo: [maria._id],
      completionPercentage: 65,
      createdBy: maria._id,
    },
  ]);
  console.log('   → 5 actividades creadas');

  // ── 4. CASOS ───────────────────────────────────────────────────
  console.log('📁 Creando casos...');
  await Case.deleteMany({ titulo: { $regex: /^\[TEST\]/ } });

  await Case.insertMany([
    {
      titulo: '[TEST] Fallo en sincronización de datos',
      descripcion: 'El cliente reporta que los datos no sincronizan correctamente entre dispositivos móviles y la plataforma web.',
      tipo: 'incidencia',
      estado: 'en_progreso',
      prioridad: 'alta',
      cliente_id: techsol._id,
    },
    {
      titulo: '[TEST] Documento de alcance — Proyecto Onboarding',
      descripcion: 'Definición del alcance y entregables para el proceso de onboarding de nuevos clientes.',
      tipo: 'documento',
      estado: 'abierto',
      prioridad: 'media',
      cliente_id: pulso._id,
    },
    {
      titulo: '[TEST] Seguimiento renovación contrato anual',
      descripcion: 'TechSolutions tiene contrato venciendo en 45 días. Coordinar renovación con descuento de lealtad.',
      tipo: 'seguimiento',
      estado: 'abierto',
      prioridad: 'alta',
      cliente_id: techsol._id,
    },
  ]);
  console.log('   → 3 casos creados');

  // ── 5. TICKETS ─────────────────────────────────────────────────
  console.log('🎫 Creando tickets...');
  // Limpiar tickets huérfanos con ticketNumber null y los de test
  await Ticket.deleteMany({ $or: [{ subject: { $regex: /^\[TEST\]/ } }, { ticketNumber: null }] });

  // Crear uno a uno para que el pre('save') genere el ticketNumber
  const ticketDefs = [
    {
      subject: '[TEST] No puedo iniciar sesión en la plataforma',
      description: 'Desde ayer no puedo acceder. Me dice que las credenciales son incorrectas pero estoy seguro de que son las correctas.',
      category: 'technical', priority: 'high', status: 'open',
      submittedBy: { name: 'Agencia Creativa Pulso', email: 'contacto@agenciapulso.cr', clientId: pulso._id },
      assignedTo: ana._id,
      comments: [{ text: 'Ya revisamos el tema. El problema era un caché del navegador. Se resolvió al borrar cookies.', author: ana._id, isInternal: false }],
    },
    {
      subject: '[TEST] Error al exportar reporte PDF',
      description: 'Cuando intento exportar el reporte de actividades en PDF, se descarga un archivo corrupto.',
      category: 'technical', priority: 'medium', status: 'new',
      submittedBy: { name: 'TechSolutions MSP', email: 'ops@techsolutions.cr', clientId: techsol._id },
      comments: [],
    },
    {
      subject: '[TEST] Consulta sobre plan empresarial',
      description: '¿Cuáles son las diferencias entre el plan Business y el plan Enterprise? ¿Hay descuento por pago anual?',
      category: 'sales', priority: 'low', status: 'waiting',
      submittedBy: { name: 'Constructora Meridiano', email: 'admin@meridiano.cr', clientId: meridiano._id },
      assignedTo: carlos._id,
      comments: [{ text: 'Enviamos el comparativo de planes al correo. Esperamos su respuesta para agendar demo.', author: carlos._id, isInternal: false }],
    },
  ];
  for (const def of ticketDefs) await new Ticket(def).save();
  console.log('   → 3 tickets creados');

  // ── 6. PROSPECTOS ──────────────────────────────────────────────
  console.log('✨ Creando prospectos...');
  await Prospect.deleteMany({ prospectName: { $regex: /^\[TEST\]/ } });

  await Prospect.insertMany([
    {
      prospectName: '[TEST] Sofía Herrera',
      company: 'Disruptive Lab',
      status: 'calificado',
      source: 'linkedin',
      estimatedValue: 4800,
      contactEmail: 'sofia@disruptivelab.io',
      messages: [
        {
          role: 'user',
          content: 'Sofía trabaja en una agencia de growth hacking, 15 personas. Vieron un post nuestro en LinkedIn.',
          timestamp: d(-3),
        },
        {
          role: 'assistant',
          content: '## Análisis del prospecto\n\nSofía tiene un perfil muy alineado con GEMS Hub. **Recomendaciones:**\n\n1. **Enfocate en el módulo de Prospectos IA** — les va a resonar para su propio proceso comercial.\n2. Agenda un demo mostrando el pipeline Kanban + coach IA.\n3. El precio ideal es plan mensual primero para reducir fricción.',
          timestamp: d(-3),
        },
      ],
      timeline: [{
        type: 'created',
        description: 'Prospecto creado desde LinkedIn',
        createdAt: d(-3),
      }],
    },
    {
      prospectName: '[TEST] Ricardo Núñez',
      company: 'CloudBridge IT',
      status: 'propuesta',
      source: 'referido',
      estimatedValue: 12000,
      contactEmail: 'rnunez@cloudbridge.cr',
      contactPhone: '+506 8845-6677',
      messages: [
        {
          role: 'user',
          content: 'Ricardo es el CTO de una empresa MSP con 30 técnicos. Lo refirió TechSolutions. Está evaluando 3 plataformas.',
          timestamp: d(-7),
        },
        {
          role: 'assistant',
          content: '## Estrategia para cerrar a Ricardo\n\n**Contexto:** Es CTO, toma decisiones técnicas. Evaluando competencia.\n\n**Próximos pasos:**\n1. Manda propuesta técnica con comparativo vs competidores.\n2. Destaca la integración con herramientas IT (GitHub, tickets).\n3. Ofrece prueba de 30 días sin costo para su equipo.\n\n📝 **Mensaje sugerido:**\n> Hola Ricardo, como platicamos, te comparto la propuesta formal con el comparativo. ¿Tienes 20 min esta semana para una sesión técnica?',
          timestamp: d(-7),
        },
      ],
      timeline: [
        { type: 'created', description: 'Referido por TechSolutions MSP', createdAt: d(-7) },
        { type: 'status', description: 'Movido a Propuesta', createdAt: d(-2) },
      ],
    },
    {
      prospectName: '[TEST] Laura Cascante',
      company: 'Pixel Studio',
      status: 'nuevo',
      source: 'web',
      estimatedValue: 2400,
      contactEmail: 'laura@pixelstudio.cr',
      messages: [],
      timeline: [{ type: 'created', description: 'Formulario web', createdAt: d(-1) }],
    },
  ]);
  console.log('   → 3 prospectos creados');

  // ── RESUMEN ────────────────────────────────────────────────────
  console.log('\n🎉 Seed completado:');
  console.log('   3 usuarios   → maria.lopez, carlos.vargas, ana.mora  (pass: Gems12-)');
  console.log('   4 clientes   → Pulso, TechSolutions, Meridiano, Nómada');
  console.log('   5 actividades → varias prioridades y estados');
  console.log('   3 casos      → incidencia, documento, seguimiento');
  console.log('   3 tickets    → open, new, waiting');
  console.log('   3 prospectos → calificado, propuesta, nuevo\n');

  await mongoose.disconnect();
}

seed().catch(err => { console.error('❌', err.message); process.exit(1); });
