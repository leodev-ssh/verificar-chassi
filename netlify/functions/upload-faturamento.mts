import { getStore } from '@netlify/blobs';
import { processarFaturamento, salvarFaturamento, NOME_STORE } from '../../shared/planilha.mjs';
import { lerCookie, tokenSessaoValido, NOME_COOKIE_SESSAO } from '../../shared/admin.mjs';

export default async (req: Request) => {
  const token = lerCookie(req.headers.get('cookie'), NOME_COOKIE_SESSAO);
  if (!tokenSessaoValido(token)) {
    return Response.json({ erro: 'Não autenticado.' }, { status: 401 });
  }
  if (req.method !== 'POST') {
    return Response.json({ erro: 'Método não permitido.' }, { status: 405 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    file = form.get('planilha') as File | null;
  } catch {
    return Response.json({ erro: 'Envie a planilha como multipart/form-data.' }, { status: 400 });
  }

  if (!file) {
    return Response.json({ erro: 'Nenhum arquivo enviado.' }, { status: 400 });
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return Response.json({ erro: 'Apenas arquivos .xlsx são aceitos.' }, { status: 400 });
  }
  if (file.size > 4 * 1024 * 1024) {
    return Response.json({ erro: 'Arquivo maior que 4MB. O limite do Netlify Functions é baixo para uploads binários — considere reduzir a planilha ou trocar de provedor se ela crescer muito.' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const registros = processarFaturamento(buffer);

    const store = getStore(NOME_STORE);
    const payload = await salvarFaturamento(store, registros);

    return Response.json({
      ok: true,
      totalFaturamento: registros.length,
      faturamentoAtualizadoEm: payload.atualizadoEm,
    });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    return Response.json({ erro: 'Não foi possível processar a planilha de faturamento: ' + mensagem }, { status: 400 });
  }
};

export const config = {
  path: '/api/upload-faturamento',
};
