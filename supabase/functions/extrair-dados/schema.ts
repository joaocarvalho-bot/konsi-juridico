// GERADO de konsi-juridico-ia/extrair-dados.schema.json ($ref inlinados p/ a API Anthropic).
export const TOOL = {
  "name": "registrar_extracao",
  "description": "Registra os dados extraídos de uma notificação de contestação. Cada campo carrega valor + nível de confiança + evidência literal. NUNCA invente valores: campo ausente => valor null e confianca 'vazio'.",
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "campos",
      "subsidios",
      "contratos_adicionais"
    ],
    "properties": {
      "campos": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "nome_cliente",
          "cpf",
          "banco",
          "ade",
          "numero_proposta",
          "motivo",
          "canal",
          "data_recebimento",
          "data_operacao",
          "data_pagamento",
          "numero_processo",
          "convenio",
          "valor_liberado",
          "valor_parcela",
          "qtd_parcelas",
          "operacao",
          "descricao_fatos",
          "prazo_resposta",
          "link_portal"
        ],
        "properties": {
          "nome_cliente": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Trecho LITERAL copiado do documento que sustenta o valor. Obrigatório quando confianca != vazio."
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Por que a confiança é media/vazio (ex.: 'inferido do remetente', 'valor não consta')."
              }
            }
          },
          "cpf": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Trecho LITERAL copiado do documento que sustenta o valor. Obrigatório quando confianca != vazio."
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Por que a confiança é media/vazio (ex.: 'inferido do remetente', 'valor não consta')."
              }
            }
          },
          "banco": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Trecho LITERAL copiado do documento que sustenta o valor. Obrigatório quando confianca != vazio."
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Por que a confiança é media/vazio (ex.: 'inferido do remetente', 'valor não consta')."
              }
            }
          },
          "ade": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Trecho LITERAL copiado do documento que sustenta o valor. Obrigatório quando confianca != vazio."
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Por que a confiança é media/vazio (ex.: 'inferido do remetente', 'valor não consta')."
              }
            }
          },
          "numero_proposta": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Trecho LITERAL copiado do documento que sustenta o valor. Obrigatório quando confianca != vazio."
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Por que a confiança é media/vazio (ex.: 'inferido do remetente', 'valor não consta')."
              }
            }
          },
          "motivo": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "enum": [
                  "NÃO RECONHECE",
                  "FRAUDE",
                  "CANCELAMENTO",
                  "DESACORDO COMERCIAL",
                  "SUPERENDIVIDAMENTO",
                  "REVISIONAL",
                  "EXIBICAO DOCUMENTO",
                  "VENDA CASADA",
                  "SEGREDO DE JUSTIÇA",
                  null
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Se o texto-fonte não mapear com segurança a um enum, use valor null + confianca vazio e registre aqui o texto bruto do motivo."
              }
            }
          },
          "canal": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "enum": [
                  "Judicial",
                  "SAC Banco",
                  "E-mail",
                  "BACEN",
                  "Procon",
                  "Reclame Aqui",
                  "Consumidor.gov",
                  "Sistema Contest",
                  null
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "data_recebimento": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Data ISO YYYY-MM-DD. Converta DD/MM/AAAA. null se ausente."
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "data_operacao": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Data ISO YYYY-MM-DD. Converta DD/MM/AAAA. null se ausente."
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "data_pagamento": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Data ISO YYYY-MM-DD. Converta DD/MM/AAAA. null se ausente."
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "numero_processo": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Trecho LITERAL copiado do documento que sustenta o valor. Obrigatório quando confianca != vazio."
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Por que a confiança é media/vazio (ex.: 'inferido do remetente', 'valor não consta')."
              }
            }
          },
          "convenio": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "enum": [
                  "INSS",
                  "GOV BA",
                  "GOV SP",
                  null
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "valor_liberado": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Número com ponto decimal, sem R$ nem separador de milhar (ex.: '1580.00'). null se ausente."
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "valor_parcela": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Número com ponto decimal, sem R$ nem separador de milhar (ex.: '1580.00'). null se ausente."
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "qtd_parcelas": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Número com ponto decimal, sem R$ nem separador de milhar (ex.: '1580.00'). null se ausente."
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "operacao": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "enum": [
                  "Novo",
                  "Portabilidade",
                  "Refinanciamento",
                  "Cartão RMC",
                  "Cartão RCC",
                  null
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "descricao_fatos": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Trecho LITERAL copiado do documento que sustenta o valor. Obrigatório quando confianca != vazio."
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Por que a confiança é media/vazio (ex.: 'inferido do remetente', 'valor não consta')."
              }
            }
          },
          "prazo_resposta": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Trecho LITERAL copiado do documento que sustenta o valor. Obrigatório quando confianca != vazio."
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Por que a confiança é media/vazio (ex.: 'inferido do remetente', 'valor não consta')."
              }
            }
          },
          "link_portal": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "valor",
              "confianca"
            ],
            "properties": {
              "valor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "confianca": {
                "type": "string",
                "enum": [
                  "alta",
                  "media",
                  "vazio"
                ],
                "description": "alta=literal e inequívoco no documento; media=inferido/mapeado; vazio=não encontrado ou não mapeável com segurança."
              },
              "evidencia": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Trecho LITERAL copiado do documento que sustenta o valor. Obrigatório quando confianca != vazio."
              },
              "motivo": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Por que a confiança é media/vazio (ex.: 'inferido do remetente', 'valor não consta')."
              }
            }
          }
        }
      },
      "subsidios": {
        "type": "array",
        "description": "Lista de perguntas/pedidos de subsídio que o banco faz (ex.: 'informar telefone do cliente', 'contrato digital ou físico?'). Cada item = texto literal. Alimenta o laudo.",
        "items": {
          "type": "string"
        }
      },
      "contratos_adicionais": {
        "type": "array",
        "description": "Se o documento cita mais de um contrato/benefício/CPF, liste aqui os que NÃO são do titular contestante (multi-benefício). Vazio se só há um.",
        "items": {
          "type": "string"
        }
      },
      "observacoes_extras": {
        "type": [
          "string",
          "null"
        ],
        "description": "Qualquer informação relevante que não se encaixa nos campos acima."
      }
    }
  }
} as const;
