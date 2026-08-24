import { getStore } from '@netlify/blobs';
import { processarPlanilha, salvarRegistros, NOME_STORE } from '../../shared/planilha.mjs';

export default async (req: Request) => {
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
  // Netlify Functions: requisições bufferizadas têm limite de ~6MB
  // (binário chega em Base64, com overhead de ~30% -> ~4.5MB úteis)
  if (file.size > 4 * 1024 * 1024) {
    return Response.json({ erro: 'Arquivo maior que 4MB. O limite do Netlify Functions é baixo para uploads binários — considere reduzir a planilha ou trocar de provedor se ela crescer muito.' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const registros = processarPlanilha(buffer);

    const store = getStore(NOME_STORE);
    const payload = await salvarRegistros(store, registros);

    return Response.json({
      ok: true,
      totalChassis: registros.length,
      ultimaAtualizacao: payload.atualizadoEm,
    });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    return Response.json({ erro: 'Não foi possível processar a planilha: ' + mensagem }, { status: 400 });
  }
};

export const config = {
  path: '/api/upload',
};
