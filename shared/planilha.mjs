import * as XLSX from 'xlsx';

const NOME_STORE = 'verificar-chassi';
const CHAVE_REGISTROS = 'registros.json';
const CHAVE_FILA_ESPERA = 'fila-espera.json';
const CHAVE_FATURAMENTO = 'faturamento.json';

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

// Extrai data ISO (YYYY-MM-DD) de "M/D/YY" para comparação, sem depender de fuso horário
export function paraIso(valor) {
  const texto = limpar(valor);
  if (!texto) return null;
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, mes, dia, anoRaw] = m;
  const ano = anoRaw.length === 2 ? `20${anoRaw}` : anoRaw;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
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
    envioIso: paraIso(linha['ENVIO']),
    vence: formatarData(linha['VENCE']),
    venceIso: paraIso(linha['VENCE']),
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

  const novosRegistros = [];
  for (const linha of linhas) {
    const registro = normalizarLinha(linha);
    if (!registro) continue;
    // Mantém todas as ocorrências do mesmo chassi (ex.: distribuição original
    // + redistribuição após vencimento para outro cliente)
    novosRegistros.push(registro);
  }

  return marcarDevolvidas(novosRegistros);
}

// Quando o mesmo chassi aparece mais de uma vez (redistribuição para outro
// cliente), toda ocorrência que NÃO é a mais recente (por ENVIO) já deixou
// de ser daquele cliente — mesmo sem ter vencido, foi devolvida/repassada.
function marcarDevolvidas(lista) {
  const maisRecentePorChassi = new Map();
  for (const r of lista) {
    const atual = maisRecentePorChassi.get(r.chassi);
    if (!atual || (r.envioIso || '') > (atual.envioIso || '')) {
      maisRecentePorChassi.set(r.chassi, r);
    }
  }
  return lista.map((r) => ({
    ...r,
    devolvida: maisRecentePorChassi.get(r.chassi) !== r,
  }));
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

// Converte "DD/MM/YY" (formato da planilha de fila de espera) para ISO
function paraIsoDiaMesAno(valor) {
  const texto = limpar(valor);
  if (!texto) return null;
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, dia, mes, anoRaw] = m;
  const ano = anoRaw.length === 2 ? `20${anoRaw}` : anoRaw;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

function isoParaBr(iso) {
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function normalizarLinhaFila(linha) {
  const modelo = limparUpper(linha['MODELO']);
  if (!modelo) return null;
  const inclusaoIso = paraIsoDiaMesAno(linha['INCLUSÃO']);
  return {
    modelo,
    cor: limpar(linha['CORPRIMARIA']),
    cliente: limpar(linha['CLIENTE']),
    gestor: limpar(linha['GESTOR']),
    vendedor: limpar(linha['Coluna1']),
    processo: limpar(linha['PROCESSO']),
    inclusao: isoParaBr(inclusaoIso),
    inclusaoIso,
  };
}

export function processarFilaEspera(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const aba = workbook.Sheets['GERAL'];
  if (!aba) {
    throw new Error('Aba "GERAL" não encontrada na planilha de fila de espera.');
  }

  // A aba GERAL tem cabeçalho na linha 3 e um range interno inflado por
  // formatação herdada (!ref pode chegar a 1 milhão+ de linhas vazias),
  // então usamos um range limitado (A3:I2000) em vez do range completo.
  const linhasBrutas = XLSX.utils.sheet_to_json(aba, {
    defval: '',
    raw: false,
    range: 'A3:I2000',
  });

  const novaFila = [];
  for (const linha of linhasBrutas) {
    const registro = normalizarLinhaFila(linha);
    if (!registro) continue;
    novaFila.push(registro);
  }

  novaFila.sort((a, b) => {
    if (a.modelo !== b.modelo) return a.modelo.localeCompare(b.modelo);
    return (a.inclusaoIso || '').localeCompare(b.inclusaoIso || '');
  });

  return novaFila;
}

export async function salvarFilaEspera(store, filaEspera) {
  const payload = {
    filaEspera,
    atualizadoEm: new Date().toISOString(),
  };
  await store.setJSON(CHAVE_FILA_ESPERA, payload);
  return payload;
}

export async function carregarFilaEspera(store) {
  const payload = await store.get(CHAVE_FILA_ESPERA, { type: 'json' });
  if (!payload) return { filaEspera: [], atualizadoEm: null };
  return payload;
}

// Associa o MOTO do chassi (nome técnico/completo) ao MODELO da fila de
// espera (nome comercial/curto). Tabela fixa validada manualmente, já que
// os vocabulários das duas planilhas não coincidem por substring/prefixo
// (ex.: "CG160 TITAN" no chassi vs "TITAN" na fila). Modelos do chassi sem
// entrada aqui não têm fila (retornam []).
export const MAPA_MOTO_PARA_MODELO_FILA = {
  'BIZ 125': 'BIZ 125 ES',
  'BIZ 125 ES': 'BIZ 125 ES',
  'BIZ 125 EX': 'BIZ 125 EX',
  'BIZ 125 EX KUROMI': 'BIZ 125 EX',
  'BIZ EX': 'BIZ 125 EX',
  'CB 500 HORNET': 'CB 500 HORNET',
  'CB 650R': 'CB 650R',
  'CB1000 HORNET': 'CB 1000',
  'CB300F TWISTER ABS': 'CB 300 ABS',
  'CB300F TWISTER ABS S': 'CB 300 ABS',
  'CG160 TITAN': 'TITAN',
  'CRF 1100L': 'CRF 1100L',
  'CRF 1100L  AS DCT': 'CRF 1100L',
  'CRF 1100L DCT': 'CRF 1100L',
  'CRF 300F': 'CRF 300F',
  'NX 500': 'NX 500',
  'POP110I ES': 'POP',
  'TRX420 FM': 'TRX',
  'XR300L TORNADO': 'TORNADO',
  'XR300L TORNADO SE': 'TORNADO',
  'XRE 190': 'XRE 190 STD',
  'XRE 190 ADV': 'XRE 190 STD',
  'XRE 300 SAHARA': 'SAHARA',
  'XRE 300 SAHARA ADV': 'SAHARA',
  'XRE 300 SAHARA RALLY': 'SAHARA',
};

// Reduz a cor à sua "cor base" (primeira palavra), já que o chassi usa
// nomes granulares (ex.: "CINZA PER", "PRETA MET.", "VERM.FOSCA") e a fila
// usa nomes simples (ex.: "CINZA", "PRETA", "VERMELHA").
const CORINGAS_COR = new Set(['QLQ COR', 'QUALQUER COR']);

function corBase(cor) {
  const upper = limparUpper(cor);
  if (!upper) return '';
  if (CORINGAS_COR.has(upper)) return '*';
  return upper.split(/[\s.]+/)[0];
}

function coresCompativeis(corChassi, corFila) {
  const baseFila = corBase(corFila);
  if (baseFila === '*') return true; // fila aceita qualquer cor
  const baseChassi = corBase(corChassi);
  if (!baseChassi || !baseFila) return false;
  return baseChassi.startsWith(baseFila) || baseFila.startsWith(baseChassi);
}

export function filaDoModelo(filaEspera, moto, cor) {
  const motoUpper = limparUpper(moto);
  const modeloFila = MAPA_MOTO_PARA_MODELO_FILA[motoUpper];
  if (!modeloFila) return [];

  return filaEspera
    .filter((f) => f.modelo === modeloFila)
    .filter((f) => (cor ? coresCompativeis(cor, f.cor) : true))
    .map((f, i) => ({ posicao: i + 1, ...f }));
}

export function resumoFilaEspera(filaEspera) {
  const porModelo = new Map();
  for (const item of filaEspera) {
    if (!porModelo.has(item.modelo)) {
      porModelo.set(item.modelo, { modelo: item.modelo, total: 0, cores: new Map() });
    }
    const grupo = porModelo.get(item.modelo);
    grupo.total += 1;
    const cor = item.cor || 'SEM COR';
    grupo.cores.set(cor, (grupo.cores.get(cor) || 0) + 1);
  }

  return Array.from(porModelo.values())
    .map((g) => ({
      modelo: g.modelo,
      total: g.total,
      cores: Array.from(g.cores.entries())
        .map(([cor, quantidade]) => ({ cor, quantidade }))
        .sort((a, b) => b.quantidade - a.quantidade),
    }))
    .sort((a, b) => b.total - a.total);
}

// --- Faturamento (base de vendas, cruzada por chassi com a distribuição) ---
function normalizarLinhaFaturamento(linha) {
  const chassi = limparUpper(linha['Chassi']);
  if (!chassi) return null;
  return {
    chassi,
    cliente: limpar(linha['Cliente']),
    vendedor: limpar(linha['Vendedor']),
    // "Data Venda" vem como DD/MM/YYYY, diferente do M/D/YY da distribuição
    dataVenda: isoParaBr(paraIsoDiaMesAno(linha['Data Venda'])),
  };
}

export function processarFaturamento(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const aba = workbook.Sheets[workbook.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(aba, { defval: '', raw: false });

  const registros = [];
  for (const linha of linhas) {
    // A última linha do export é um rodapé de totais, sem chassi real
    const registro = normalizarLinhaFaturamento(linha);
    if (!registro) continue;
    registros.push(registro);
  }

  return registros;
}

export async function salvarFaturamento(store, registros) {
  const payload = {
    registros,
    atualizadoEm: new Date().toISOString(),
  };
  await store.setJSON(CHAVE_FATURAMENTO, payload);
  return payload;
}

export async function carregarFaturamento(store) {
  const payload = await store.get(CHAVE_FATURAMENTO, { type: 'json' });
  if (!payload) return { registros: [], atualizadoEm: null };
  return payload;
}

// Datas de ENVIO (YYYY-MM-DD) distintas na base de distribuição, mais recentes primeiro
export function diasDeEnvioDisponiveis(registrosChassi) {
  const dias = new Set(registrosChassi.map((r) => r.envioIso).filter(Boolean));
  return Array.from(dias).sort((a, b) => b.localeCompare(a));
}

// Relatório "Guerrero": chassis distribuídos num dia, cruzados com faturamento
export function relatorioGuerrero(registrosChassi, registrosFaturamento, envioIso) {
  const faturamentoPorChassi = new Map(registrosFaturamento.map((f) => [f.chassi, f]));
  return registrosChassi
    .filter((r) => r.envioIso === envioIso)
    .map((r) => {
      const faturado = faturamentoPorChassi.get(r.chassi);
      return {
        moto: r.moto,
        chassi: r.chassi,
        vendedorDistribuicao: r.vendedor,
        clienteDistribuicao: r.cliente,
        envio: r.envio,
        vence: r.vence,
        venceIso: r.venceIso,
        devolvida: r.devolvida,
        faturado: Boolean(faturado),
        vendedorFaturamento: faturado ? faturado.vendedor : '',
        clienteFaturamento: faturado ? faturado.cliente : '',
        dataVenda: faturado ? faturado.dataVenda : '',
      };
    });
}

export { NOME_STORE, CHAVE_REGISTROS, CHAVE_FILA_ESPERA, CHAVE_FATURAMENTO };
