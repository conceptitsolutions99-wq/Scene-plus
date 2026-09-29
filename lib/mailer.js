// lib/mailer.js
// Sends email using a minimal hand-rolled SMTP client over Node's built-in
// `tls` module — no external packages required, so `node server.js` keeps
// working with zero `npm install`.
//
// Configure a real mail account via environment variables before running
// the server, e.g.:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=465
//   SMTP_USER=youraddress@gmail.com
//   SMTP_PASS=your-app-password        (Gmail: use an "App Password", not your normal password)
//   SMTP_FROM="Scene+ Offers Portal <youraddress@gmail.com>"
//
// If SMTP_HOST/SMTP_USER/SMTP_PASS are not set, emails are NOT sent —
// instead the message is printed to the server console, so the OTP flow
// is still fully testable before you've set up a real mail account.

const tls = require('tls');

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      // SMTP multi-line responses use "250-text" for continuation lines and
      // "250 text" (space, not dash) on the final line.
      if (last && /^\d{3} /.test(last)) {
        socket.removeListener('data', onData);
        resolve(buffer);
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
}

function command(socket, text) {
  socket.write(text + '\r\n');
  return readResponse(socket);
}

async function sendViaSmtp({ to, subject, text }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  const socket = tls.connect({ host, port, servername: host });
  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });

  await readResponse(socket); // greeting
  await command(socket, `EHLO ${host}`);
  await command(socket, 'AUTH LOGIN');
  await command(socket, Buffer.from(user).toString('base64'));
  await command(socket, Buffer.from(pass).toString('base64'));
  await command(socket, `MAIL FROM:<${user}>`);
  await command(socket, `RCPT TO:<${to}>`);
  await command(socket, 'DATA');
  const message =
    `From: ${from}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `\r\n${text}\r\n.`;
  await command(socket, message);
  await command(socket, 'QUIT');
  socket.end();
}

/**
 * Sends an email, or — if no SMTP credentials are configured — logs it to
 * the server console instead, so the calling flow (e.g. OTP delivery)
 * still works end-to-end during local testing.
 * Returns { sent: boolean, devMode: boolean }.
 */
async function sendMail({ to, subject, text }) {
  if (!isConfigured()) {
    console.log('\n[mailer] SMTP not configured — printing email instead of sending it.');
    console.log(`[mailer] To: ${to}`);
    console.log(`[mailer] Subject: ${subject}`);
    console.log(`[mailer] ---\n${text}\n---\n`);
    return { sent: false, devMode: true };
  }
  try {
    await sendViaSmtp({ to, subject, text });
    return { sent: true, devMode: false };
  } catch (err) {
    console.error('[mailer] Failed to send email:', err.message);
    console.log(`[mailer] Falling back to console output for: ${to}`);
    console.log(`[mailer] Subject: ${subject}`);
    console.log(`[mailer] ---\n${text}\n---\n`);
    return { sent: false, devMode: true, error: err.message };
  }
}

module.exports = { sendMail, isConfigured };
