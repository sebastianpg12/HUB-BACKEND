const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.ready = false;
    this.qr = null;
  }

  async init(app) {
    if (app) {
      app.set('baileysSock', null);
      app.set('baileysReady', false);
    }
    
    try {
      const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
      const { version } = await fetchLatestBaileysVersion();
      
      this.sock = makeWASocket({
        version,
        printQRInTerminal: true,
        auth: state,
        syncFullHistory: false,
        defaultQueryTimeoutMs: 60000,
      });

      if (app) {
        app.set('baileysSock', this.sock);
      }

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          this.qr = qr;
          console.log('[Baileys] Escanea este QR para vincular WhatsApp:', qr);
        }
        
        if (connection === 'open') {
          this.ready = true;
          if (app) app.set('baileysReady', true);
          console.log('[Baileys] WhatsApp vinculado y listo para enviar mensajes');
        }
        
        if (connection === 'close') {
          this.ready = false;
          if (app) app.set('baileysReady', false);
          console.warn('[Baileys] WhatsApp desconectado:', lastDisconnect?.error?.message);
          setTimeout(() => this.init(app), 15000);
        }
      });

      this.sock.ev.on('creds.update', saveCreds);
    } catch (err) {
      console.error('[Baileys] Error al inicializar WhatsApp:', err);
    }
  }

  isReady() {
    return this.ready;
  }

  getQR() {
    return this.qr;
  }

  async getAllGroups() {
    if (!this.ready || !this.sock) throw new Error('WhatsApp no vinculado');
    const allGroups = await this.sock.groupFetchAllParticipating();
    return Object.values(allGroups).map(g => ({ name: g.subject, id: g.id }));
  }

  async sendMessageToGroup(groupNameTarget, message) {
    if (!this.ready || !this.sock) throw new Error('WhatsApp no vinculado');
    
    const allGroups = await this.sock.groupFetchAllParticipating();
    let groupId = null;
    
    // Buscar el grupo por nombre
    for (const id in allGroups) {
      const group = allGroups[id];
      if (group.subject && group.subject.toLowerCase().includes(groupNameTarget.toLowerCase())) {
        groupId = group.id;
        break;
      }
    }
    
    if (!groupId) {
      return { success: false, error: `No se encontró el grupo "${groupNameTarget}" vinculado` };
    }
    
    await this.sock.sendMessage(groupId, { text: message });
    return { success: true };
  }
}

// Exportar una única instancia (Singleton)
module.exports = new WhatsAppService();
