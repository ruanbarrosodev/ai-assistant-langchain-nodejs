const express = require("express");

const app = express();
const PORT = 3000;


// ============================================================
// ESTADO DA APLICAÇÃO
// ============================================================

// Hoje isso está tudo neste arquivo.
// Mais para frente, isso poderia ficar separado em um arquivo
// de "state", "memory", "session", etc.

const historico = [];

const estado = {
    obraComecou: null,
    possuiPlanta: null,
    interesse: null
};


// ============================================================
// CONFIGURAÇÃO
// ============================================================

// Também é comum isso ficar separado futuramente
// em um arquivo de configuração.

app.use(express.json());


// ============================================================
// ROTA DE TESTE
// ============================================================

app.get("/", (req, res) => {
    res.send("teste IA");
});


// ============================================================
// EMBEDDING
// ============================================================

// Essa rota continua separada da LLM.
// Ela serve para transformar um texto em vetor.
//
// Futuramente, aqui entraria também a parte de:
// texto → embedding → Qdrant → busca
//
// Por enquanto estamos apenas gerando o embedding.

app.get("/embedding", async (req, res) => {

    const { texto } = req.query;

    const resposta = await fetch("http://localhost:11434/api/embed", {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            model: "nomic-embed-text",
            input: texto
        })
    });

    const dados = await resposta.json();

    res.send(dados);
});


// ============================================================
// CHAT / LLM
// ============================================================

app.post("/chat", async (req, res) => {

    try {

        const mensagem = req.body.mensagem;


        // ----------------------------------------------------
        // 1. SALVA A MENSAGEM DO USUÁRIO NO HISTÓRICO
        // ----------------------------------------------------

        historico.push({
            role: "user",
            content: mensagem
        });


        // ----------------------------------------------------
        // 2. MONTAMOS AS MENSAGENS QUE SERÃO ENVIADAS À LLM
        // ----------------------------------------------------

        const mensagens = [

            {
                role: "system",

                content: `
Você é um assistente comercial.

Seu objetivo é conduzir o atendimento de forma natural
e humanizada.

Existem algumas informações que precisam ser descobertas
durante a conversa:

- se a obra começou;
- se o cliente possui planta;
- qual é o interesse principal do cliente.

Não transforme a conversa em um questionário.

Faça as perguntas naturalmente, levando em consideração
o que o cliente acabou de falar.

Além da resposta ao cliente, retorne o estado atualizado
da conversa no formato JSON.

Estado atual:

${JSON.stringify(estado)}
`},
 ...historico
     ];


        // ----------------------------------------------------
        // 3. ENVIA PARA O OLLAMA
        // ----------------------------------------------------

        const resposta = await fetch(
            "http://localhost:11434/api/chat",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({

                    model: "qwen3:8b",

                    messages: mensagens,

                    stream: false

                })
            }
        );


        // ----------------------------------------------------
        // 4. PEGA A RESPOSTA DA LLM
        // ----------------------------------------------------

        const dados = await resposta.json();

        const respostaLLM = dados.message.content;


        // ----------------------------------------------------
        // 5. SALVA A RESPOSTA NO HISTÓRICO
        // ----------------------------------------------------

        historico.push({
            role: "assistant",
            content: respostaLLM
        });


        // ----------------------------------------------------
        // 6. RETORNA PARA QUEM FEZ A REQUISIÇÃO
        // ----------------------------------------------------

        res.json({
            resposta: respostaLLM,
            estado: estado
        });


    } catch (erro) {

        console.error(erro);

        res.status(500).json({
            erro: "Erro ao comunicar com o Ollama"
        });

    }

});


// ============================================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================================

app.listen(PORT, () => {

    console.log(
        `Servidor rodando em http://localhost:${PORT}`
    );

});

