/**
 * PROTÓTIPO 3 — Bot do Telegram
 * -----------------------------------------------------------------------
 * Esse arquivo roda SEPARADO do server.js (o servidor do jogo). São dois
 * processos: um serve o Mini App e a física (server.js), outro conversa
 * com o Telegram (bot.js). Em produção os dois podem rodar na mesma
 * máquina/serviço, só como processos diferentes.
 *
 * O que o bot faz:
 *   /start          -> mensagem de boas-vindas
 *   /jogar          -> cria uma sala nova (código aleatório) e manda:
 *                        1) um botão que ABRE o Mini App já dentro dessa sala
 *                        2) um link de convite pra mandar pro amigo
 *   /start CODIGO   -> (quando o amigo clica no link de convite, o Telegram
 *                       manda isso automaticamente) -> o bot responde com
 *                       o botão do Mini App apontando pra MESMA sala
 *
 * Antes de rodar, você precisa:
 *  1) Criar um bot com o @BotFather no Telegram e pegar o TOKEN
 *  2) Ter o Mini App (server.js + public/) já hospedado numa URL https
 *     (o Telegram exige https, não aceita http:// nem localhost)
 *  3) Preencher o .env com TELEGRAM_BOT_TOKEN e WEBAPP_URL
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL; // ex: https://seu-jogo.onrender.com

if (!TOKEN) {
  console.error('Falta TELEGRAM_BOT_TOKEN no .env (pegue com o @BotFather)');
  process.exit(1);
}
if (!WEBAPP_URL) {
  console.error('Falta WEBAPP_URL no .env (a URL https onde o server.js está hospedado)');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

function generateRoomCode() {
  // 6 caracteres, fácil de digitar/compartilhar
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

function miniAppUrlForRoom(code) {
  return `${WEBAPP_URL}/?room=${code}`;
}

async function sendPlayButton(chatId, code, { isHost }) {
  const url = miniAppUrlForRoom(code);

  await bot.sendMessage(
    chatId,
    isHost
      ? `⚽ Sala criada: *${code}*\n\nToque no botão abaixo para entrar na partida.`
      : `⚽ Entrando na sala *${code}*.\n\nToque no botão abaixo para jogar.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎮 Abrir partida', web_app: { url } }]
        ]
      }
    }
  );

  if (isHost) {
    const me = await bot.getMe();
    const inviteLink = `https://t.me/${me.username}?start=${code}`;
    await bot.sendMessage(
      chatId,
      `Convide um amigo mandando este link pra ele:\n${inviteLink}\n\n` +
      `Quando ele tocar no link, o bot já vai abrir a mesma sala pra ele.`
    );
  }
}

bot.onText(/^\/start(?:\s+(\S+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const payload = match[1]; // presente quando alguém clicou num link de convite t.me/bot?start=CODIGO

  if (payload) {
    // amigo entrando numa sala já existente
    await sendPlayButton(chatId, payload.toUpperCase(), { isHost: false });
    return;
  }

  await bot.sendMessage(
    chatId,
    '⚽ Bem-vindo ao Futebol Multiplayer!\n\n' +
    'Use /jogar para criar uma partida e convidar um amigo.'
  );
});

bot.onText(/^\/jogar$/, async (msg) => {
  const chatId = msg.chat.id;
  const code = generateRoomCode();
  await sendPlayButton(chatId, code, { isHost: true });
});

console.log('Bot do Telegram rodando (polling)...');
