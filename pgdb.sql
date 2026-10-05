CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    telefone TEXT,
    "idExterno" TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE conversation_state (
    conversation_id INTEGER PRIMARY KEY
        REFERENCES conversations(id),

    processoobra BOOLEAN,
    templanta BOOLEAN,
    residencia TEXT,

    interessecameras BOOLEAN,
    interesserede BOOLEAN,
    interesseautomacao BOOLEAN,

    etapaatendimento INTEGER,
    ultimoassunto TEXT,

    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE conversation_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL
        REFERENCES conversations(id),

    role TEXT NOT NULL,
    content TEXT NOT NULL,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE knowledge_documents (
    id SERIAL PRIMARY KEY,
    conteudo TEXT,
    embedding vector(768),
    metadata JSONB
);