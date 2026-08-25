import { getStore } from '@netlify/blobs';
import { carregarRegistros, limparUpper, NOME_STORE } from '../../shared/planilha.mjs';

export default async (req: Request) => {
  const url = new URL(req.url);
  const termo = limparUpper(url.searchParams.get('q') || '');

  if (!termo) {
    return Response.json({ erro: 'Informe os últimos dígitos do chassi.' }, { status: 400 });
  }
  if (!/^[A-Z0-9]{2,17}$/.test(termo)) {
    return Response.json({ erro: 'Digite apenas letras e números do chassi.' }, { status: 400 });
  }

  const store = getStore(NOME_STORE);
  const { registros } = await carregarRegistros(store);

  const resultados = registros
    .filter((r: { chassi: string }) => r.chassi.endsWith(termo))
    .sort((a: { venceIso: string | null }, b: { venceIso: string | null }) =>
      (b.venceIso || '').localeCompare(a.venceIso || '')
    );
  return Response.json({ termo, total: resultados.length, resultados });
};

export const config = {
  path: '/api/buscar',
};
