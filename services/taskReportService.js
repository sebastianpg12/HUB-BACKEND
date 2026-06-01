const Activity = require('../models/Activity');
const User = require('../models/User');

// Helpers para formatear texto del reporte.
const getPriorityText = (priority) => {
  const priorities = {
    'low': '🟢 Baja',
    'medium': '🟡 Media',
    'high': '🟠 Alta',
    'urgent': '🔴 Urgente'
  };
  return priorities[priority] || '🟡 Media';
};

const getStatusText = (status) => {
  const statuses = {
    'pending': '⏳ Pendiente',
    'in-progress': '🔄 En Progreso',
    'completed': '✅ Completada',
    'overdue': '⚠️ Vencida',
    'cancelled': '❌ Cancelada'
  };
  return statuses[status] || '⏳ Pendiente';
};

// Generar resumen diario de tareas creadas
async function generateDailyTaskSummary() {
  try {
    // Obtener fecha actual Colombia (UTC-5)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Buscar tareas creadas hoy
    const tasksCreatedToday = await Activity.find({
      createdAt: { $gte: today, $lt: tomorrow }
    })
    .populate('clientId', 'name')
    .populate('assignedTo', 'name')
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 });
    
    if (tasksCreatedToday.length === 0) {
      return '🤖 *RESUMEN DIARIO DE TAREAS*\n\nNo se crearon tareas el día de hoy.';
    }
    
    // Generar mensaje
    let message = '🤖 *RESUMEN DIARIO DE TAREAS*\n\n';
    message += `Se crearon *${tasksCreatedToday.length} tareas* el día de hoy:\n\n`;
    
    tasksCreatedToday.forEach((task, index) => {
      const assignedNames = Array.isArray(task.assignedTo) 
        ? task.assignedTo.map(user => user.name).join(', ') 
        : 'Sin asignar';
        
      message += `*${index + 1}. ${task.title}*\n`;
      message += `• Cliente: ${task.clientId ? task.clientId.name : 'Sin cliente'}\n`;
      message += `• Asignado a: ${assignedNames}\n`;
      message += `• Fecha límite: ${task.dueDate ? new Date(task.dueDate).toLocaleDateString('es-ES') : 'Sin fecha'}\n`;
      message += `• Prioridad: ${getPriorityText(task.priority)}\n`;
      message += `• Estado: ${getStatusText(task.status)}\n\n`;
    });
    
    message += `_Recuerda revisar el CRM para más detalles de cada tarea._`;
    
    return message;
  } catch (error) {
    console.error('Error generando resumen diario de tareas:', error);
    return '❌ Error al generar el reporte diario de tareas.';
  }
}

// Generar recordatorio de tareas que vencen próximamente
async function generateTaskDueReminder() {
  try {
    // Obtener configuración para saber cuántos días de anticipación queremos
    const Setting = require('../models/Setting');
    let settings = await Setting.findOne({ key: 'taskReports' });
    const advanceDays = settings?.value?.dueTomorrowAdvanceDays || 1;
    
    // Calcular la fecha objetivo según los días de anticipación
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + advanceDays);
    targetDate.setHours(0, 0, 0, 0);
    
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    
    // Buscar tareas que vencen en la fecha objetivo y no están completadas o canceladas
    const tasksDue = await Activity.find({
      dueDate: { $gte: targetDate, $lt: nextDay },
      status: { $nin: ['completed', 'cancelled'] }
    })
    .populate('clientId', 'name')
    .populate('assignedTo', 'name phone')
    .sort({ priority: -1 });
    
    const dayText = advanceDays === 1 ? 'mañana' : 
                    advanceDays === 0 ? 'hoy' :
                    `en ${advanceDays} días`;
    
    if (tasksDue.length === 0) {
      return `🔔 *RECORDATORIO DE VENCIMIENTO*\n\nNo hay tareas que venzan ${dayText}.`;
    }
    
    // Generar mensaje con menciones
    let message = '🔔 *RECORDATORIO DE VENCIMIENTO*\n\n';
    message += `*${tasksDue.length} tareas vencen ${dayText}*. ¡No las dejes para último momento!\n\n`;
    
    let mentionedJids = [];
    
    tasksDue.forEach((task, index) => {
      message += `*${index + 1}. ${task.title}*\n`;
      message += `• Cliente: ${task.clientId ? task.clientId.name : 'Sin cliente'}\n`;
      
      // Agregar asignados con posibles menciones
      if (Array.isArray(task.assignedTo) && task.assignedTo.length > 0) {
        message += '• Asignado a: ';
        
        task.assignedTo.forEach((user, userIndex) => {
          message += user.name;
          
          // Intentar preparar mención si tiene teléfono
          if (user.phone) {
            let phoneRaw = user.phone.replace(/[^\d]/g, '');
            if (phoneRaw.startsWith('0')) phoneRaw = phoneRaw.substring(1);
            
            if (phoneRaw.length >= 10) {
              const jid = `${phoneRaw}@s.whatsapp.net`;
              message += ` @${phoneRaw}`;
              mentionedJids.push(jid);
            }
          }
          
          if (userIndex < task.assignedTo.length - 1) {
            message += ', ';
          }
        });
        
        message += '\n';
      } else {
        message += '• Asignado a: Sin asignar\n';
      }
      
      message += `• Prioridad: ${getPriorityText(task.priority)}\n`;
      message += `• Tiempo estimado: ${task.estimatedTime || 'No especificado'}\n\n`;
    });
    
    message += `_Organiza tu tiempo para completar estas tareas antes de su vencimiento._`;
    
    return { message, mentionedJids };
  } catch (error) {
    console.error('Error generando recordatorio de tareas que vencen mañana:', error);
    return { 
      message: '❌ Error al generar el recordatorio de tareas por vencer.', 
      mentionedJids: [] 
    };
  }
}

// Generar reporte de tareas específicas (para envío manual)
async function generateTaskReport(taskIds) {
  try {
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return { 
        message: '❌ No se proporcionaron tareas para el reporte.', 
        mentionedJids: [] 
      };
    }
    
    // Buscar las tareas por ID
    const tasks = await Activity.find({
      _id: { $in: taskIds }
    })
    .populate('clientId', 'name')
    .populate('assignedTo', 'name phone')
    .sort({ priority: -1 });
    
    if (tasks.length === 0) {
      return { 
        message: '❌ No se encontraron las tareas solicitadas.', 
        mentionedJids: [] 
      };
    }
    
    // Generar mensaje con menciones
    let message = '🚨 *REPORTE DE TAREAS SELECCIONADAS*\n\n';
    
    let mentionedJids = [];
    
    tasks.forEach((task, index) => {
      message += `*${index + 1}. ${task.title}*\n`;
      message += `• Cliente: ${task.clientId ? task.clientId.name : 'Sin cliente'}\n`;
      
      // Agregar asignados con posibles menciones
      if (Array.isArray(task.assignedTo) && task.assignedTo.length > 0) {
        message += '• Asignado a: ';
        
        task.assignedTo.forEach((user, userIndex) => {
          message += user.name;
          
          // Intentar preparar mención si tiene teléfono
          if (user.phone) {
            let phoneRaw = user.phone.replace(/[^\d]/g, '');
            if (phoneRaw.startsWith('0')) phoneRaw = phoneRaw.substring(1);
            
            if (phoneRaw.length >= 10) {
              const jid = `${phoneRaw}@s.whatsapp.net`;
              message += ` @${phoneRaw}`;
              mentionedJids.push(jid);
            }
          }
          
          if (userIndex < task.assignedTo.length - 1) {
            message += ', ';
          }
        });
        
        message += '\n';
      } else {
        message += '• Asignado a: Sin asignar\n';
      }
      
      message += `• Fecha límite: ${task.dueDate ? new Date(task.dueDate).toLocaleDateString('es-ES') : 'Sin fecha'}\n`;
      message += `• Prioridad: ${getPriorityText(task.priority)}\n`;
      message += `• Estado: ${getStatusText(task.status)}\n`;
      
      // Si está vencida o próxima a vencer, agregar nota
      if (task.dueDate) {
        const dueDate = new Date(task.dueDate);
        const today = new Date();
        
        if (dueDate < today && task.status !== 'completed') {
          // Calcular días vencidos
          const diffTime = today.getTime() - dueDate.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          message += `• ⚠️ *Vencida hace ${diffDays} día(s)*\n`;
        } else if (dueDate.getTime() - today.getTime() < 2 * 24 * 60 * 60 * 1000) { // Menos de 2 días
          message += `• ⚠️ *Próxima a vencer*\n`;
        }
      }
      
      message += '\n';
    });
    
    message += `_Este es un recordatorio especial sobre estas tareas. Por favor, actualiza su estado en el CRM._`;
    
    return { message, mentionedJids };
  } catch (error) {
    console.error('Error generando reporte de tareas específicas:', error);
    return { 
      message: '❌ Error al generar el reporte de tareas seleccionadas.', 
      mentionedJids: [] 
    };
  }
}

// La integración con WhatsApp fue eliminada. Los generadores de mensaje se
// mantienen disponibles (siguen siendo útiles para email o exports), pero ya no
// existe `sendWhatsAppMessage` ni `getNotificationGroupId`.

module.exports = {
  generateDailyTaskSummary,
  generateTaskDueReminder,
  generateTaskReport
};