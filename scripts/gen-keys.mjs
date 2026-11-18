// Prints fresh secrets for one environment. Run once per environment (Testing, Production)
// and paste the output into Vercel's Environment Variables for that environment.
//   npm run keys            -> a full set
//   npm run keys -- --rotate v2   -> just a new encryption key to add for rotation (see docs/SECURITY.md)
import { randomBytes } from 'node:crypto';

const b64 = (n) => randomBytes(n).toString('base64');
const i = process.argv.indexOf('--rotate');
if (i > -1) {
  const id = process.argv[i + 1] || 'v2';
  console.log(`Add this key to DATA_ENCRYPTION_KEYS (keep the old ones!) and set DATA_ENCRYPTION_KEY_ID=${id}:\n`);
  console.log(`"${id}":"${b64(32)}"`);
} else {
  console.log('# Keep a copy of these in your password manager. Different values for every environment.');
  console.log(`DATA_ENCRYPTION_KEYS={"v1":"${b64(32)}"}`);
  console.log('DATA_ENCRYPTION_KEY_ID=v1');
  console.log(`BLIND_INDEX_KEY=${b64(32)}`);
  console.log(`SERVER_TOKEN_SECRET=${randomBytes(32).toString('hex')}`);
  console.log(`CRON_SECRET=${randomBytes(24).toString('hex')}`);
}
