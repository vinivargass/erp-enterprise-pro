'use strict';
// Validações compartilhadas (equivalente web do ZERPVAL.PRW).
// Toda validação roda no SERVIDOR; o frontend só repete as mesmas regras por usabilidade.
const { erro } = require('./erros');

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const somenteDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');

function cpfValido(valor) {
  const c = somenteDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(c[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(c[t])) return false;
  }
  return true;
}

function cnpjValido(valor) {
  const c = somenteDigitos(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base) => {
    const pesos = base.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const soma = pesos.reduce((s, p, i) => s + Number(base[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(c.slice(0, 12)) === Number(c[12]) && calc(c.slice(0, 13)) === Number(c[13]);
}

// Valida CPF (pessoa F) ou CNPJ (pessoa J) — formato e dígitos verificadores.
// Não consulta a Receita Federal: documento válido aqui = matematicamente consistente.
function documentoValido(tipoPessoa, documento) {
  return tipoPessoa === 'F' ? cpfValido(documento) : tipoPessoa === 'J' ? cnpjValido(documento) : false;
}

const emailValido = (v) => /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[A-Za-z]{2,}$/.test(v) && v.length <= 120;

// Coletor de erros por campo: acumula tudo e lança um único 422 com a lista.
class Validador {
  constructor(dados) {
    this.dados = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
    this.erros = {};
    this.saida = {};
  }
  falha(campo, msg) { if (!this.erros[campo]) this.erros[campo] = msg; return this; }

  texto(campo, { obrigatorio = false, max = 100, min = 0, maiusculo = false, padrao = '' } = {}) {
    let v = this.dados[campo];
    if (v != null && typeof v !== 'string' && typeof v !== 'number') return this.falha(campo, 'Valor inválido.');
    v = v == null ? '' : String(v).trim();
    // remove caracteres de controle (entrada maliciosa / colagem de lixo)
    v = v.replace(/[\u0000-\u001F\u007F]/g, '');
    if (maiusculo) v = v.toUpperCase();
    if (!v) {
      if (obrigatorio) return this.falha(campo, 'Campo obrigatório.');
      this.saida[campo] = padrao;
      return this;
    }
    if (v.length > max) return this.falha(campo, `Máximo de ${max} caracteres.`);
    if (v.length < min) return this.falha(campo, `Mínimo de ${min} caracteres.`);
    this.saida[campo] = v;
    return this;
  }

  numero(campo, { obrigatorio = false, min = -Infinity, max = Infinity, minExclusivo = false, casas = 2, padrao = 0 } = {}) {
    const bruto = this.dados[campo];
    if (bruto === undefined || bruto === null || bruto === '') {
      if (obrigatorio) return this.falha(campo, 'Campo obrigatório.');
      this.saida[campo] = padrao;
      return this;
    }
    const n = typeof bruto === 'number' ? bruto : Number(String(bruto).replace(',', '.'));
    if (!Number.isFinite(n)) return this.falha(campo, 'Número inválido.');
    if (minExclusivo ? n <= min : n < min) return this.falha(campo, minExclusivo ? `Deve ser maior que ${min}.` : `Deve ser no mínimo ${min}.`);
    if (n > max) return this.falha(campo, `Deve ser no máximo ${max}.`);
    const fator = 10 ** casas;
    if (Math.abs(Math.round(n * fator) - n * fator) > 1e-6) return this.falha(campo, `No máximo ${casas} casas decimais.`);
    this.saida[campo] = Math.round(n * fator) / fator;
    return this;
  }

  opcao(campo, opcoes, { obrigatorio = true, padrao } = {}) {
    const v = this.dados[campo];
    if (v === undefined || v === null || v === '') {
      if (obrigatorio && padrao === undefined) return this.falha(campo, 'Campo obrigatório.');
      this.saida[campo] = padrao;
      return this;
    }
    if (!opcoes.includes(v)) return this.falha(campo, 'Opção inválida.');
    this.saida[campo] = v;
    return this;
  }

  logico(campo, padrao = true) {
    const v = this.dados[campo];
    if (v === undefined) { this.saida[campo] = padrao; return this; }
    if (typeof v !== 'boolean') return this.falha(campo, 'Deve ser verdadeiro ou falso.');
    this.saida[campo] = v;
    return this;
  }

  data(campo, { obrigatorio = true } = {}) {
    const v = this.dados[campo];
    if (!v) { if (obrigatorio) this.falha(campo, 'Campo obrigatório.'); else this.saida[campo] = null; return this; }
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))
        || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) {
      return this.falha(campo, 'Data inválida (AAAA-MM-DD).');
    }
    this.saida[campo] = v;
    return this;
  }

  verificar(campo, cond, msg) { if (!this.erros[campo] && !cond) this.falha(campo, msg); return this; }

  resultado() {
    if (Object.keys(this.erros).length) throw erro.validacao('Existem campos inválidos.', this.erros);
    return this.saida;
  }
}

const centavos = (reais) => Math.round(Number(reais) * 100);
const reais = (cent) => Math.round(cent) / 100;
const q4 = (n) => Math.round(n * 10000) / 10000;

module.exports = { UFS, somenteDigitos, cpfValido, cnpjValido, documentoValido, emailValido, Validador, centavos, reais, q4 };
