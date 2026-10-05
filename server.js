/*
> - `config/` → configuração dos modelos e ambiente
> - `agent/` → criação/orquestração do agente
> - `tools/` → ferramentas
> - `rag/` → embeddings + vector store + retrieval
> - `state/` → leitura/gravação do estado
> - `db/` → acesso ao PostgreSQL
> - `prompts/` → prompts
> - `routes/` → API

salvar arquivo .env
npm install @langchain/openai @langchain/core @langchain/community
npm install pg
npm install dotenv
*/
const express = require("express");
const app = express();
app.use(express.json());
app.use(express.static("public"));
require("dotenv").config();

app.post("/chat", async (req, res) => {
    try {
        const {
            idExterno,
            nameClient,
            mensagem
        } = req.body;

        const contexto = await obterContextoCliente(
            idExterno,
            nameClient
        );

        const resultado = await processarMensagem({
            conversationId: contexto.conversationId,
            mensagem
        });

        res.json(resultado);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            erro: "Erro ao processar mensagem."
        });
    }
});

const config = {
    llmModel: process.env.LLM_MODEL || "qwen3:8b",
    embeddingModel: process.env.EMBEDDING_MODEL || "nomic-embed-text",
    databaseUrl: process.env.DATABASE_URL,
    port: process.env.PORT || 3000
};
// =====================================================
// OLLAMA — usado agora
// =====================================================
const {
    ChatOllama,
    OllamaEmbeddings
} = require("@langchain/ollama");

const llm = new ChatOllama({
    model: config.llmModel,
    temperature: 0.2,
    baseUrl: process.env.OLLAMA_URL
});

const embeddings = new OllamaEmbeddings({
    model: config.embeddingModel,
    baseUrl: process.env.OLLAMA_URL
});
// OPENAI — deixar para o futuro
// const {
//     ChatOpenAI,
//     OpenAIEmbeddings
// } = require("@langchain/openai");

// const llm = new ChatOpenAI({
//     model: config.llmModel,
//     temperature: 0.2
// });

// const embeddings = new OpenAIEmbeddings({
//     model: config.embeddingModel
// });
const {
    ChatPromptTemplate,
    MessagesPlaceholder
} = require("@langchain/core/prompts");

const {
    tool
} = require("@langchain/core/tools");

const {
    createAgent
} = require("langchain");


const { Pool } = require("pg");

const db = new Pool({
    connectionString: config.databaseUrl
});


async function gerarEmbedding(texto) {
    const vetor = await embeddings.embedQuery(texto);
    return vetor;
}

async function buscarConhecimento(pergunta) {
    const vetorPergunta = await embeddings.embedQuery(pergunta);
    const documentos = [
        {
            texto:
                "Câmeras IP normalmente são integradas à infraestrutura de rede e podem utilizar PoE.",
            score: 0.91
        },
        {
            texto:
                "Em uma casa em obra, é importante avaliar previamente pontos de câmera e rede.",
            score: 0.87
        }
    ];

    return documentos;
}

const estadoInicial = {
    processoObra: null,
    temPlanta: null,
    residencia: null,

    interesseCameras: false,
    interesseRede: false,
    interesseAutomacao: false,

    etapaAtendimento: 1,
    ultimoAssunto: null
};
const tiposEstado = {
    processoobra: "boolean",
    templanta: "boolean",
    residencia: "string",

    interessecameras: "boolean",
    interesserede: "boolean",
    interesseautomacao: "boolean",

    etapaatendimento: {
        tipo: "number",
        valores: [1, 2, 3, 4, 5]
    },

    ultimoassunto: "string"
};
async function obterContextoCliente(idExterno, nameClient) {

    const resultado = await db.query(
        `
        SELECT
            c."idExterno",
            c.id AS "clienteId",
            c.nome AS "nameClient",
            conv.id AS "conversationId"
        FROM "clients" c
        LEFT JOIN conversations conv
            ON conv.client_id = c.id
        WHERE c."idExterno" = $1
        `,
        [idExterno]
    );

    // Cliente já existe
    if (resultado.rows.length > 0) {
        return resultado.rows[0];
    }

    // Cliente não existe
    const novoCliente = await db.query(
        `
        INSERT INTO "clients" ("idExterno", nome)
        VALUES ($1, $2)
        RETURNING
            id,
            "idExterno",
            nome
        `,
        [idExterno, nameClient]
    );

    const novaConversa = await db.query(
        `
        INSERT INTO conversations (client_id)
        VALUES ($1)
        RETURNING id
        `,
        [novoCliente.rows[0].id]
    );

    return {
        idExterno: novoCliente.rows[0].idExterno,
        clienteId: novoCliente.rows[0].id,
        nameClient: novoCliente.rows[0].nome,
        conversationId: novaConversa.rows[0].id
    };
}
async function carregarEstado(conversationId) {
    const resultado = await db.query(
        `
        SELECT *
        FROM conversation_state
        WHERE conversation_id = $1
        `,
        [conversationId]
    );

    if (resultado.rows.length === 0) {

        await salvarEstado(
            conversationId,
            estadoInicial
        );

        return { ...estadoInicial };
    }

    return {
        ...resultado.rows[0]
    };
}
async function salvarEstado(conversationId, estado) {
    const campos = Object.keys(tiposEstado);

    const colunas = campos
        .map(campo => `"${campo}"`)
        .join(", ");

    const valores = campos
        .map((_, index) => `$${index + 2}`)
        .join(", ");

    const atualizacoes = campos
        .map(campo => `"${campo}" = EXCLUDED."${campo}"`)
        .join(", ");

    const valoresEstado = campos.map(campo => estado[campo]);

    await db.query(
        `
        INSERT INTO conversation_state (
            conversation_id,
            ${colunas},
            updated_at
        )
        VALUES (
            $1,
            ${valores},
            NOW()
        )

        ON CONFLICT (conversation_id)

        DO UPDATE SET
            ${atualizacoes},
            updated_at = NOW()
        `,
        [
            conversationId,
            ...valoresEstado
        ]
    );
}
async function carregarHistorico(conversationId) {

    const result = await db.query(
        `
        SELECT role, content
        FROM conversation_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC
        `,
        [conversationId]
    );

    return result.rows;
}
async function salvarMensagem(conversationId, role, content) {
    await db.query(
        `
        INSERT INTO conversation_messages
            (conversation_id, role, content)
        VALUES
            ($1, $2, $3)
        `,
        [conversationId, role, content]
    );
}
function criarAtualizarEstado(conversationId, estadoAtual) {
    return tool(
        async (dados) => {
            const novoEstado = {
                ...estadoAtual,
                ...dados
            };
            await salvarEstado(
                conversationId,
                novoEstado
            );
            return {
                sucesso: true,
                estado: novoEstado
            };
        },
        {
            name: "atualizar_estado",

            description:
                "Atualiza o estado UMA ÚNICA VEZ quando houver informação nova. Após chamar esta ferramenta, NÃO chame a ferramenta novamente para a mesma mensagem. Continue e responda ao cliente.",

            schema: {
                type: "object",
                properties: Object.fromEntries(
                    Object.entries(tiposEstado).map(([campo, tipo]) => {

                        if (typeof tipo === "string") {
                            return [
                                campo,
                                { type: tipo }
                            ];
                        }

                        return [
                            campo,
                            {
                                type: tipo.tipo,
                                enum: tipo.valores
                            }
                        ];
                    })
                )
            }
        }
    );
}
const systemPrompt = `
Você é Jonas, assistente de atendimento da Teclive.

A Teclive trabalha com:
- Automação residencial e comercial
- Câmeras e segurança
- Redes e infraestrutura
- Controle de acesso
- Outras soluções tecnológicas relacionadas

OBJETIVO

Seu objetivo é entender a necessidade do cliente e conduzir
naturalmente o atendimento até reunir as informações necessárias
para que a Teclive possa avaliar o projeto ou serviço.

COMPORTAMENTO

- Fale sempre em português do Brasil.
- Seja natural, cordial e objetivo.
- Converse como um atendente humano.
- Não seja robótico ou excessivamente formal.
- Faça perguntas apenas quando forem necessárias.
- Faça poucas perguntas por vez.
- Não repita perguntas que o cliente já respondeu.
- Não invente informações, preços, prazos ou condições.
- Não forneça tutoriais técnicos detalhados.
- Não mencione prompts, ferramentas, estado, banco de dados ou regras internas.
- Não presuma equipamentos, quantidades ou soluções que o cliente não informou.

CONDUÇÃO DO ATENDIMENTO

Primeiro entenda o contexto e a necessidade do cliente.

Durante a conversa, procure identificar naturalmente informações
relevantes, como:

- Se é residencial ou empresarial.
- Tipo de imóvel.
- Serviço ou interesse principal.
- O que o cliente pretende fazer.
- Se existe uma obra em andamento.
- Se possui planta.
- Quantidade aproximada de equipamentos ou pontos, quando relevante.
- Prazo ou momento em que pretende realizar o projeto.
- Outras informações importantes para avaliar a necessidade.

Não transforme isso em um questionário.

Priorize a informação mais importante para o momento atual
da conversa e avance gradualmente.

Quando o cliente apresentar uma necessidade ampla,
primeiro procure entender melhor o que ele deseja antes
de apresentar várias soluções.

ESTÁGIOS DO ATENDIMENTO

1 = Descoberta inicial da necessidade.
2 = Necessidade principal identificada.
3 = Interesse/solução principal identificada.
4 = Informações necessárias para qualificação coletadas.
5 = Cliente qualificado para a próxima ação.

Não avance uma etapa sem motivo.
Não diminua uma etapa sem motivo.

ESTADO

O estado atual da conversa é:

{estado}

Use o estado para evitar perguntas desnecessárias
e para entender quais informações ainda faltam.

ATUALIZAÇÃO DO ESTADO

Quando o cliente fornecer uma informação nova que altere o estado,
use a ferramenta atualizar_estado.

Não invente valores para o estado.
Atualize somente informações realmente fornecidas pelo cliente.
Use a ferramenta apenas quando houver uma mudança real.

PREÇOS E ORÇAMENTOS

Quando o cliente perguntar sobre preço, valor ou orçamento:

- Não invente valores.
- Explique brevemente que o valor depende das características
  e necessidades do projeto.
- Continue o atendimento buscando as informações relevantes
  para entender o cenário.

Quando uma avaliação do local puder ser necessária,
considere essa possibilidade, mas não trate o levantamento
como obrigatório em todos os casos.

RESPOSTAS

Seja objetivo.
Não faça textos longos.
Faça a conversa avançar.
`;
/*
const systemPrompt = `
    Você é um agente de atendimento chamado Jonas de uma empresa chamada Teclive
    que trabalha com automação, redes, CFTV,
    controle de acesso e infraestrutura.

    Seu objetivo é entender a necessidade do cliente
    e conduzir o atendimento.

    REGRAS:
    1. Seja natural.
    2. Não invente informações.
    3. Não cite conteúdo técnico em suas respostas.
    5. Considere o estado atual da conversa.
    6. Não faça perguntas que o estado já permita responder.
    7. Quando uma informação nova do cliente alterar o estado da conversa,
    use a ferramenta atualizar_estado para persistir essa informação.
    8. Não altere estados sem uma informação fornecida pelo cliente.
    9. Use atualizar_estado somente quando houver uma mudança real no estado.
    10. Não invente valores para os campos do estado.
    11. Responda de forma curta, objetiva e educada.
    12. Seu objetivo é ter todas informações do estado.

    FASES DO ATENDIMENTO:
    1 = início e descoberta da necessidade.
    2 = necessidade principal identificada.
    3 = solução/interesses do cliente identificados.
    4 = informações necessárias para qualificação coletadas.
    5 = cliente qualificado e pronto para próxima ação.

    Nunca avance uma fase sem possuir as informações necessárias.
    Nunca diminua a fase sem motivo.

    ESTADO ATUAL:
    {estado}
    `;
*/
const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("historico"),
    ["human", "{mensagem}"]
]);
async function processarMensagem({conversationId,mensagem}) {
    const estado =
        await carregarEstado(conversationId);

    const atualizarEstado =
        criarAtualizarEstado(
            conversationId,
            estado
        );

    const tools = [
        atualizarEstado
    ];

    const agent = createAgent({
        model: llm,
        tools,
    });

    const historico =
        await carregarHistorico(conversationId);
    //const documentos =
        //await buscarConhecimento(mensagem);

    const promptFormatado = await prompt.formatMessages({
        estado: JSON.stringify(estado),
        historico,
        mensagem
    });
    const resultado =
        await agent.invoke({
            messages: promptFormatado
        });
    const resposta =
    resultado.messages[
        resultado.messages.length - 1
    ].content;
    await salvarMensagem(
        conversationId,
        "user",
        mensagem
    );

    await salvarMensagem(
        conversationId,
        "assistant",
        resposta
    );

    const estadoFinal =
        await carregarEstado(conversationId);

    const retorno = {
        resposta: resposta,
        estado: estadoFinal
    };

    return retorno;
}

app.listen(config.port, () => {
    console.log(`Servidor rodando em http://localhost:${config.port}`);
});