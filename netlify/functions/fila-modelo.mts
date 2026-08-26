import { getStore } from '@netlify/blobs';
import { carregarFilaEspera, filaDoModelo, NOME_STORE } from '../../shared/planilha.mjs';

export default async (req: Request) => {
  const url = new URL(req.url);
  const moto = url.searchParams.get('moto') || '';
  const cor = url.searchParams.get('cor') || '';

  if (!moto) {
    return Response.json({ erro: 'Informe o modelo (moto) para consultar a fila.' }, { status: 400 });
  }

  const store = getStore(NOME_STORE);
  const { filaEspera } = await carregarFilaEspera(store);
  const fila = filaDoModelo(filaEspera, moto, cor);

  return Response.json({ moto, cor, total: fila.length, fila });
};

export const config = {
  path: '/api/fila-modelo',
};
