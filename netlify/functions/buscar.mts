import { getStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { carregarRegistros, carregarFilaEspera, filaDoModelo, limparUpper, NOME_STORE } from '../../shared/planilha.mjs';
import { carregarIpsBloqueados, registrarAcesso } from '../../shared/admin.mjs';

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const termo = limparUpper(url.searchParams.get('q') || '');
  const ip = context.ip || '';

  const store = getStore(NOME_STORE);

  const ipsBloqueados = await carregarIpsBloqueados(store);
  if (ip && ipsBloqueados.includes(ip)) {
    return Response.json({ erro: 'Acesso bloqueado.' }, { status: 403 });
  }

  // Best-effort: roda em segundo plano, sem atrasar nem poder derrubar a busca.
  context.waitUntil(registrarAcesso(store, ip));

  if (!termo) {
    return Response.json({ erro: 'Informe os últimos dígitos do chassi.' }, { status: 400 });
  }
  if (!/^[A-Z0-9]{2,17}$/.test(termo)) {
    return Response.json({ erro: 'Digite apenas letras e números do chassi.' }, { status: 400 });
  }

  const { registros } = await carregarRegistros(store);
  const { filaEspera } = await carregarFilaEspera(store);

  const resultados = registros
    .filter((r: { chassi: string }) => r.chassi.endsWith(termo))
    .sort((a: { venceIso: string | null }, b: { venceIso: string | null }) =>
      (b.venceIso || '').localeCompare(a.venceIso || '')
    )
    .map((r: { moto: string; cor: string }) => {
      const fila = filaDoModelo(filaEspera, r.moto, r.cor);
      return { ...r, temFila: fila.length > 0, totalFila: fila.length };
    });
  return Response.json({ termo, total: resultados.length, resultados });
};

export const config = {
  path: '/api/buscar',
};
