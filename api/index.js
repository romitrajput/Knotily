// Vercel serverless entry point. vercel.json rewrites every /api/* request here.
import { handle } from '../server/router.js';

export default function handler(req, res) {
  return handle(req, res);
}
