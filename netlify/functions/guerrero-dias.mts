import { getStore } from '@netlify/blobs';
import { carregarRegistros, diasDeEnvioDisponiveis, NOME_STORE } from '../../shared/planilha.mjs';

export default async () => {
  const store = getStore(NOME_STORE);
  const { registros } = await carregarRegistros(store);
  return Response.json({ dias: diasDeEnvioDisponiveis(registros) });
};

export const config = {
  path: '/api/guerrero-dias',
};
