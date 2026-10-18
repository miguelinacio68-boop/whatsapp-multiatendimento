const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let sock = null;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr);
      io.emit('qr_code', qrDataUrl);
      io.emit('status_whatsapp', 'Desconectado');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      io.emit('status_whatsapp', 'Desconectado');
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      io.emit('status_whatsapp', 'Conectado');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'notify') {
      for (const msg of messages) {
        if (!msg.key.fromMe) {
          io.emit('nova_mensagem_recebida', {
            de: msg.key.remoteJid,
            texto: msg.message?.conversation || msg.message?.extendedTextMessage?.text || 'Mídia / Outra mensagem'
          });
        }
      }
    }
  });
}

connectToWhatsApp();

io.on('connection', (socket) => {
  socket.on('enviar_mensagem', async (data) => {
    const { clienteJid, mensagem, colaboradorNome } = data;
    if (!sock) return;

    const mensagemFormatada = `*[${colaboradorNome}]:* ${mensagem}`;

    try {
      await sock.sendMessage(clienteJid, { text: mensagemFormatada });

      io.emit('mensagem_enviada', {
        clienteJid,
        textoLimpo: mensagem,
        colaborador: colaboradorNome
      });
    } catch (err) {
      console.error('Erro ao enviar:', err);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
