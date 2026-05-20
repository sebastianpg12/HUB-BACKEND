const cron = require('node-cron');
const Setting = require('../models/Setting');
const { 
  generateDailyTaskSummary, 
  generateTaskDueReminder, 
  sendWhatsAppMessage 
} = require('../services/taskReportService');

// Función para convertir hora (HH:MM) y días a expresión cron
function timeToCronExpression(time, days = [0, 1, 2, 3, 4, 5, 6]) {
  if (!time || !time.includes(':')) {
    time = '08:00'; // Valor por defecto: 8 AM
  }
  
  // Si no hay días configurados, usar todos los días
  if (!Array.isArray(days) || days.length === 0) {
    days = [0, 1, 2, 3, 4, 5, 6]; // Domingo a Sábado
  }
  
  const [hours, minutes] = time.split(':').map(Number);
  
  // Convertir días de la semana a formato cron (0-6 donde 0 es domingo)
  const daysString = days.sort().join(',');
  
  return `0 ${minutes} ${hours} * * ${daysString}`;
}

// Inicializar los cron jobs para reportes de tareas
function initTaskReportsCron(app) {
  console.log('🔄 Inicializando cron jobs para reportes de tareas...');
  
  let dailySummaryJob;
  let dueTomorrowJob;
  
  // Función para actualizar o crear los cron jobs
  async function updateCronJobs() {
    try {
      // Obtener la configuración actual
      const settings = await Setting.findOne({ key: 'taskReports' });
      
      if (!settings || !settings.value) {
        console.log('⚠️ No hay configuración para reportes de tareas. Usando valores por defecto.');
        return;
      }
      
      const config = settings.value;
      console.log('📋 Configuración de reportes cargada:', config);
      
      // Detener los jobs existentes si los hay
      if (dailySummaryJob) {
        dailySummaryJob.stop();
        console.log('🛑 Detenido job de resumen diario anterior');
      }
      
      if (dueTomorrowJob) {
        dueTomorrowJob.stop();
        console.log('🛑 Detenido job de tareas por vencer anterior');
      }
      
      // Crear nuevo job para resumen diario si está habilitado
      if (config.dailySummaryEnabled) {
        const cronExpression = timeToCronExpression(config.dailySummaryTime, config.dailySummaryDays);
        console.log(`🕒 Programando resumen diario: ${cronExpression} (${config.dailySummaryTime}, días: ${config.dailySummaryDays?.join(',') || 'todos'})`);
        
        dailySummaryJob = cron.schedule(cronExpression, async () => {
          console.log('⏰ Ejecutando envío de resumen diario automático...');
          
          try {
            const baileysSock = app.get('baileysSock');
            const baileysReady = app.get('baileysReady');
            
            if (!baileysSock || !baileysReady) {
              console.log('❌ WhatsApp no está conectado. No se puede enviar el resumen.');
              return;
            }
            
            const message = await generateDailyTaskSummary();
            await sendWhatsAppMessage(baileysSock, message);
            
            // Actualizar la última ejecución
            if (settings) {
              settings.value.lastDailyRun = new Date();
              await settings.save();
              console.log('✅ Resumen diario enviado y registro actualizado');
            }
          } catch (error) {
            console.error('❌ Error enviando resumen diario programado:', error);
          }
        });
      }
      
      // Crear nuevo job para tareas que vencen mañana si está habilitado
      if (config.dueTomorrowEnabled) {
        const cronExpression = timeToCronExpression(config.dueTomorrowTime, config.dueTomorrowDays);
        console.log(`🕒 Programando recordatorio de vencimiento: ${cronExpression} (${config.dueTomorrowTime}, días: ${config.dueTomorrowDays?.join(',') || 'todos'}, anticipación: ${config.dueTomorrowAdvanceDays || 1} día(s))`);
        
        dueTomorrowJob = cron.schedule(cronExpression, async () => {
          console.log('⏰ Ejecutando envío de recordatorio de vencimiento automático...');
          
          try {
            const baileysSock = app.get('baileysSock');
            const baileysReady = app.get('baileysReady');
            
            if (!baileysSock || !baileysReady) {
              console.log('❌ WhatsApp no está conectado. No se puede enviar el recordatorio.');
              return;
            }
            
            const { message, mentionedJids } = await generateTaskDueReminder();
            await sendWhatsAppMessage(baileysSock, message, mentionedJids);
            
            // Actualizar la última ejecución
            if (settings) {
              settings.value.lastDueTomorrowRun = new Date();
              await settings.save();
              console.log('✅ Recordatorio de vencimiento enviado y registro actualizado');
            }
          } catch (error) {
            console.error('❌ Error enviando recordatorio de vencimiento programado:', error);
          }
        });
      }
    } catch (error) {
      console.error('❌ Error configurando cron jobs para reportes de tareas:', error);
    }
  }
  
  // Inicializar cron jobs al arrancar
  updateCronJobs();
  
  // Exponer función para actualizar los cron jobs cuando cambie la configuración
  app.set('updateTaskReportsCron', updateCronJobs);
  
  console.log('✅ Cron jobs para reportes de tareas inicializados');
}

// ═══════════════════════════════════════════════════════════════════════════
// Team Report Cron (Email reports programados)
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

          // Actualizar lastRun
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

module.exports = { initTaskReportsCron, initTeamReportsCron };