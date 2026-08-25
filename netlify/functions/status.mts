import { getStore } from '@netlify/blobs';
import { carregarRegistros, carregarFilaEspera, NOME_STORE } from '../../shared/planilha.mjs';

export default async () => {
  const store = getStore(NOME_STORE);
  const { registros, atualizadoEm } = await carregarRegistros(store);
  const { filaEspera, atualizadoEm: filaEsperaAtualizadaEm } = await carregarFilaEspera(store);

  return Response.json({
    totalChassis: registros.length,
    ultimaAtualizacao: atualizadoEm,
    totalFilaEspera: filaEspera.length,
    filaEsperaAtualizadaEm,
  });
};

export const config = {
  path: '/api/status',
};
