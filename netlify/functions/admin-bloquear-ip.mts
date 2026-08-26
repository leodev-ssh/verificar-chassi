import { getStore } from '@netlify/blobs';
import { NOME_STORE } from '../../shared/planilha.mjs';
import {
  carregarIpsBloqueados,
  salvarIpsBloqueados,
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

  let ip = '';
  let acao: 'bloquear' | 'desbloquear' = 'bloquear';
  try {
    const body = await req.json();
    ip = String(body.ip || '').trim();
    acao = body.acao === 'desbloquear' ? 'desbloquear' : 'bloquear';
  } catch {
    return Response.json({ erro: 'Corpo inválido.' }, { status: 400 });
  }

  if (!ip) {
    return Response.json({ erro: 'Informe o IP.' }, { status: 400 });
  }

  const store = getStore(NOME_STORE);
  const atual = await carregarIpsBloqueados(store);

  const novaLista =
    acao === 'bloquear'
      ? Array.from(new Set([...atual, ip]))
      : atual.filter((item) => item !== ip);

  await salvarIpsBloqueados(store, novaLista);

  return Response.json({ ok: true, ipsBloqueados: novaLista });
};

export const config = {
  path: '/api/admin-bloquear-ip',
};
