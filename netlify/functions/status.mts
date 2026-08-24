import { getStore } from '@netlify/blobs';
import { carregarRegistros, NOME_STORE } from '../../shared/planilha.mjs';

export default async () => {
  const store = getStore(NOME_STORE);
  const { registros, atualizadoEm } = await carregarRegistros(store);

  return Response.json({
    totalChassis: registros.length,
    ultimaAtualizacao: atualizadoEm,
  });
};

export const config = {
  path: '/api/status',
};
