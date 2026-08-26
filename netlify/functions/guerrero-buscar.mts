import { getStore } from '@netlify/blobs';
import { carregarRegistros, carregarFaturamento, buscarGuerreroPorChassi, limparUpper, NOME_STORE } from '../../shared/planilha.mjs';

export default async (req: Request) => {
  const url = new URL(req.url);
  const termo = limparUpper(url.searchParams.get('q') || '');

  if (!termo) {
    return Response.json({ erro: 'Informe o chassi ou parte dele.' }, { status: 400 });
  }

  const store = getStore(NOME_STORE);
  const { registros } = await carregarRegistros(store);
  const { registros: faturamento } = await carregarFaturamento(store);

  const itens = buscarGuerreroPorChassi(registros, faturamento, termo);
  return Response.json({ termo, total: itens.length, itens });
};

export const config = {
  path: '/api/guerrero-buscar',
};
