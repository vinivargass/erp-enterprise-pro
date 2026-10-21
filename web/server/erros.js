'use strict';
// Erro de negócio/validação com status HTTP associado.
// A camada HTTP converte AppError em resposta JSON; qualquer outro erro vira 500
// sem vazar detalhes internos ao cliente.
class AppError extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes || null;
  }
}

const erro = {
  validacao: (mensagem, detalhes) => new AppError(422, 'VALIDACAO', mensagem, detalhes),
  naoEncontrado: (mensagem) => new AppError(404, 'NAO_ENCONTRADO', mensagem || 'Registro não encontrado.'),
  conflito: (mensagem, detalhes) => new AppError(409, 'CONFLITO', mensagem, detalhes),
  regra: (mensagem, detalhes) => new AppError(422, 'REGRA_NEGOCIO', mensagem, detalhes),
  naoAutenticado: () => new AppError(401, 'NAO_AUTENTICADO', 'Sessão inválida ou expirada.'),
  proibido: (mensagem) => new AppError(403, 'PROIBIDO', mensagem || 'Seu perfil não tem permissão para esta operação.'),
  requisicao: (mensagem) => new AppError(400, 'REQUISICAO_INVALIDA', mensagem),
};

module.exports = { AppError, erro };
