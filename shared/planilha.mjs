import * as XLSX from 'xlsx';

const NOME_STORE = 'verificar-chassi';
const CHAVE_REGISTROS = 'registros.json';

// --- Normalização de texto (remove nbsp, espaços extras, uppercase) ---
export function limpar(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function limparUpper(valor) {
  return limpar(valor).toUpperCase();
}

// Converte "M/D/YY" (formato de origem da planilha) para "DD/MM/YYYY"
export function formatarData(valor) {
  const texto = limpar(valor);
  if (!texto) return '';
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return texto;
  const [, mes, dia, anoRaw] = m;
  const ano = anoRaw.length === 2 ? `20${anoRaw}` : anoRaw;
  return `${dia.padStart(2, '0')}/${mes.padStart(2, '0')}/${ano}`;
}

function normalizarLinha(linha) {
  const chassi = limparUpper(linha['CHASSI']);
  if (!chassi) return null;
  return {
    chassi,
    ultimos4: chassi.slice(-4),
    moto: limpar(linha['MOTO']),
    cor: limpar(linha['COR']),
    cliente: limpar(linha['CLIENTE']),
    gestor: limpar(linha['GESTOR']),
    vendedor: limpar(linha['VENDEDOR']),
    status: limpar(linha['Coluna1'] ?? linha['MODALIDADE']),
    cod: limpar(linha['CÓD.']),
    envio: formatarData(linha['ENVIO']),
    vence: formatarData(linha['VENCE']),
  };
}

export function processarPlanilha(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  let linhas = [];
  for (const nomeAba of workbook.SheetNames) {
    const aba = workbook.Sheets[nomeAba];
    const json = XLSX.utils.sheet_to_json(aba, { defval: '', raw: false });
    if (json.length > 0 && 'CHASSI' in json[0]) {
      linhas = linhas.concat(json);
    }
  }

  const mapaPorChassi = new Map();
  for (const linha of linhas) {
    const registro = normalizarLinha(linha);
    if (!registro) continue;
    mapaPorChassi.set(registro.chassi, registro);
  }

  return Array.from(mapaPorChassi.values());
}

export async function salvarRegistros(store, registros) {
  const payload = {
    registros,
    atualizadoEm: new Date().toISOString(),
  };
  await store.setJSON(CHAVE_REGISTROS, payload);
  return payload;
}

export async function carregarRegistros(store) {
  const payload = await store.get(CHAVE_REGISTROS, { type: 'json' });
  if (!payload) return { registros: [], atualizadoEm: null };
  return payload;
}

export { NOME_STORE, CHAVE_REGISTROS };
