import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongoUri: required('MONGODB_URI'),
  sessionSecret: (() => {
    const s = required('SESSION_SECRET');
    if (s.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters long.');
    }
    return s;
  })(),
  clientOrigins: (process.env.CLIENT_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export const isProd = env.nodeEnv === 'production';
