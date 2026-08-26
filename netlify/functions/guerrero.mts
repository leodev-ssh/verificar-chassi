import { getStore } from '@netlify/blobs';
import { carregarRegistros, carregarFaturamento, relatorioGuerrero, NOME_STORE } from '../../shared/planilha.mjs';

export default async (req: Request) => {
  const url = new URL(req.url);
  const dia = url.searchParams.get('dia') || '';

  if (!dia) {
    return Response.json({ erro: 'Informe o dia (formato YYYY-MM-DD).' }, { status: 400 });
  }

  const store = getStore(NOME_STORE);
  const { registros } = await carregarRegistros(store);
  const { registros: faturamento } = await carregarFaturamento(store);

  const itens = relatorioGuerrero(registros, faturamento, dia);
  return Response.json({ dia, total: itens.length, itens });
};

export const config = {
  path: '/api/guerrero',
};
