import { getStore } from '@netlify/blobs';
import { carregarFilaEspera, resumoFilaEspera, NOME_STORE } from '../../shared/planilha.mjs';

export default async () => {
  const store = getStore(NOME_STORE);
  const { filaEspera } = await carregarFilaEspera(store);
  const resumo = resumoFilaEspera(filaEspera);

  return Response.json({ total: filaEspera.length, resumo });
};

export const config = {
  path: '/api/fila-resumo',
};
