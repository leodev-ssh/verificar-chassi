import { getStore } from '@netlify/blobs';
import { NOME_STORE } from '../../shared/planilha.mjs';
import {
  carregarWhitelist,
  salvarWhitelist,
  whitelistAtiva,
  definirWhitelistAtiva,
  lerCookie,
  tokenSessaoValido,
  NOME_COOKIE_SESSAO,
} from '../../shared/admin.mjs';

export default async (req: Request) => {
  const token = lerCookie(req.headers.get('cookie'), NOME_COOKIE_SESSAO);
  if (!tokenSessaoValido(token)) {
    return Response.json({ erro: 'Não autenticado.' }, { status: 401 });
  }
  if (req.method !== 'POST') {
    return Response.json({ erro: 'Método não permitido.' }, { status: 405 });
  }

  let body: { ip?: string; acao?: string; ativa?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ erro: 'Corpo inválido.' }, { status: 400 });
  }

  const store = getStore(NOME_STORE);

  if (body.acao === 'ativar' || body.acao === 'desativar') {
    await definirWhitelistAtiva(store, body.acao === 'ativar');
    return Response.json({ ok: true, whitelistAtiva: await whitelistAtiva(store) });
  }

  const ip = String(body.ip || '').trim();
  if (!ip) {
    return Response.json({ erro: 'Informe o IP.' }, { status: 400 });
  }

  const atual = await carregarWhitelist(store);
  const novaLista =
    body.acao === 'remover' ? atual.filter((item) => item !== ip) : Array.from(new Set([...atual, ip]));

  await salvarWhitelist(store, novaLista);

  return Response.json({ ok: true, whitelist: novaLista });
};

export const config = {
  path: '/api/admin-whitelist',
};
