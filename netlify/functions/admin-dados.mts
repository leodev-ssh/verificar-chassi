import { getStore } from '@netlify/blobs';
import { carregarRegistros, carregarFilaEspera, carregarFaturamento, NOME_STORE } from '../../shared/planilha.mjs';
import {
  carregarIpsBloqueados,
  carregarLogAcessos,
  carregarNomesIps,
  carregarWhitelist,
  whitelistAtiva,
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
  const [
    { registros, atualizadoEm },
    { filaEspera, atualizadoEm: filaEsperaAtualizadaEm },
    { registros: faturamento, atualizadoEm: faturamentoAtualizadoEm },
    ipsBloqueados,
    log,
    nomesIps,
    whitelist,
    whitelistLigada,
  ] = await Promise.all([
    carregarRegistros(store),
    carregarFilaEspera(store),
    carregarFaturamento(store),
    carregarIpsBloqueados(store),
    carregarLogAcessos(store),
    carregarNomesIps(store),
    carregarWhitelist(store),
    whitelistAtiva(store),
  ]);

  return Response.json({
    totalChassis: registros.length,
    ultimaAtualizacao: atualizadoEm,
    totalFilaEspera: filaEspera.length,
    filaEsperaAtualizadaEm,
    totalFaturamento: faturamento.length,
    faturamentoAtualizadoEm,
    ipsBloqueados,
    ips: resumoIps(log, nomesIps),
    whitelist,
    whitelistAtiva: whitelistLigada,
  });
};

export const config = {
  path: '/api/admin-dados',
};
