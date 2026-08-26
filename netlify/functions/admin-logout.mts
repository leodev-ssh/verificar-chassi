import { NOME_COOKIE_SESSAO } from '../../shared/admin.mjs';

export default async () => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', `${NOME_COOKIE_SESSAO}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return new Response(JSON.stringify({ ok: true }), { headers });
};

export const config = {
  path: '/api/admin-logout',
};
