const cron = require('node-cron');
const Setting = require('../models/Setting');

// ═══════════════════════════════════════════════════════════════════════════
// Task Reports — DESHABILITADO
// El sistema original enviaba estos reportes vía WhatsApp (Baileys). Al eliminar
// la integración de WhatsApp se desactivó esta vía. Si se quiere recuperar la
// funcionalidad, reimplementar contra email (services/emailService.js) o un
// canal alternativo.
// ═══════════════════════════════════════════════════════════════════════════
function initTaskReportsCron(app) {
  console.log('ℹ️ Task reports cron desactivado (eliminada la integración WhatsApp).');
  // Mantener el hook para que las rutas de admin no fallen al llamarlo.
  app.set('updateTaskReportsCron', () => {});
}

// ═══════════════════════════════════════════════════════════════════════════
// Team Report Cron (Email programado) — sigue activo
// ═══════════════════════════════════════════════════════════════════════════

const { sendTeamReport } = require('../services/teamReportService');

function initTeamReportsCron(app) {
  console.log('🔄 Inicializando cron para reportes de equipo por email...');

  let teamReportJob;

  async function updateTeamReportCron() {
    try {
      const settings = await Setting.findOne({ key: 'teamReports' });
      if (!settings?.value?.enabled) {
        if (teamReportJob) { teamReportJob.stop(); teamReportJob = null; }
        console.log('📧 Team report cron: deshabilitado');
        return;
      }

      const cfg = settings.value;
      if (teamReportJob) { teamReportJob.stop(); }

      let cronExpr;
      const h = cfg.hour || 8;
      const m = cfg.minute || 0;

      if (cfg.frequency === 'daily') {
        cronExpr = `0 ${m} ${h} * * 1,2,3,4,5`; // L-V
      } else if (cfg.frequency === 'monthly') {
        cronExpr = `0 ${m} ${h} 1 * *`; // Día 1 de cada mes
      } else {
        // weekly (default)
        const dow = cfg.dayOfWeek ?? 1; // lunes
        cronExpr = `0 ${m} ${h} * * ${dow}`;
      }

      console.log(`📧 Team report cron programado: ${cronExpr} (${cfg.frequency})`);

      teamReportJob = cron.schedule(cronExpr, async () => {
        console.log('⏰ Ejecutando reporte de equipo programado...');
        try {
          const result = await sendTeamReport({
            recipients: cfg.recipients,
            period: cfg.period || 'week',
            department: cfg.department,
          });
          console.log('✅ Reporte de equipo enviado:', result.success);

          settings.value.lastRun = new Date();
          settings.markModified('value');
          await settings.save();
        } catch (err) {
          console.error('❌ Error en reporte de equipo programado:', err.message);
        }
      });
    } catch (error) {
      console.error('❌ Error configurando team report cron:', error);
    }
  }

  updateTeamReportCron();
  app.set('updateTeamReportsCron', updateTeamReportCron);
  console.log('✅ Cron para reportes de equipo inicializado');
}

// ═══════════════════════════════════════════════════════════════════════════
// SLA Alert System Cron
// ═══════════════════════════════════════════════════════════════════════════
function initSlaCron() {
  console.log('🔄 Inicializando cron para SLA Alerts...');

  cron.schedule('*/15 * * * *', async () => {
    try {
      const { notifySLAAlert } = require('../services/emailService');
      const Ticket = require('../models/Ticket');

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const overdueTickets = await Ticket.find({
        status: 'new',
        slaNotified: { $ne: true },
        createdAt: { $lt: twoHoursAgo }
      });

      for (const ticket of overdueTickets) {
        console.log(`[SLA] Ticket #${ticket.ticketNumber} is overdue! Sending alert.`);
        await notifySLAAlert(ticket);
        ticket.slaNotified = true;
        await ticket.save();
      }
    } catch (err) {
      console.error('[SLA] Error running background check:', err);
    }
  });

  console.log('✅ Cron para SLA Alerts inicializado');
}

module.exports = { initTaskReportsCron, initTeamReportsCron, initSlaCron };
