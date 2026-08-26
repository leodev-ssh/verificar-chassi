import { criarTokenSessao, senhaCorreta, NOME_COOKIE_SESSAO } from '../../shared/admin.mjs';

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ erro: 'Método não permitido.' }, { status: 405 });
  }

  let senha = '';
  try {
    const body = await req.json();
    senha = body.senha || '';
  } catch {
    return Response.json({ erro: 'Corpo inválido.' }, { status: 400 });
  }

  if (!senhaCorreta(senha)) {
    return Response.json({ erro: 'Senha incorreta.' }, { status: 401 });
  }

  const token = criarTokenSessao();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append(
    'Set-Cookie',
    `${NOME_COOKIE_SESSAO}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`
  );

  return new Response(JSON.stringify({ ok: true }), { headers });
};

export const config = {
  path: '/api/admin-login',
};
