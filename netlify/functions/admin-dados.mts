import { getStore } from '@netlify/blobs';
import { carregarRegistros, carregarFilaEspera, NOME_STORE } from '../../shared/planilha.mjs';
import {
  carregarIpsBloqueados,
  carregarLogAcessos,
  resumoIps,
  lerCookie,
  tokenSessaoValido,
  NOME_COOKIE_SESSAO,
} from '../../shared/admin.mjs';

export default async (req: Request) => {
  const token = lerCookie(req.headers.get('cookie'), NOME_COOKIE_SESSAO);
  if (!tokenSessaoValido(token)) {
    return Response.json({ erro: 'Não autenticado.' }, { status: 401 });
  }

  const store = getStore(NOME_STORE);
  const [{ registros, atualizadoEm }, { filaEspera, atualizadoEm: filaEsperaAtualizadaEm }, ipsBloqueados, log] =
    await Promise.all([
      carregarRegistros(store),
      carregarFilaEspera(store),
      carregarIpsBloqueados(store),
      carregarLogAcessos(store),
    ]);

  return Response.json({
    totalChassis: registros.length,
    ultimaAtualizacao: atualizadoEm,
    totalFilaEspera: filaEspera.length,
    filaEsperaAtualizadaEm,
    ipsBloqueados,
    ips: resumoIps(log),
  });
};

export const config = {
  path: '/api/admin-dados',
};
