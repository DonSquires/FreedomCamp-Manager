require('dotenv').config();
const nodemailer = require('nodemailer');

function required(name) {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

async function main() {
  const host = required('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT || 587);
  const user = required('SMTP_USERNAME');
  const pass = required('SMTP_PASSWORD');
  const from = required('SMTP_FROM_EMAIL');
  const to = process.env.SMTP_TEST_TO || user;

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  await transport.verify();

  const info = await transport.sendMail({
    from,
    to,
    subject: '[Field Compliance Manager] SMTP smoke test',
    text: `SMTP smoke test passed at ${new Date().toISOString()}`,
    html: `<p>SMTP smoke test passed at <strong>${new Date().toISOString()}</strong></p>`,
  });

  console.log('SMTP test success');
  console.log(`messageId=${info.messageId}`);
  console.log(`accepted=${(info.accepted || []).join(',')}`);
}

main().catch((error) => {
  console.error('SMTP test failed');
  console.error(error?.message || error);
  process.exit(1);
});
