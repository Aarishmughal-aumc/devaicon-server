import dns from 'node:dns';
import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  // Some machines have a broken/loopback DNS resolver, which makes Atlas
  // `mongodb+srv://` SRV lookups fail with `querySrv ECONNREFUSED`. Allow
  // pointing Node at a working public resolver via DNS_SERVERS.
  if (env.dnsServers.length > 0) {
    dns.setServers(env.dnsServers);
    console.log(`[db] using DNS servers: ${env.dnsServers.join(', ')}`);
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri);
  console.log(`[db] connected to ${mongoose.connection.name}`);
}
