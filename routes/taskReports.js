const express = require('express');
const router = express.Router();
const Activity = require('../models/Activity');
const Setting = require('../models/Setting');
const { 
  generateDailyTaskSummary, 
  generateTaskDueReminder,
  generateTaskReport
} = require('../services/taskReportService');

// Endpoint para obtener la configuración actual de los reportes
const { sendMail } = require('../services/emailService');
const Task = require('../models/Task');
const User = require('../models/User');

// Endpoint para enviar reporte diario por email (Scrum Daily)
router.post('/send-daily-email', async (req, res) => {
  try {
    const { department, toEmail } = req.body;
    
    // Obtener tareas modificadas hoy o con activeSessions/timeLogs
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let filter = {
      updatedAt: { $gte: today }
    };
    
    if (department) {
      const usersInDept = await User.find({ department }).select('_id');
      const userIds = usersInDept.map(u => u._id);
      filter.assignedTo = { $in: userIds };
    }
    
    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name email department')
      .sort({ updatedAt: -1 });
      
    // Generar HTML del correo
    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: auto; padding: 20px;">
        <h2 style="color: #4f46e5;">Reporte Diario Scrum ${department ? `- Departamento: ${department}` : ''}</h2>
        <p>Resumen de tareas actualizadas o trabajadas hoy (${new Date().toLocaleDateString('es-ES')}):</p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background-color: #f3f4f6; text-align: left;">
              <th style="padding: 10px; border-bottom: 2px solid #e5e7eb;">Tarea</th>
              <th style="padding: 10px; border-bottom: 2px solid #e5e7eb;">Asignado a</th>
              <th style="padding: 10px; border-bottom: 2px solid #e5e7eb;">Estado Kanban</th>
              <th style="padding: 10px; border-bottom: 2px solid #e5e7eb;">Progreso</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    if (tasks.length === 0) {
      html += `<tr><td colspan="4" style="padding: 20px; text-align: center;">No hay actividad registrada el día de hoy.</td></tr>`;
    } else {
      tasks.forEach(task => {
        const assignedNames = task.assignedTo && task.assignedTo.length > 0 
          ? task.assignedTo.map(u => u.name).join(', ') 
          : 'Sin asignar';
          
        html += `
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>${task.title}</strong><br><span style="font-size: 12px; color: #6b7280;">Horas reportadas: ${task.actualHours || 0}</span></td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${assignedNames}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
              <span style="background-color: #e0e7ff; color: #4338ca; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${task.boardStatus}</span>
            </td>
            <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${task.completionPercentage || 0}%</td>
          </tr>
        `;
      });
    }
    
    html += `
          </tbody>
        </table>
        <p style="margin-top: 20px; font-size: 12px; color: #9ca3af;">Generado automáticamente desde Customer Touch.</p>
      </div>
    `;
    
    // Si no se envía a quién, enviarlo a un fallback o error
    const emailTo = toEmail || process.env.SUPPORT_EMAIL;
    
    if (!emailTo) {
      return res.status(400).json({ error: 'No se pudo determinar el destinatario del correo (toEmail es requerido).' });
    }
    
    const info = await sendMail({
      to: emailTo,
      subject: `Resumen Diario Scrum - ${new Date().toLocaleDateString('es-ES')}`,
      html
    });
    
    if (!info) {
      return res.status(500).json({ error: 'Error al enviar el correo. Revisa la configuración SMTP.' });
    }
    
    res.json({ success: true, message: `Reporte enviado exitosamente a ${emailTo}` });
  } catch (error) {
    console.error('Error al enviar reporte diario por email:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/settings', async (req, res) => {
  try {
    let settings = await Setting.findOne({ key: 'taskReports' });
    
    if (!settings) {
      // Configuración por defecto
      settings = new Setting({
        key: 'taskReports',
        value: {
          dailySummaryEnabled: true,
          dailySummaryTime: '23:00', // 11 PM Colombia
          dailySummaryDays: [1, 2, 3, 4, 5], // Lunes a Viernes
          dueTomorrowEnabled: true,
          dueTomorrowTime: '08:00', // 8 AM Colombia
          dueTomorrowDays: [1, 2, 3, 4, 5], // Lunes a Viernes
          dueTomorrowAdvanceDays: 1, // Notificar con 1 día de anticipación
          lastDailyRun: null,
          lastDueTomorrowRun: null
        }
      });
      await settings.save();
    }
    
    res.json(settings.value);
  } catch (error) {
    console.error('Error al obtener configuración de reportes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para actualizar la configuración de los reportes
router.put('/settings', async (req, res) => {
  try {
    const { 
      dailySummaryEnabled, 
      dailySummaryTime, 
      dailySummaryDays,
      dueTomorrowEnabled, 
      dueTomorrowTime,
      dueTomorrowDays,
      dueTomorrowAdvanceDays
    } = req.body;
    
    let settings = await Setting.findOne({ key: 'taskReports' });
    
    if (!settings) {
      settings = new Setting({ key: 'taskReports', value: {} });
    }
    
    settings.value = {
      ...settings.value,
      dailySummaryEnabled: dailySummaryEnabled !== undefined ? dailySummaryEnabled : settings.value.dailySummaryEnabled,
      dailySummaryTime: dailySummaryTime || settings.value.dailySummaryTime,
      dailySummaryDays: dailySummaryDays !== undefined ? dailySummaryDays : settings.value.dailySummaryDays || [1, 2, 3, 4, 5],
      dueTomorrowEnabled: dueTomorrowEnabled !== undefined ? dueTomorrowEnabled : settings.value.dueTomorrowEnabled,
      dueTomorrowTime: dueTomorrowTime || settings.value.dueTomorrowTime,
      dueTomorrowDays: dueTomorrowDays !== undefined ? dueTomorrowDays : settings.value.dueTomorrowDays || [1, 2, 3, 4, 5],
      dueTomorrowAdvanceDays: dueTomorrowAdvanceDays !== undefined ? dueTomorrowAdvanceDays : settings.value.dueTomorrowAdvanceDays || 1
    };
    
    await settings.save();
    
    res.json(settings.value);
  } catch (error) {
    console.error('Error al actualizar configuración de reportes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Los endpoints de envío manual usaban WhatsApp (Baileys). Eliminada la integración.
// Devolvemos 410 Gone para que clientes que aún los llamen se enteren con claridad.
router.post(['/send-daily-summary', '/send-due-tomorrow', '/send-custom-report'], (req, res) => {
  res.status(410).json({
    error: 'Endpoint deprecado: la integración con WhatsApp fue eliminada. ' +
           'Usa el reporte por email desde /settings/team-report o reimplementa esta vía.'
  });
});

module.exports = router;