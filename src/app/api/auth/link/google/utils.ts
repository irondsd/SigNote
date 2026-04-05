export function getRedirectUri() {
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  const vercelUrl = process.env.VERCEL_URL;
  if (nextAuthUrl) return `${nextAuthUrl}/api/auth/link/google/callback`;
  if (vercelUrl) return `https://${vercelUrl}/api/auth/link/google/callback`;
  return 'http://localhost:5000/api/auth/link/google/callback';
}
